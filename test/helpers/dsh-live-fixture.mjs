import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import * as zlib from 'node:zlib';
import { createDshMockModel } from './dsh-mock-model.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (text) => text.slice(-128000);

/** Read the stopped fixture's native chat files; hash the original stored bytes. */
export async function snapshotDshStoredChats(root, expectedTexts = []) {
  const hashes = {}, observed = new Set();
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Unexpected link in owned session data');
      const file = join(directory, entry.name), key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(file, `${key}/`);
      else if (entry.isFile()) {
        const bytes = await readFile(file);
        hashes[key] = createHash('sha256').update(bytes).digest('hex');
        if (expectedTexts.length && /^session\.v4\.jsonl(?:\.zstd)?$/.test(entry.name)) {
          let content = bytes;
          if (entry.name.endsWith('.zstd')) {
            if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('This Node runtime cannot inspect native zstd conversation data');
            content = zlib.zstdDecompressSync(bytes, { maxOutputLength: 16 * 1024 * 1024 });
          }
          for (const text of expectedTexts) if (content.includes(text)) observed.add(text);
        }
      }
    }
  }
  try {
    await visit(root);
    if (!expectedTexts.every((text) => observed.has(text))) throw new Error('Native persistence fixture did not locate the expected test conversation content');
  } catch (error) { throw Object.assign(error, { category: 'infrastructure' }); }
  return hashes;
}

export function classifyDshStartupFailure(evidence) {
  const lines = String(evidence.stderr ?? '').split(/\r?\n/);
  if (lines.some((line) => /crosschat-dsh-bridge/.test(line) && /failed to import|failed to activate|failed to load|missing.*\bagents\b/i.test(line))) return { category: 'compatibility', check: 'production-bridge-load' };
  if (lines.some((line) => /crosschat-dsh-test-driver/.test(line) && /missing.*(?:sessionController|webServer)/i.test(line))) return { category: 'infrastructure', check: 'fixture-session-controller' };
  if (lines.some((line) => /crosschat-dsh-test-driver/.test(line) && /failed to import|failed to activate|failed to load/i.test(line))) return { category: 'infrastructure', check: 'fixture-driver-load' };
  return { category: 'infrastructure', check: evidence.processAlive === false ? 'runtime-process' : 'runtime-readiness' };
}

function readDshNativeIdentity(requests, expected) {
  const strings = (value) => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  const results = requests.flatMap((request) => (request.messages ?? []).flatMap((message) => Array.isArray(message.content) ? message.content.filter((item) => item.type === 'tool_result') : []));
  if (!results.length) return { ready: false, category: 'infrastructure', check: 'model-tool-result' };
  const parsed = results.flatMap(strings).flatMap((value) => { try { const result = JSON.parse(value.trim()); return isRecord(result) ? [result] : []; } catch { return []; } });
  if (!parsed.length) return { ready: false, category: 'infrastructure', check: 'native-shell-bootstrap' };
  const identities = parsed.filter((identity) => identity.session === expected.session && identity.profile === expected.profile && identity.dshHome === expected.dshHome);
  if (identities.length) return { ready: true, identities };
  return { ready: false, category: 'compatibility', check: 'native-shell-identity' };
}

export function assessDshNativeIdentity(requests, expected) {
  const observed = readDshNativeIdentity(requests, expected);
  return observed.ready ? { ready: true } : observed;
}

/** Native shellEnv must prove the live instance; an absent contribution remains a capability failure. */
export function assessDshCallerSourceIdentity(requests, expected) {
  const observed = readDshNativeIdentity(requests, expected);
  if (!observed.ready) return observed;
  for (const identity of observed.identities) {
    const source = identity.callerSource;
    if (identity.callerSourceExit !== 0 || !isRecord(source) || source.status !== 'identified' || source.sourceTool !== 'dsh'
      || source.basis !== 'native' || source.association !== 'verified' || source.scope !== 'instance' || source.shouldAsk !== false
      || source.context !== undefined || source.promptClaim !== undefined || source.confirmationCommand !== undefined) continue;
    return { ready: true, source: { status: source.status, sourceTool: source.sourceTool, basis: source.basis,
      association: source.association, scope: source.scope, shouldAsk: source.shouldAsk } };
  }
  return { ready: false, category: 'compatibility', check: 'native-shell-caller-source' };
}

/** Deliberately omit paths, native IDs, tokens, fingerprints and free-form error text. */
export function diagnoseDshCallerSource(requests, expected) {
  const observed = readDshNativeIdentity(requests, expected);
  if (!observed.ready) return { nativeIdentityMatched: false };
  const identity = observed.identities.at(-1);
  const source = {};
  for (const [key, allowed] of Object.entries({ status: ['identified', 'confirmed', 'human', 'unresolved', 'unavailable', 'review-required', 'conflict', 'confirmation-required'],
    sourceTool: ['dsh', 'dsh-desktop'], basis: ['native', 'user'], association: ['verified', 'unavailable'], scope: ['origin', 'instance'] })) {
    if (allowed.includes(identity.callerSource?.[key])) source[key] = identity.callerSource[key];
  }
  const code = identity.callerSource?.code;
  if (typeof code === 'string' && /^(?:DSH_|SOURCE_|CALLER_SOURCE_)[A-Z_]{1,70}$/.test(code)) source.code = code;
  if (typeof identity.callerSource?.shouldAsk === 'boolean') source.shouldAsk = identity.callerSource.shouldAsk;
  const input = {};
  for (const key of ['shellFlagExpected', 'instanceMarkerValid', 'stateHomeAbsolute', 'profileDirAbsolute']) {
    if (typeof identity.callerSourceInput?.[key] === 'boolean') input[key] = identity.callerSourceInput[key];
  }
  return { nativeIdentityMatched: true, sourceExit: Number.isSafeInteger(identity.callerSourceExit) ? identity.callerSourceExit : null, source, input };
}

export async function prepareDshProfile(root, modelURL) {
  let endpoint;
  try { endpoint = new URL(modelURL); } catch { /* Rejected below before any writes. */ }
  if (!endpoint || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/v1' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw Object.assign(new Error('DSH fixture model must be an exact loopback /v1 endpoint'), { code: 'INVALID_MODEL_ENDPOINT' });
  }
  if (!isAbsolute(root)) throw new Error('DSH fixture root must be absolute');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|LANG|LC_.*|TERM|COLORTERM|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|ProgramFiles.*|SYSTEMDRIVE|PROGRAMDATA|OS)$/i.test(name)));
  const profile = join(root, 'profile');
  Object.assign(env, {
    HOME: profile, USERPROFILE: profile, DSH_HOME: join(root, 'dsh-home'), DSH_AGENTS_HOME: join(root, 'agents-home'),
    APPDATA: join(profile, 'appdata'), LOCALAPPDATA: join(profile, 'localappdata'),
    XDG_CACHE_HOME: join(profile, 'cache'), XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'), XDG_STATE_HOME: join(profile, 'state'),
    TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'),
    npm_config_userconfig: join(root, 'npmrc'), npm_config_globalconfig: join(root, 'global-npmrc'), npm_config_cache: join(root, 'npm-cache'),
    npm_config_store_dir: join(root, 'pnpm-store'), npm_config_enable_global_virtual_store: 'false',
    COREPACK_HOME: join(root, 'corepack'), PNPM_HOME: join(root, 'pnpm-home'),
    DEEPSEEK_BASE_URL: modelURL, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1',
    // Deterministic fixture commands are the only model outputs; no interactive approvals or actual model reasoning.
    DSH_PERMISSION_MODE: 'danger-full-access', NO_COLOR: '1', CI: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
  });
  if (process.platform === 'win32') { env.HOMEDRIVE = profile.slice(0, 2); env.HOMEPATH = profile.slice(2); }
  const directories = ['profile', 'tmp', 'dsh-home', 'agents-home', 'workspace/.git', 'profile/appdata', 'profile/localappdata', 'profile/cache', 'profile/config', 'profile/data', 'profile/state'];
  await Promise.all(directories.map((directory) => mkdir(join(root, directory), { recursive: true })));
  await Promise.all(['npmrc', 'global-npmrc', 'gitconfig'].map((name) => writeFile(join(root, name), '')));
  return env;
}

export async function pollDsh(read, description, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let failure;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; }
    catch (error) { if (error?.terminal) throw error; failure = error; }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}${failure ? ` (${String(failure)})` : ''}`);
}

export function runDshCommand(binary, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd ?? repositoryRoot, env: options.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeout ?? 30000);
    child.stdout.on('data', (chunk) => { stdout = bounded(stdout + chunk); });
    child.stderr.on('data', (chunk) => { stderr = bounded(stderr + chunk); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); done({ code, signal, timedOut, stdout, stderr, pid: child.pid }); });
    child.stdin.end(options.input ?? '');
  });
}

export function dshNodeCommand(args) {
  const quote = (value) => `'${String(value).replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`;
  return `${process.platform === 'win32' ? '& ' : ''}${[process.execPath, ...args].map(quote).join(' ')}`;
}

export function dshShellCommand(args) { return dshNodeCommand([join(repositoryRoot, 'dist', 'cli.js'), ...args]); }

/** Runs inside the ordinary native Bash/pwsh tool, inheriting its actual bridge contribution unchanged. */
export function dshIdentityBootstrapCommand() {
  return dshNodeCommand(['--input-type=module', '-e', `
    import {spawnSync} from 'node:child_process';
    import {isAbsolute} from 'node:path';
    const result = spawnSync(process.execPath, [${JSON.stringify(join(repositoryRoot, 'dist', 'cli.js'))}, 'identity'],
      {encoding:'utf8', timeout:15000, windowsHide:true});
    let callerSource = null;
    try { callerSource = JSON.parse(result.stdout); } catch {}
    console.log(JSON.stringify({session:process.env.DSH_SESSION_ID, profile:process.env.DSH_PROFILE,
      dshHome:process.env.DSH_HOME, callerSourceExit:result.status, callerSource,
      callerSourceInput:{shellFlagExpected:process.env.DSH_SHELL === '1',
        instanceMarkerValid:/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(process.env.DSH_CROSSCHAT_INSTANCE_ID ?? ''),
        stateHomeAbsolute:isAbsolute(process.env.DSH_CROSSCHAT_HOME ?? ''),
        profileDirAbsolute:isAbsolute(process.env.DSH_PROFILE_DIR ?? '')}}));
  `]);
}

/** Requires an already installed official npm runtime; this function never downloads or globally installs software. */
export async function createDshFixture(options, respond) {
  if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required to launch official Harness');
  for (const value of [options?.runtime, options?.parentRoot]) if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('DSH runtime and owned parent root must be absolute');
  const parent = await realpath(options.parentRoot);
  const entry = join(await realpath(options.runtime), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const pnpm = join(options.runtime, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  await Promise.all([access(entry), access(pnpm)]);
  const root = await realpath(await mkdtemp(join(parent, 'run-')));
  const owner = randomUUID();
  await writeFile(join(root, '.fixture-owner'), owner);
  let model; let env; let child; let control; let stopping; let closing; let unsafe = false;
  const logs = { stdout: '', stderr: '' };
  const cleanup = { runtimeStopped: false, registrationRemoved: false, removed: false, forced: false };
  const controllerPath = join(root, 'controller.json');
  const launcher = join(root, 'official-launcher.mjs');
  const token = randomBytes(32).toString('hex');
  const workspace = join(root, 'workspace');
  const fixture = {
    root, workspace, entry, cleanup, logs, installation: undefined,
    get env() { return env; }, get model() { return model; }, get info() { return control; }, get pid() { return child?.pid; },
    async controller(path, body, timeout = 30000) {
      if (!control) throw new Error('DSH controller is not ready');
      const response = await globalThis.fetch(new URL(path, control.url), {
        method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: globalThis.AbortSignal.timeout(timeout),
      });
      const text = await response.text();
      if (!response.ok) throw Object.assign(new Error(`DSH test controller ${path}: HTTP ${response.status} ${text.slice(0, 1000)}`), { category: 'infrastructure', check: 'fixture-session-controller' });
      return text ? JSON.parse(text) : null;
    },
    async createSession(title) { return fixture.controller('/sessions', { title }); },
    async prompt(id, text) { return fixture.controller(`/sessions/${encodeURIComponent(id)}/prompt`, { text, requestId: randomUUID() }); },
    async snapshot(id) { return fixture.controller(`/sessions/${encodeURIComponent(id)}`); },
    async idle(id) { await fixture.controller(`/sessions/${encodeURIComponent(id)}/idle`, {}, 60000); },
    async cli(args, input) { return runDshCommand(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), ...args], { env, cwd: workspace, input }); },
    /** Stop owned runtime resources while retaining profile/chat files for native maintenance checks. */
    async stop() {
      return stopping ??= (async () => {
        const failures = [];
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = new Promise((done) => child.once('close', done));
          try {
            // The test controller emits SIGTERM in its own process, allowing the official shutdown handler to dispose plugins on Windows.
            await fixture.controller('/shutdown', {});
            let timer;
            try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Harness did not complete owned shutdown')), 15000); })]); }
            finally { clearTimeout(timer); }
          } catch (error) {
            cleanup.forced = true; unsafe = true; child.kill(); failures.push(error);
            let timer;
            try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Forced owned Harness process exit was not observed')), 5000); })]); }
            catch (failure) { failures.push(failure); }
            finally { clearTimeout(timer); }
          }
        }
        cleanup.runtimeStopped = !child || child.exitCode !== null || child.signalCode !== null;
        if (child && (child.exitCode !== 0 || child.signalCode !== null)) { unsafe = true; failures.push(new Error('Harness did not exit naturally with code zero')); }
        if (model) { try { await model.close(); } catch (error) { failures.push(error); } }
        if (env) {
          try { cleanup.registrationRemoved = (await readdir(join(env.HOME, '.crosschat', 'dsh', 'instances'))).filter((name) => name.endsWith('.json')).length === 0; }
          catch (error) { if (error.code === 'ENOENT') cleanup.registrationRemoved = true; else failures.push(error); }
        } else cleanup.registrationRemoved = true;
        if (!cleanup.runtimeStopped || !cleanup.registrationRemoved || unsafe) failures.push(new Error('Runtime cleanup is incomplete; the owned run directory is retained'));
        if (failures.length) throw new AggregateError(failures, 'Harness fixture teardown failed');
      })();
    },
    async close() {
      return closing ??= (async () => {
        await fixture.stop();
        const target = await realpath(root);
        const childPath = relative(parent, target);
        if (target !== root || !childPath || childPath.startsWith(`..${sep}`) || childPath === '..' || isAbsolute(childPath) || !basename(target).startsWith('run-') || await readFile(join(root, '.fixture-owner'), 'utf8') !== owner) throw new Error('Unsafe Harness fixture cleanup target');
        await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); cleanup.removed = true;
      })();
    },
  };
  try {
    model = await createDshMockModel(respond);
    env = await prepareDshProfile(root, model.url);
    await writeFile(launcher, `import {runCli} from ${JSON.stringify(pathToFileURL(entry).href)};\nawait runCli({packageManager:{command:process.execPath,args:[${JSON.stringify(pnpm)}]}});\n`);
    const installed = await runDshCommand(process.execPath, [launcher, 'plugin', '--profile', 'web', 'add', `file:${join(repositoryRoot, 'integrations', 'dsh')}`, '--offline', '--ignore-scripts'], { env, cwd: workspace, timeout: 120000 });
    fixture.installation = { code: installed.code, timedOut: installed.timedOut, stdout: installed.stdout, stderr: installed.stderr };
    if (installed.timedOut) { unsafe = true; throw new Error('Official plugin installation timed out; package-manager descendants may remain'); }
    if (installed.code !== 0 || installed.signal !== null) throw Object.assign(new Error(`Official Harness plugin add failed: ${installed.stderr.slice(-5000)}`), { check: 'official-bundle-installation', category: 'infrastructure' });
    const manifest = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles', 'web', 'package.json'), 'utf8'));
    if (!isRecord(manifest.dependencies) || !Object.hasOwn(manifest.dependencies, '@crosschat/dsh-bridge') || !manifest.dsh?.profile?.bundles?.includes('@crosschat/dsh-bridge')) throw Object.assign(new Error('Official plugin add did not select the production bridge bundle'), { check: 'official-bundle-selection', category: 'compatibility' });
    const driver = join(root, 'driver.mjs');
    // An external test file is outside the runtime package graph. Resolve the official public dependency
    // through the actual installation, rather than altering its node_modules or adding global NODE_PATH.
    const appBoot = pathToFileURL(createRequire(entry).resolve('@deepseek-ai/dsh-app-boot')).href;
    const source = await readFile(new URL('./dsh-runtime-driver.mjs', import.meta.url), 'utf8');
    await writeFile(driver, source.replace("from '@deepseek-ai/dsh-app-boot'", `from ${JSON.stringify(appBoot)}`));
    const patch = [
      { id: 'session-title-llm', disabled: true },
      { id: 'crosschat-dsh-bridge', config: { home: env.HOME } },
      { insert: [{ id: 'crosschat-dsh-test-driver', name: pathToFileURL(driver).href, config: { path: controllerPath, token, workspace } }] },
    ];
    const patchPath = join(root, 'fixture.patch.yml');
    await writeFile(patchPath, JSON.stringify(patch));
    child = spawn(process.execPath, [launcher, '--profile', 'web', '--patch', patchPath, '--no-open', '--host', '127.0.0.1', '--port', '0'], { env, cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { logs.stdout = bounded(logs.stdout + chunk); });
    child.stderr.on('data', (chunk) => { logs.stderr = bounded(logs.stderr + chunk); });
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    control = await pollDsh(async () => {
      if (spawnError) throw Object.assign(spawnError, { terminal: true });
      const assessment = classifyDshStartupFailure({ processAlive: child.exitCode === null && child.signalCode === null, stderr: logs.stderr });
      if (assessment.check !== 'runtime-readiness') throw Object.assign(new Error(`Harness startup check failed: ${assessment.check}`), { ...assessment, terminal: true });
      let value;
      try { value = JSON.parse(await readFile(controllerPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (!isRecord(value) || value.schema !== 1 || value.pid !== child.pid || typeof value.version !== 'string' || value.token !== token || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(value.url)) throw Object.assign(new Error('Harness driver published an invalid ownership record'), { terminal: true, category: 'infrastructure', check: 'fixture-driver-registration' });
      return value;
    }, 'official Web runtime and fixture controller');
    const ready = await fixture.controller('/health');
    if (ready.pid !== child.pid || ready.version !== control.version || ready.schema !== 1) throw new Error('Harness controller health does not belong to the owned runtime');
    return fixture;
  } catch (error) {
    if (!error.category) Object.assign(error, classifyDshStartupFailure({ processAlive: child?.exitCode === null && child?.signalCode === null, stderr: logs.stderr }));
    await fixture.close().catch((failure) => { error.cleanup = failure.message; });
    throw Object.assign(error, { logs, fixtureRoot: cleanup.removed ? undefined : root, cleanup });
  }
}
