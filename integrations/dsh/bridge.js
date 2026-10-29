import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

// Bridge-owned policies, not limits imposed by the native Harness Agent API.
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 6 * MAX_TEXT_BYTES + 2048;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const failure = (code, message, status = 500) => Object.assign(new Error(message), { code: `DSH_${code}`, status });

// The error that caused a failure stays the reason; cleanup failures ride on its
// cause instead of replacing it.
function withCleanup(error, cleanup) {
  if (cleanup.length === 0) return error;
  const extra = cleanup.length === 1 ? cleanup[0] : new AggregateError(cleanup, 'Harness bridge cleanup failed.');
  let cause;
  try { cause = error?.cause; } catch { cause = undefined; }
  // A readable cause is not necessarily writable; never let that assignment
  // replace the error it belongs to.
  if (cause === undefined) {
    try { error.cause = extra; return error; } catch { /* wrap instead */ }
  }
  return new AggregateError([error, extra], String(error?.message ?? error), { cause });
}

function send(response, value, status = 200) {
  if (response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) throw failure('INPUT_REJECTED', 'Harness bridge JSON body exceeds its input budget.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure('INPUT_REJECTED', 'Harness bridge requires a valid JSON message.', 400); }
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'text' && key !== 'mode')
    || typeof value.text !== 'string' || value.text.trim() === '' || !['queue', 'steer'].includes(value.mode)) {
    throw failure('INPUT_REJECTED', 'Harness bridge accepts non-empty text and queue or steer mode only.', 400);
  }
  if (Buffer.byteLength(value.text) > MAX_TEXT_BYTES) throw failure('INPUT_REJECTED', 'Harness bridge text exceeds its 1MiB adapter budget.', 413);
  return value;
}

/** The caller owns its Host capabilities; no extra Cordis or SDK tree is created. */
export async function mountDshBridge(ctx, host, options = {}) {
  const home = options.home ?? homedir();
  if (typeof home !== 'string' || !isAbsolute(home)) throw failure('REGISTRATION_MALFORMED', 'Harness bridge home must be absolute.');
  if (typeof host.createUserMessage !== 'function' || typeof host.getDshRuntimeVersion !== 'function') throw failure('PROTOCOL_ERROR', 'Harness public message and version capabilities are required.');
  const instanceId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(`Bearer ${token}`);
  const runtimeVersion = host.getDshRuntimeVersion();
  if (typeof runtimeVersion !== 'string' || runtimeVersion === '') throw failure('PROTOCOL_ERROR', 'Harness runtime did not identify its version.');
  // This public boot context describes the Host domain, never the attached UI.
  const profileContext = ctx.get('profileContext');
  const profile = isRecord(profileContext) && typeof profileContext.name === 'string'
    && profileContext.name.trim() !== '' && profileContext.name.length <= 256 ? profileContext.name : undefined;
  const endpoint = profile === undefined ? {} : { profile, endpointType: profile === 'desktop' ? 'desktop' : 'host' };
  const shellEnv = ctx.get('shellEnv');
  const profileDir = isRecord(profileContext) && typeof profileContext.dir === 'string' && isAbsolute(profileContext.dir) ? profileContext.dir : undefined;
  // This is schema support, not a claim that a shell has received a contribution.
  // Only the current native shell's managed marker can establish that association.
  const callerIdentity = (typeof ctx.inject === 'function' || typeof shellEnv?.register === 'function') && profile !== undefined && profileDir !== undefined
    ? { schema: 1, profileDir } : undefined;
  const directory = join(home, '.crosschat', 'dsh', 'instances');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dirInfo = await lstat(directory);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink() || (process.platform !== 'win32' && ((dirInfo.mode & 0o077) !== 0 || dirInfo.uid !== process.getuid?.()))) {
    throw failure('REGISTRATION_MALFORMED', 'Harness instance directory must be private and owned by this user.');
  }
  let url;
  let closed = false;
  let closing;
  let published = false;
  // Only a temporary file this mount created itself may be removed on failure.
  let temporaryOwned = false;
  let releaseCallerIdentity;
  let callerIdentityScope;
  const file = join(directory, `${instanceId}.json`);
  const temporary = join(directory, `${instanceId}.tmp`);
  const info = { schema: 1, protocol: 1, provider: 'dsh', instanceId, pid: process.pid, runtimeVersion, ...endpoint,
    ...(callerIdentity === undefined ? {} : { callerIdentity }) };
  const roots = () => {
    const agents = ctx.agents.roots();
    if (!Array.isArray(agents)) throw failure('PROTOCOL_ERROR', 'Harness live root registry is unavailable.');
    return agents;
  };
  const root = (id) => {
    const agent = ctx.agents.get(id);
    return agent !== undefined && roots().some((item) => item === agent) ? agent : undefined;
  };
  const thread = (agent) => {
    const header = agent.session?.header;
    if (typeof agent.id !== 'string' || agent.id === '' || !isRecord(header) || header.id !== agent.id
      || !['idle', 'running'].includes(agent.status) || !Number.isSafeInteger(header.createdAt) || header.createdAt < 0) {
      throw failure('PROTOCOL_ERROR', 'Harness live root metadata does not match the bridge contract.');
    }
    const workingDirectory = ctx.get('workingDirectory');
    const projections = ctx.get('sessionProjections');
    const cwd = workingDirectory === undefined ? null : workingDirectory.get(agent.session);
    const title = projections === undefined ? null : projections.stateOf(agent.session, 'title') ?? null;
    if ((cwd !== null && typeof cwd !== 'string') || (title !== null && title !== undefined && typeof title !== 'string')
      || (header.cwd !== undefined && typeof header.cwd !== 'string')) throw failure('PROTOCOL_ERROR', 'Harness optional root metadata has invalid fields.');
    return { id: agent.id, name: title || null, cwd, originalCwd: header.cwd ?? null, status: agent.status, createdAt: header.createdAt };
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (closed) return send(response, { error: { code: 'DSH_UNAVAILABLE' } }, 503);
      if (request.headers.origin !== undefined || request.headers.host !== new URL(url).host) return send(response, { error: { code: 'DSH_AUTH_REQUIRED' } }, 403);
      const actual = Buffer.from(typeof request.headers.authorization === 'string' ? request.headers.authorization : '');
      if (actual.length !== tokenBytes.length || !timingSafeEqual(actual, tokenBytes)) return send(response, { error: { code: 'DSH_AUTH_REQUIRED' } }, 401);
      const path = request.url ?? '';
      if (request.method === 'GET' && path === '/v1/info') return send(response, info);
      if (request.method === 'GET' && path === '/v1/sessions') return send(response, { items: roots().map(thread) });
      const matched = /^\/v1\/sessions\/([^/?#]+)(\/messages)?$/.exec(path);
      if (matched === null || !['GET', 'POST'].includes(request.method ?? '') || (request.method === 'POST') !== (matched[2] === '/messages')) return send(response, { error: { code: 'DSH_ROUTE_NOT_FOUND' } }, 404);
      let id;
      try { id = decodeURIComponent(matched[1]); } catch { throw failure('INPUT_REJECTED', 'Harness native session ID is malformed.', 400); }
      if (id === '' || id === '.' || id === '..' || Buffer.byteLength(id) > 16 * 1024) throw failure('INPUT_REJECTED', 'Harness native session ID is invalid.', 400);
      if (request.method === 'GET') { const agent = root(id); return send(response, { item: agent === undefined ? null : thread(agent) }); }
      if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw failure('INPUT_REJECTED', 'Harness bridge requires application/json.', 415);
      const input = await body(request);
      if (closed || request.aborted) return;
      const agent = root(id);
      if (agent === undefined) return send(response, { error: { code: 'DSH_SESSION_NOT_FOUND', sessionId: id } }, 404);
      const message = host.createUserMessage({ content: [{ type: 'text', text: input.text }], source: { kind: 'user' } });
      if (!isRecord(message) || typeof message.id !== 'string' || message.id === '' || message.role !== 'user') throw failure('PROTOCOL_ERROR', 'Harness did not construct an identified user message.');
      // No await between identity recheck and synchronous native admission.
      if (root(id) !== agent) return send(response, { error: { code: 'DSH_SESSION_NOT_FOUND', sessionId: id } }, 404);
      try { if (input.mode === 'steer') agent.steer(message); else agent.followup(message); }
      catch { throw failure('WRITE_UNCERTAIN', 'Harness native admission could not be confirmed.'); }
      return send(response, { accepted: true, sessionId: id, messageId: message.id, mode: input.mode });
    })().catch((error) => send(response, { error: { code: typeof error?.code === 'string' && error.code.startsWith('DSH_') ? error.code : 'DSH_PROTOCOL_ERROR' } }, Number.isInteger(error?.status) ? error.status : 500));
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  const close = () => closing ??= (async () => {
    closed = true;
    // Each release is independent: one failure never skips the rest, and every
    // failure is reported once all of them were attempted.
    const failures = [];
    const attempt = async (step) => { try { await step(); } catch (error) { failures.push(error); } };
    const release = releaseCallerIdentity;
    releaseCallerIdentity = undefined;
    await attempt(() => release?.());
    await attempt(() => callerIdentityScope?.dispose());
    await attempt(async () => {
      const stopped = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await stopped;
    });
    // Only after the socket is gone, and only this instance's own record.
    await attempt(async () => {
      if (!published) return;
      // Never remove a replacement record, or any other plugin's registration.
      try {
        const details = await lstat(file);
        if (!details.isFile() || details.isSymbolicLink() || details.size > 64 * 1024) return;
        const current = JSON.parse(await readFile(file, 'utf8'));
        if (current?.instanceId === instanceId && current?.token === token && current?.pid === process.pid) await unlink(file);
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    });
    if (failures.length > 0) throw withCleanup(failures[0], failures.slice(1));
  })();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (address === null || typeof address === 'string') throw failure('UNAVAILABLE', 'Harness bridge did not acquire a loopback port.');
    url = `http://127.0.0.1:${address.port}`;
    if (callerIdentity !== undefined) {
      const contribute = (scope) => {
        if (closed) return;
        const service = scope.get('shellEnv');
        if (typeof service?.register !== 'function') return;
        let active = true;
        const unregister = service.register({
          name: 'crosschat-source',
          variables: {
            DSH_CROSSCHAT_INSTANCE_ID: { description: 'Crosschat bridge instance serving this native root execution.' },
            DSH_CROSSCHAT_HOME: { description: 'Crosschat state home for the current native bridge instance.' },
          },
          resolve(execution) {
            const agent = execution.agent;
            const id = agent?.session?.header?.id;
            // The registry rebuilds this namespace for each actual tool call.
            // Old scopes and same-ID replacement agents cannot supply a marker.
            if (!active || closed || typeof id !== 'string' || root(id) !== agent) return {};
            return { DSH_CROSSCHAT_INSTANCE_ID: instanceId, DSH_CROSSCHAT_HOME: home };
          },
        });
        const release = () => {
          if (!active) return;
          active = false;
          unregister();
          if (releaseCallerIdentity === release) releaseCallerIdentity = undefined;
        };
        releaseCallerIdentity = release;
        scope.effect(() => release);
      };
      // A child dependency scope follows late registration and replacement without
      // restarting the receiving bridge. ctx.get() alone is only a boot-time read.
      if (typeof ctx.inject === 'function') callerIdentityScope = ctx.inject(['shellEnv'], contribute);
      else contribute(ctx);
    }
    const handle = await open(temporary, 'wx', 0o600);
    temporaryOwned = true;
    try { await handle.writeFile(JSON.stringify({ ...info, url, token, createdAt: Date.now() })); await handle.sync(); }
    finally { await handle.close(); }
    await link(temporary, file);
    published = true;
    await unlink(temporary);
    ctx.effect(() => close);
    return { close };
  } catch (error) {
    // The mount failure stays the reason: close and the temporary registration are
    // both still attempted, and their failures ride on its cause.
    const failures = [];
    try { await close(); } catch (failure) { failures.push(failure); }
    if (temporaryOwned) {
      try { await unlink(temporary); } catch (failure) { if (failure?.code !== 'ENOENT') failures.push(failure); }
    }
    throw withCleanup(error, failures);
  }
}
