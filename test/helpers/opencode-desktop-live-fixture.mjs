import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, parse, relative, sep } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import { isolatedEnvironment, repositoryRoot, runCommand } from './opencode-live-fixture.mjs';
import { createMockModel } from './opencode-mock-model.mjs';
import { desktopStartupFailure, parseDesktopServiceRegistration, probeDesktopService } from './opencode-desktop-service-probe.mjs';

export function createDesktopEnvironment(root) {
  const profile = join(root, 'profile');
  const testRoot = join(profile, '.local');
  const drive = parse(profile).root;
  return {
    ...isolatedEnvironment(profile),
    HOME: profile, USERPROFILE: profile, OPENCODE_TEST_HOME: profile, OPENCODE_DESKTOP_TEST_ROOT: testRoot,
    APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
    TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'),
    ...(process.platform === 'win32' ? { HOMEDRIVE: drive.slice(0, 2), HOMEPATH: profile.slice(2) } : {}),
    XDG_DATA_HOME: join(testRoot, 'data'), XDG_CONFIG_HOME: join(testRoot, 'config'),
    XDG_CACHE_HOME: join(testRoot, 'cache'), XDG_STATE_HOME: join(testRoot, 'state'),
    OPENCODE_CONFIG_DIR: join(testRoot, 'config', 'opencode'), OPENCODE_DB: join(testRoot, 'data', 'opencode', 'opencode.db'),
    OPENCODE_MODELS_PATH: join(profile, 'models.json'), GIT_CONFIG_GLOBAL: join(profile, 'gitconfig'),
  };
}

export async function prepareDesktopProfile(root) {
  const env = createDesktopEnvironment(root);
  await Promise.all([env.HOME, env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.OPENCODE_CONFIG_DIR, dirname(env.OPENCODE_DB), join(root, 'workspace'), join(env.OPENCODE_DESKTOP_TEST_ROOT, 'desktop')].map((directory) => mkdir(directory, { recursive: true })));
  // The official fresh-profile flow can create a project in the account's Documents folder.
  // Seed its documented settings key before Electron's first synchronous profile read.
  await writeFile(join(env.OPENCODE_DESKTOP_TEST_ROOT, 'desktop', 'opencode.settings'), JSON.stringify({ firstLaunchOnboardingComplete: true }));
  return env;
}

/** Read executable metadata only. An incomplete query never authorizes removal. */
export async function inspectDesktopRunProcesses(root, env) {
  if (process.platform !== 'win32') return { state: 'unknown', processes: [], error: 'Windows CIM inspection is unavailable on this platform' };
  try {
    const target = await realpath(root);
    const prefix = `${target}${sep}`.toLowerCase();
    const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? process.env.SystemRoot;
    if (!systemRoot || !isAbsolute(systemRoot)) throw new Error('Cannot locate the system PowerShell executable');
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = [
      '$ErrorActionPreference = "Stop"',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '$ownedProcessMetadata = @(Get-CimInstance -ClassName Win32_Process | Select-Object ProcessId, ExecutablePath, ParentProcessId)',
      'ConvertTo-Json -InputObject $ownedProcessMetadata -Compress',
    ].join('\n');
    const result = await runCommand(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env, cwd: target, timeout: 5000 });
    if (result.code !== 0 || result.timedOut) throw new Error(`CIM query failed${result.stderr ? `: ${result.stderr.trim().slice(0, 1000)}` : ''}`);
    const rows = JSON.parse(result.stdout.trim());
    if (!Array.isArray(rows)) throw new Error('CIM did not return a complete process metadata array');
    const processes = [];
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.ProcessId) || row.ProcessId < 0 || !Number.isSafeInteger(row.ParentProcessId) || row.ParentProcessId < 0
        || (row.ExecutablePath !== null && typeof row.ExecutablePath !== 'string')) throw new Error('CIM returned malformed process metadata');
      // Windows hides image paths of protected/system processes. Owned test children run as this user.
      if (!row.ExecutablePath) continue;
      const path = row.ExecutablePath;
      // Native paths can contain 8.3 components. Canonicalize those before comparing the owned prefix.
      let candidate = path;
      if (path.includes('~') || path.toLowerCase().startsWith(prefix)) {
        try { candidate = await realpath(path); }
        catch (error) {
          // CIM is a snapshot. An unrelated temporary executable may disappear before
          // canonicalization; discard its row only after the exact PID is certainly gone.
          let exited = false;
          if (error?.code === 'ENOENT') {
            try { process.kill(row.ProcessId, 0); }
            catch (inspectionError) { exited = inspectionError?.code === 'ESRCH'; }
          }
          if (exited) continue;
          throw error;
        }
      }
      if (!candidate.toLowerCase().startsWith(prefix)) continue;
      processes.push({ pid: row.ProcessId, parentPid: row.ParentProcessId, executablePath: candidate });
    }
    return { state: processes.length ? 'occupied' : 'clear', processes };
  } catch (error) { return { state: 'unknown', processes: [], error: error instanceof Error ? error.message : String(error) }; }
}

async function availablePort() {
  const listener = createServer();
  await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
  const address = listener.address();
  await new Promise((done, reject) => listener.close((error) => error ? reject(error) : done()));
  if (!address || typeof address === 'string') throw new Error('Desktop fixture could not reserve a port');
  return address.port;
}

async function bounded(promise, timeoutMs, description) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(description)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function collectDesktopLogs(root) {
  const files = {};
  const errors = [];
  const unavailable = (file, error) => errors.push({ path: relative(root, file), code: typeof error?.code === 'string' ? error.code : 'UNKNOWN', message: String(error?.message ?? error).slice(0, 1000) });
  const visit = async (directory, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') unavailable(directory, error); return; }
    for (const entry of entries.slice(0, 20)) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.log')) {
        let handle;
        try {
          handle = await open(file, 'r');
          const stat = await handle.stat();
          const budget = 64 * 1024;
          const buffer = Buffer.alloc(Math.min(stat.size, budget));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, stat.size - budget));
          let start = 0;
          // A tail may begin inside a UTF-8 character; omit its continuation bytes.
          while (start < bytesRead && start < 3 && (buffer[start] & 0xc0) === 0x80) start++;
          files[relative(root, file)] = buffer.subarray(start, bytesRead).toString('utf8');
        } catch (error) { unavailable(file, error); }
        finally { if (handle) { try { await handle.close(); } catch (error) { unavailable(file, error); } } }
      }
    }
  };
  try { await visit(join(root, 'profile', '.local', 'desktop', 'logs'), 0); }
  catch (error) { unavailable(root, error); }
  return { files, errors };
}

/** Official installed Electron app only. Owns one run subtree, never the installer or its registry artifacts. */
export async function createOpenCodeDesktopFixture(binary, respond, options = {}) {
  if (process.platform !== 'win32') throw new Error('This desktop release fixture currently validates Windows only');
  if (!binary || !isAbsolute(binary) || !options.parentRoot || !isAbsolute(options.parentRoot)) throw new Error('Absolute official desktop binary and parentRoot paths are required');
  const parentRoot = await realpath(options.parentRoot);
  const desktopBinary = await realpath(binary);
  const nativeBinary = join(dirname(desktopBinary), 'resources', 'opencode-cli.exe');
  const binaryChild = relative(parentRoot, desktopBinary);
  if (!binaryChild || binaryChild === '..' || binaryChild.startsWith(`..${sep}`) || isAbsolute(binaryChild)) throw new Error('Desktop binary must belong to the owned installation root');
  await access(nativeBinary);
  const root = await realpath(await mkdtemp(join(parentRoot, 'run-')));
  const owner = randomUUID();
  await writeFile(join(root, '.desktop-fixture-owner'), owner);
  const env = createDesktopEnvironment(root);
  const workspace = join(root, 'workspace');
  const registrationFile = join(env.XDG_STATE_HOME, 'opencode', 'service.json');
  const [initialCDPPort, servicePort] = await Promise.all([availablePort(), availablePort()]);
  let cdpPort = initialCDPPort;
  const usedCDPPorts = new Set([cdpPort]);
  const logs = { stdout: '', stderr: '', desktop: {}, readiness: '' };
  let appChild; let info; let model; let cleanup; let closed = false;
  let spawnError;
  const desktopPids = [];
  const restarts = [];
  const cdp = { ready: false, targets: [], browserWebSocketUrl: undefined, error: undefined };

  function startDesktop() {
    spawnError = undefined;
    appChild = spawn(desktopBinary, [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${cdpPort}`, '--force-renderer-accessibility'], { env, cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    desktopPids.push(appChild.pid);
    appChild.stdout.on('data', (chunk) => { logs.stdout = (logs.stdout + chunk.toString()).slice(-128000); });
    appChild.stderr.on('data', (chunk) => { logs.stderr = (logs.stderr + chunk.toString()).slice(-128000); });
    appChild.once('error', (error) => { spawnError = error; });
  }

  async function stopDesktop() {
    const result = { appPid: appChild?.pid, appStopped: !alive(appChild?.pid), forcedAppStop: false };
    if (appChild && alive(appChild.pid)) {
      if (options.closeDesktop) {
        // CDP commands allow 10 seconds and disconnect can take another second.
        // Electron also needs time to finish its Windows profile/child-process shutdown.
        try { await bounded(Promise.resolve(options.closeDesktop(fixture)), 12000, 'Desktop graceful close did not finish'); }
        catch (error) { result.gracefulCloseError = String(error); }
        const deadline = Date.now() + 3000;
        while (alive(appChild.pid) && Date.now() < deadline) await delay(50);
      }
      if (alive(appChild.pid)) { result.forcedAppStop = true; appChild.kill(); }
      const deadline = Date.now() + 1000;
      while (alive(appChild.pid) && Date.now() < deadline) await delay(50);
    }
    result.appStopped = !alive(appChild?.pid);
    return result;
  }

  async function refreshService(started = Date.now()) {
    const serviceDeadline = started + 23000;
    let lastError;
    while (Date.now() < serviceDeadline) {
      if (spawnError) throw desktopStartupFailure('service-process', 'Official desktop could not start', { cause: spawnError });
      if (!alive(appChild.pid)) throw desktopStartupFailure('service-process', 'Official desktop exited before service readiness');
      try {
        info = await probeDesktopService(registrationFile, servicePort);
        logs.readiness = '';
        return info;
      } catch (error) {
        lastError = error;
        const reason = error instanceof Error ? error.message : String(error);
        logs.readiness = info?.password ? reason.replaceAll(info.password, '<redacted-service-password>') : reason;
        if (error.retry === false) throw error;
        await delay(50);
      }
    }
    throw desktopStartupFailure(lastError?.check ?? 'service-readiness', `Official desktop did not publish a healthy isolated service within 23 seconds: ${logs.readiness}`, { retry: true, cause: lastError });
  }

  async function refreshCDP(started = Date.now()) {
    Object.assign(cdp, { ready: false, targets: [], browserWebSocketUrl: undefined, error: undefined });
    const cdpDeadline = Math.min(started + 24000, Date.now() + 2500);
    while (Date.now() < cdpDeadline) {
      try {
        const response = await globalThis.fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: globalThis.AbortSignal.timeout(300) });
        const targets = await response.json();
        if (!response.ok || !Array.isArray(targets)) throw new Error('CDP target list is unavailable');
        cdp.targets = targets; cdp.ready = true; cdp.error = undefined;
        const version = await globalThis.fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: globalThis.AbortSignal.timeout(300) }).then((value) => value.json()).catch(() => undefined);
        cdp.browserWebSocketUrl = typeof version?.webSocketDebuggerUrl === 'string' ? version.webSocketDebuggerUrl : undefined;
        break;
      } catch (error) { cdp.error = String(error); await delay(50); }
    }
    return cdp;
  }

  const fixture = {
    root, workspace, env, logs, binary: desktopBinary, nativeBinary, cdp, registrationFile, onboarding: 'seeded-complete', desktopPids, restarts,
    get cdpPort() { return cdpPort; }, get info() { return info; }, get pid() { return appChild?.pid; }, get model() { return model; }, get cleanup() { return cleanup; },
    async api(path, request = {}) {
      if (!info) throw new Error('Desktop service has not become ready');
      const response = await globalThis.fetch(new URL(path, info.url), {
        ...request, headers: { authorization: `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}`, 'content-type': 'application/json', ...request.headers },
        signal: request.signal ?? globalThis.AbortSignal.timeout(20000),
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Desktop service ${request.method ?? 'GET'} ${path}: HTTP ${response.status} ${text.slice(0, 1000)}`);
      return text ? JSON.parse(text) : null;
    },
    async cli(args, input) { return runCommand(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), ...args], { env, cwd: workspace, input }); },
    async createSession(title) {
      const result = await fixture.api('/api/session', { method: 'POST', body: { title, location: { directory: workspace }, model: { providerID: 'test', id: 'test-model' }, permissions: [{ action: '*', resource: '*', effect: 'allow' }] } });
      if (typeof result?.data?.id !== 'string') throw new Error('Desktop session create returned no id');
      return result.data;
    },
    async prompt(id, text) { return fixture.api(`/api/session/${encodeURIComponent(id)}/prompt`, { method: 'POST', body: { text } }); },
    async transcript(id) { const result = await fixture.api(`/api/experimental/session/${encodeURIComponent(id)}/export`); if (!Array.isArray(result?.data?.messages)) throw new Error('Desktop transcript returned no messages'); return result.data.messages; },
    async idle(id) { await fixture.api(`/api/experimental/session/${encodeURIComponent(id)}/wait`, { method: 'POST', body: {}, signal: globalThis.AbortSignal.timeout(60000) }); },
    async refreshService() { if (closed) throw new Error('Desktop fixture is already closed'); return refreshService(); },
    async refreshCDP() { if (closed) throw new Error('Desktop fixture is already closed'); return refreshCDP(); },
    async restartDesktop() {
      if (closed) throw new Error('Desktop fixture is already closed');
      const previous = { previousAppPid: appChild.pid, previousCDPPort: cdpPort, servicePid: info.pid, serviceId: info.id, serviceURL: info.url };
      const stopped = await stopDesktop();
      if (!stopped.appStopped) throw new Error('Owned desktop did not stop before restart');
      // Chromium can fail to bind a recently closed debug port on Windows (WSAEADDRINUSE).
      // Give every GUI lifetime a fresh debug endpoint while preserving the native service.
      let nextCDPPort;
      for (let attempt = 0; attempt < 16; attempt++) {
        const candidate = await availablePort();
        if (!usedCDPPorts.has(candidate) && candidate !== servicePort) { nextCDPPort = candidate; break; }
      }
      if (nextCDPPort === undefined) throw new Error('Could not allocate a fresh desktop debugging port');
      cdpPort = nextCDPPort;
      usedCDPPorts.add(cdpPort);
      const started = Date.now();
      startDesktop();
      await refreshService(started);
      if (info.pid !== previous.servicePid || info.id !== previous.serviceId || info.url !== previous.serviceURL) throw new Error('Desktop-only restart unexpectedly replaced its existing native service');
      await refreshCDP(started);
      const result = { ...previous, appPid: appChild.pid, cdpPort, servicePid: info.pid, forcedAppStop: stopped.forcedAppStop, cdpReady: cdp.ready };
      restarts.push(result);
      logs.desktop = await collectDesktopLogs(root);
      return result;
    },
    async close() {
      if (closed) return cleanup;
      closed = true;
      cleanup = { appPid: appChild?.pid, servicePid: info?.pid, appStopped: !alive(appChild?.pid), serviceStopped: false, removed: false, forcedAppStop: false, errors: [] };
      logs.desktop = await collectDesktopLogs(root);
      Object.assign(cleanup, await stopDesktop());
      if (!cleanup.appStopped) cleanup.errors.push('Owned desktop process did not stop');
      let registered;
      try { registered = parseDesktopServiceRegistration(JSON.parse(await readFile(registrationFile, 'utf8')), servicePort); }
      catch (error) { if (error.code !== 'ENOENT') cleanup.errors.push(`Cannot verify owned service registration: ${String(error)}`); }
      if (registered) {
        cleanup.servicePid = registered.pid;
        if (alive(registered.pid)) {
          const stopped = await runCommand(nativeBinary, ['service', 'stop'], { env, cwd: workspace, timeout: 2000 });
          cleanup.serviceStopExitCode = stopped.code;
          const deadline = Date.now() + 1000;
          while (alive(registered.pid) && Date.now() < deadline) await delay(50);
        }
        cleanup.serviceStopped = !alive(registered.pid);
      } else cleanup.serviceStopped = !alive(info?.pid);
      if (!cleanup.serviceStopped) cleanup.errors.push('Owned desktop service did not stop');
      if (model) { try { await model.close(); } catch (error) { cleanup.errors.push(`Model fixture close failed: ${String(error)}`); } }
      cleanup.runProcesses = await inspectDesktopRunProcesses(root, env);
      if (cleanup.runProcesses.state !== 'clear') {
        cleanup.errors.push(cleanup.runProcesses.state === 'occupied'
          ? 'Owned run still has executable processes; retained its directory'
          : `Cannot establish that the owned run has no executable processes: ${cleanup.runProcesses.error}`);
      }
      if (cleanup.errors.length === 0) {
        try {
          const target = await realpath(root);
          const child = relative(parentRoot, target);
          if (target !== root || !child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)
            || dirname(target) !== parentRoot || !basename(target).startsWith('run-')
            || await readFile(join(target, '.desktop-fixture-owner'), 'utf8') !== owner) throw new Error('Refusing to remove a run outside its verified installation task root');
          await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
          cleanup.removed = true;
        } catch (error) { cleanup.errors.push(`Run directory cleanup failed: ${String(error)}`); }
      }
      if (cleanup.errors.length) throw Object.assign(new Error('Desktop fixture cleanup is incomplete'), { cleanup });
      return cleanup;
    },
  };
  const started = Date.now();
  try {
    await prepareDesktopProfile(root);
    model = await createMockModel(respond);
    const config = { update: 'disable', model: 'test/test-model', providers: { test: {
      name: 'Crosschat desktop fixture', package: 'aisdk:@ai-sdk/openai-compatible', settings: { apiKey: 'test-key-with-no-permissions', baseURL: model.url },
      models: { 'test-model': { name: 'Scripted test model', capabilities: { tools: true, input: ['text'], output: ['text'] }, cost: { input: 0, output: 0 }, limit: { context: 100000, output: 10000 } } },
    } } };
    await Promise.all([writeFile(join(env.OPENCODE_CONFIG_DIR, 'opencode.json'), JSON.stringify(config)), writeFile(join(env.OPENCODE_CONFIG_DIR, 'service.json'), JSON.stringify({ hostname: '127.0.0.1', port: servicePort })), writeFile(env.OPENCODE_MODELS_PATH, '{}'), writeFile(env.GIT_CONFIG_GLOBAL, '')]);
    startDesktop();
    await refreshService(started);
    await refreshCDP(started);
    logs.desktop = await collectDesktopLogs(root);
    return fixture;
  } catch (error) {
    let cleanupError;
    try { await fixture.close(); } catch (failure) { cleanupError = String(failure); }
    throw Object.assign(new Error(`Official desktop fixture startup failed: ${String(error)}`, { cause: error }), {
      category: error.category === 'compatibility' ? 'compatibility' : 'infrastructure', stage: 'setup',
      check: typeof error.check === 'string' ? error.check : 'service-process', retry: error.retry === true,
      evidence: { root, appPid: appChild?.pid, servicePid: info?.pid, logs, cleanup, cleanupError },
    });
  }
}
