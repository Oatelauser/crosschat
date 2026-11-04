import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { createMockModel } from './opencode-mock-model.mjs';
import { assessStartupEvidence } from '../../scripts/opencode-compat-report.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const prefix = 'crosschat-opencode-compat-';

export async function poll(read, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; }
    catch (error) { if (error?.terminal === true) throw error; lastError = error; }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ''}`);
}

export function isolatedEnvironment(root) {
  // Do not expose model keys, GitHub tokens, user config overrides or caller identities to tested code.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|LANG|LC_.*|TERM|COLORTERM|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|ProgramFiles.*|SYSTEMDRIVE|PROGRAMDATA|OS)$/i.test(key)));
  return {
    ...env, HOME: root, USERPROFILE: root, APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
    XDG_CACHE_HOME: join(root, 'cache'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'),
    OPENCODE_CONFIG_DIR: join(root, 'config', 'opencode'), OPENCODE_DB: join(root, 'opencode.db'), OPENCODE_TEST_HOME: root,
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_MODELS_PATH: join(root, 'models.json'),
    OPENCODE_DISABLE_FILEWATCHER: 'true', OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_FFF: 'true',
    OPENCODE_CONFIG_PROJECT_DISABLE: 'true', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    NO_COLOR: '1',
  };
}

export function runCommand(binary, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const watchReadiness = options.readyLine !== undefined;
    if (watchReadiness && (typeof options.readyLine !== 'string' || !options.readyLine.length || options.readyLine.length > 1023 || /[\r\n]/u.test(options.readyLine))) throw new Error('Command readiness must be a single nonempty line of at most 1023 characters');
    if (watchReadiness && (!Number.isSafeInteger(options.startupTimeout ?? 30000) || (options.startupTimeout ?? 30000) < 1)) throw new Error('Command startup timeout must be a positive integer');
    const child = spawn(binary, args, { env: options.env, cwd: options.cwd ?? repositoryRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    let ready = false; let finished = false; let timeoutStage;
    let pendingLine = ''; let discardLine = false;
    const expire = () => {
      if (finished || timedOut) return;
      timedOut = true; timeoutStage = watchReadiness && !ready ? 'startup' : 'command';
      child.kill();
    };
    let timeout = setTimeout(expire, watchReadiness ? options.startupTimeout ?? 30000 : options.timeout ?? 30000);
    const readStdout = (chunk) => { stdout += chunk.toString(); };
    const readStderr = (chunk) => {
      const text = chunk.toString(); stderr += text;
      if (!watchReadiness || ready || timedOut || finished) return;
      // Only the complete controlled stderr line starts the operation budget, once.
      for (const character of text) {
        if (character === '\n') {
          if (!discardLine && pendingLine.replace(/\r$/u, '') === options.readyLine) {
            ready = true; clearTimeout(timeout); timeout = setTimeout(expire, options.timeout ?? 30000);
            pendingLine = ''; return;
          }
          pendingLine = ''; discardLine = false;
        } else if (!discardLine) {
          if (pendingLine.length === 1024) { pendingLine = ''; discardLine = true; }
          else pendingLine += character;
        }
      }
    };
    const release = () => {
      finished = true; clearTimeout(timeout);
      child.stdout.off('data', readStdout); child.stderr.off('data', readStderr);
      child.off('error', onError); child.off('close', onClose);
    };
    const onError = (error) => { release(); reject(error); };
    const onClose = (code, signal) => {
      release();
      resolveRun({ code, signal, stdout, stderr, timedOut, ...(watchReadiness ? { ready, ...(timedOut ? { timeoutStage } : {}) } : {}) });
    };
    child.stdout.on('data', readStdout); child.stderr.on('data', readStderr);
    child.once('error', onError); child.once('close', onClose);
    child.stdin.end(options.input ?? '');
  });
}

function config(modelURL) {
  return {
    update: 'disable', model: 'test/test-model',
    providers: { test: {
      name: 'Crosschat compatibility fixture', package: 'aisdk:@ai-sdk/openai-compatible',
      settings: { apiKey: 'test-key-with-no-permissions', baseURL: modelURL },
      models: { 'test-model': { name: 'Scripted test model', capabilities: { tools: true, input: ['text'], output: ['text'] }, cost: { input: 0, output: 0 }, limit: { context: 100000, output: 10000 } } },
    } },
  };
}

async function availablePort() {
  const listener = createServer();
  await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
  const address = listener.address();
  await new Promise((done, reject) => listener.close((error) => error ? reject(error) : done()));
  if (!address || typeof address === 'string') throw new Error('Fixture could not reserve a service port');
  return address.port;
}

export async function createOpenCodeFixture(binary, respond) {
  if (!binary || !isAbsolute(binary)) throw new Error('OPENCODE_BIN must be an absolute path to an already downloaded official binary');
  await access(binary);
  const temp = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temp, prefix)));
  const ownership = randomUUID();
  await writeFile(join(root, '.fixture-owner'), ownership);
  const env = isolatedEnvironment(root);
  const workspace = join(root, 'workspace');
  const registrationFile = join(env.XDG_STATE_HOME, 'opencode', 'service.json');
  let child; let model; let info; let closed = false;
  const processIds = [];
  const logs = { stdout: '', stderr: '' };
  async function stopService() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((done) => child.once('close', done));
    let timeout;
    try {
      if (info?.pid === child.pid) await runCommand(binary, ['service', 'stop'], { env, cwd: workspace, timeout: 10000 });
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Owned OpenCode process ${child.pid} did not stop`)), 10000); })]);
    } finally { clearTimeout(timeout); }
  }
  async function startService() {
    child = spawn(binary, ['serve', '--service'], { env, cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    processIds.push(child.pid);
    child.stdout.on('data', (chunk) => { logs.stdout = (logs.stdout + chunk.toString()).slice(-128000); });
    child.stderr.on('data', (chunk) => { logs.stderr = (logs.stderr + chunk.toString()).slice(-128000); });
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    const startupError = (assessment) => Object.assign(new Error(`OpenCode startup check failed: ${assessment.check}`), { category: assessment.category, check: assessment.check, terminal: !assessment.retry });
    info = await poll(async () => {
      if (spawnError) throw spawnError;
      let value; let registrationExists = false;
      try { const content = await readFile(registrationFile, 'utf8'); registrationExists = true; value = JSON.parse(content); }
      catch (error) { if (error.code !== 'ENOENT' && !registrationExists) throw error; }
      const assessment = assessStartupEvidence({ processAlive: child.exitCode === null && child.signalCode === null, expectedPid: child.pid, registrationExists, registration: value });
      // An existing registration must belong to the exact child before any request is sent.
      if (assessment.check === 'service-registration-schema' || assessment.check === 'service-process') throw startupError(assessment);
      return registrationExists && value?.pid === child.pid ? value : undefined;
    }, 'owned service registration', 60000);
    await poll(async () => {
      let response; let body;
      try {
        response = await globalThis.fetch(new URL('/api/info', info.url), { headers: { authorization: `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}` }, signal: globalThis.AbortSignal.timeout(1000) });
        body = await response.json().catch(() => undefined);
      } catch { /* A healthy baseline distinguishes transient readiness from candidate contract drift. */ }
      const assessment = assessStartupEvidence({ processAlive: child.exitCode === null && child.signalCode === null, expectedPid: child.pid, registrationExists: true, registration: info, responseStatus: response?.status, responseBody: body });
      if (assessment.ready) return body;
      if (!assessment.retry) throw startupError(assessment);
      return undefined;
    }, 'authenticated service readiness', 60000);
  }
  const fixture = {
    root, env, workspace, logs, binary, processIds,
    get model() { return model; },
    get info() { return info; },
    get pid() { return child?.pid; },
    async api(path, options = {}) {
      if (!info) throw new Error('Service is not ready');
      const response = await globalThis.fetch(new URL(path, info.url), {
        ...options,
        headers: { authorization: `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}`, 'content-type': 'application/json', ...options.headers },
        signal: options.signal ?? globalThis.AbortSignal.timeout(20000),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`OpenCode ${options.method ?? 'GET'} ${path}: HTTP ${response.status} ${text.slice(0, 1000)}`);
      return text ? JSON.parse(text) : null;
    },
    async cli(args, input) {
      return runCommand(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), ...args], { env, cwd: workspace, input });
    },
    async createSession(title) {
      const result = await fixture.api('/api/session', { method: 'POST', body: { title, location: { directory: workspace }, model: { providerID: 'test', id: 'test-model' }, permissions: [{ action: '*', resource: '*', effect: 'allow' }] } });
      if (typeof result?.data?.id !== 'string') throw new Error('Session create returned no id');
      return result.data;
    },
    async prompt(id, text) { return fixture.api(`/api/session/${encodeURIComponent(id)}/prompt`, { method: 'POST', body: { text } }); },
    async transcript(id) {
      const result = await fixture.api(`/api/experimental/session/${encodeURIComponent(id)}/export`);
      if (!Array.isArray(result?.data?.messages)) throw new Error('Session export returned no messages');
      return result.data.messages;
    },
    async idle(id) { await fixture.api(`/api/experimental/session/${encodeURIComponent(id)}/wait`, { method: 'POST', body: {}, signal: globalThis.AbortSignal.timeout(60000) }); },
    async restart() { await stopService(); info = undefined; await startService(); },
    async close() {
      if (closed) return;
      closed = true;
      const failures = [];
      // Kill only the exact child this fixture owns. Never enumerate processes by executable name.
      try { await stopService(); } catch (error) { failures.push(error); }
      if (model) { try { await model.close(); } catch (error) { failures.push(error); } }
      try {
        const target = await realpath(root);
        const within = relative(temp, target);
        if (target !== root || !within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)
          || !basename(target).startsWith(prefix) || await readFile(join(target, '.fixture-owner'), 'utf8') !== ownership) throw new Error('Refusing to remove a fixture outside its verified temporary root');
        if (failures.length) throw new AggregateError(failures, 'Fixture resources did not stop; retained owned directory');
        await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'OpenCode fixture cleanup failed');
    },
  };
  try {
    model = await createMockModel(respond);
    await mkdir(env.OPENCODE_CONFIG_DIR, { recursive: true });
    await mkdir(workspace);
    await Promise.all([writeFile(join(root, 'models.json'), '{}'), writeFile(join(root, 'gitconfig'), ''), writeFile(join(env.OPENCODE_CONFIG_DIR, 'opencode.json'), JSON.stringify(config(model.url))), writeFile(join(env.OPENCODE_CONFIG_DIR, 'service.json'), JSON.stringify({ hostname: '127.0.0.1', port: await availablePort() }))]);
    await startService();
    return fixture;
  } catch (error) {
    await fixture.close().catch((cleanup) => { error.cleanup = String(cleanup); });
    throw Object.assign(new Error(`OpenCode fixture setup failed: ${String(error)}\n${logs.stderr.slice(-12000)}`, { cause: error }), { category: error.category ?? 'infrastructure', check: error.check ?? 'service-process' });
  }
}

export function shellQuote(value) { return `'${String(value).replaceAll('\\', '/').replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`; }
export function crosschatShell(args) { return `${process.platform === 'win32' ? '& ' : ''}${[process.execPath, join(repositoryRoot, 'dist', 'cli.js'), ...args].map(shellQuote).join(' ')}`; }
export function userText(body) { return (body?.messages ?? []).filter((message) => message.role === 'user').map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n'); }
