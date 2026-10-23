import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, toNamespacedPath } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { listClaudeSessions } from '../../dist/claude/registry.js';
import { createClaudeMockModel } from './claude-mock-model.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bounded = (value) => value.slice(-128000);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export async function pollClaude(read, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

export async function prepareClaudeProfile(root, modelURL) {
  let endpoint;
  try { endpoint = new URL(modelURL); } catch { /* Rejected before writes. */ }
  if (!endpoint || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/'
    || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw Object.assign(new Error('Claude fixture requires an exact loopback model endpoint'), { code: 'INVALID_MODEL_ENDPOINT' });
  }
  if (!isAbsolute(root)) throw new Error('Claude fixture root must be absolute');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|LANG|LC_.*|TERM|COLORTERM|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|ProgramFiles.*|SYSTEMDRIVE|PROGRAMDATA|OS)$/i.test(name)));
  const profile = join(root, 'profile');
  Object.assign(env, {
    HOME: profile, USERPROFILE: profile, CLAUDE_CONFIG_DIR: join(profile, '.claude'),
    APPDATA: join(profile, 'appdata'), LOCALAPPDATA: join(profile, 'localappdata'),
    XDG_CONFIG_HOME: join(profile, 'config'), XDG_CACHE_HOME: join(profile, 'cache'), XDG_DATA_HOME: join(profile, 'data'), XDG_STATE_HOME: join(profile, 'state'),
    TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'), CLAUDE_CODE_TMPDIR: join(root, 'tmp'),
    ANTHROPIC_BASE_URL: modelURL, ANTHROPIC_API_KEY: 'mock-key', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', DISABLE_AUTOUPDATER: '1', DISABLE_AUTO_COMPACT: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    CODEX_HOME: join(profile, '.codex'), CROSSCHAT_CODEX_BIN: join(root, 'codex-not-installed.exe'),
    NO_COLOR: '1', CI: '1',
  });
  if (process.platform === 'win32') { env.HOMEDRIVE = profile.slice(0, 2); env.HOMEPATH = profile.slice(2); }
  await Promise.all([profile, env.CLAUDE_CONFIG_DIR, env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME,
    env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.CODEX_HOME, join(root, 'workspace')].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(env.GIT_CONFIG_GLOBAL, '');
  return env;
}

export function claudeBashCommand(args) {
  const quote = (value) => `'${String(value).replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
  return [process.execPath, ...args].map(quote).join(' ');
}

export function runClaudeCommand(binary, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd ?? repositoryRoot, env: options.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeout ?? 30000);
    child.stdout.on('data', (chunk) => { stdout = bounded(stdout + chunk); });
    child.stderr.on('data', (chunk) => { stderr = bounded(stderr + chunk); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); done({ code, signal, timedOut, stdout, stderr, pid: child.pid }); });
    child.stdin.end(options.input ?? '');
  });
}

/** Owns only isolated sessions and their model server; never downloads or runs a PATH Claude. */
export async function createClaudeFixture(options, respond) {
  if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required');
  for (const value of [options?.binary, options?.parentRoot]) if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Owned absolute binary and parent paths are required');
  const parent = await realpath(options.parentRoot);
  const root = await realpath(await mkdtemp(join(parent, 'claude-live-'))); const owner = randomUUID();
  await writeFile(join(root, '.fixture-owner'), owner);
  const sessions = []; const barriers = [];
  const cleanup = { runtimeStopped: false, registrationRemoved: false, modelClosed: false, removed: false, forced: false, errors: [] };
  const model = await createClaudeMockModel(respond);
  const env = await prepareClaudeProfile(root, model.url);
  const workspace = join(root, 'workspace'); const sessionsDir = join(env.CLAUDE_CONFIG_DIR, 'sessions');
  const binary = join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe');
  let closing;
  const fixture = {
    root, env, workspace, sessionsDir, sessions, model, cleanup,
    scan: () => listClaudeSessions(sessionsDir),
    async cli(args, input) {
      const result = await runClaudeCommand(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), ...args], { env, cwd: workspace, input });
      if (result.timedOut || result.signal) cleanup.forced = true;
      return result;
    },
    shell: (args) => claudeBashCommand([join(repositoryRoot, 'dist', 'cli.js'), ...args]),
    async start(name) {
      const id = randomUUID(); const events = []; const logs = { stdout: '', stderr: '' };
      const args = [join(repositoryRoot, 'dist', 'cli.js'), 'claude', '-p', '--safe-mode', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--replay-user-messages', '--session-id', id, '--name', name, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--model', 'claude-sonnet-4-6', '--tools', 'Bash', '--allowedTools', 'Bash'];
      const child = spawn(process.execPath, args, { cwd: workspace, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      let pending = ''; let exit; let spawnError;
      const closed = new Promise((done) => {
        child.once('error', (error) => { spawnError = error; done(); });
        child.once('close', (code, signal) => { exit = { code, signal }; done(); });
      });
      child.stdin.on('error', (error) => { if (!exit) spawnError = error; });
      child.stdout.on('data', (chunk) => {
        logs.stdout = bounded(logs.stdout + chunk); pending += chunk.toString('utf8');
        for (;;) {
          const index = pending.indexOf('\n'); if (index < 0) break;
          const line = pending.slice(0, index); pending = pending.slice(index + 1);
          try { events.push({ ...JSON.parse(line), observedAt: Date.now() }); } catch { /* Bounded diagnostic output stays in logs. */ }
        }
        if (pending.length > 1024 * 1024) { pending = ''; spawnError = new Error('Native output line exceeded fixture budget'); }
      });
      child.stderr.on('data', (chunk) => { logs.stderr = bounded(logs.stderr + chunk); });
      const session = { id, name, child, events, logs, closed, entry: undefined,
        results: () => events.filter((event) => event.type === 'result'),
        prompt(text) { child.stdin.write(JSON.stringify({ type: 'user', uuid: randomUUID(), session_id: id, parent_tool_use_id: null, message: { role: 'user', content: text } }) + '\n'); },
        async waitResults(count) { return pollClaude(() => { if (spawnError) throw spawnError; if (exit) throw new Error('Owned Claude exited before its expected result'); return this.results().length >= count ? this.results() : undefined; }, `native result ${count} of ${id}`, 45000); },
        async stop() {
          if (!child.stdin.writableEnded) child.stdin.end();
          await pollClaude(() => exit || (spawnError ? Promise.reject(spawnError) : undefined), `owned wrapper exit ${id}`, 15000); await closed;
          if (exit?.code !== 0 || exit.signal !== null) throw new Error(`Owned wrapper did not exit normally (${exit?.code})`);
          if (session.entry) await pollClaude(() => !alive(session.entry.pid), `owned Claude exit ${id}`, 10000);
          await pollClaude(() => !fixture.scan().sessions.some((item) => item.sessionId === id), `native registration withdrawal ${id}`, 10000);
        },
      };
      sessions.push(session);
      session.prompt(`CC_CI_BOOTSTRAP ${id}`);
      session.entry = await pollClaude(() => { if (spawnError) throw spawnError; if (exit) throw new Error(`Owned Claude startup failed: ${logs.stderr}`); return fixture.scan().sessions.find((item) => item.sessionId === id); }, 'owned native registration', 30000);
      return session;
    },
    async barrier(label) {
      const nonce = randomUUID(); const ready = join(root, `${label}-${nonce}.ready.json`); const release = join(root, `${label}-${nonce}.release`);
      const script = join(root, `${label}-${nonce}.mjs`);
      await writeFile(script, `import{existsSync,writeFileSync}from'node:fs';import{setTimeout as wait}from'node:timers/promises';writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,nonce:${JSON.stringify(nonce)}}));const end=Date.now()+45000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>end)throw Error('owned gate deadline');await wait(25)}process.stdout.write(${JSON.stringify(`CC_CI_GATE_COMPLETE ${nonce}`)});`);
      const barrier = { nonce, pid: undefined, command: claudeBashCommand([script]),
        async waitReady() {
          const value = await pollClaude(async () => { try { return JSON.parse(await readFile(ready, 'utf8')); } catch { return undefined; } }, `real Bash gate ${label}`, 30000);
          if (value.nonce !== nonce || !Number.isSafeInteger(value.pid) || value.pid <= 0) throw new Error('Invalid owned barrier identity'); barrier.pid = value.pid; return value;
        }, release: () => writeFile(release, 'release') };
      barriers.push(barrier); return barrier;
    },
    close() {
      return closing ??= (async () => {
        await Promise.all(barriers.map((barrier) => barrier.release()));
        for (const session of sessions) {
          try { await session.stop(); } catch (error) { cleanup.errors.push(error.message); }
        }
        cleanup.runtimeStopped = sessions.every((session) => session.child.exitCode === 0 && !session.child.signalCode && (!session.entry || !alive(session.entry.pid)))
          && barriers.every((barrier) => !barrier.pid || !alive(barrier.pid));
        const remaining = await readdir(sessionsDir).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
        cleanup.registrationRemoved = fixture.scan().sessions.length === 0 && !remaining.some((file) => file.endsWith('.json'));
        try { await model.close(); cleanup.modelClosed = true; } catch (error) { cleanup.errors.push(error.message); }
        if (cleanup.runtimeStopped && cleanup.registrationRemoved && cleanup.modelClosed && !cleanup.forced && !cleanup.errors.length) {
          const target = await realpath(root); const child = relative(parent, target);
          if (target !== root || !child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`) || await readFile(join(root, '.fixture-owner'), 'utf8') !== owner) throw new Error('Unsafe owned Claude fixture cleanup target');
          await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); cleanup.removed = true;
        } else throw Object.assign(new Error('Owned Claude resources did not exit normally; fixture retained'), { cleanup });
      })();
    },
  };
  try {
    await mkdir(dirname(binary), { recursive: true }); await copyFile(options.binary, binary);
    // Windows CreateProcess needs an extended path for the user's long, retained D: test hierarchy.
    env.APPDATA = toNamespacedPath(env.APPDATA);
    const version = await runClaudeCommand(toNamespacedPath(binary), ['--version'], { env, cwd: workspace });
    if (version.timedOut || version.signal) cleanup.forced = true;
    if (version.code !== 0 || version.timedOut || version.signal || !/^2\.\d+\.\d+ \(Claude Code\)/.test(version.stdout.trim())) throw new Error('Owned official Claude version probe failed');
    fixture.version = version.stdout.trim().split(' ')[0];
    if (options.expectedVersion && fixture.version !== options.expectedVersion) throw new Error('Official binary version does not match its pinned artifact');
    return fixture;
  } catch (error) {
    try { await fixture.close(); } catch { /* Preserve the cleanup proof and owned root for diagnosis. */ }
    throw Object.assign(error, { fixtureRoot: root, cleanup });
  }
}
