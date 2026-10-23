import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectDesktopLogs, inspectDesktopRunProcesses, prepareDesktopProfile } from './helpers/opencode-desktop-live-fixture.mjs';
import { probeDesktopService } from './helpers/opencode-desktop-service-probe.mjs';
import { poll, runCommand } from './helpers/opencode-live-fixture.mjs';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    const closed = new Promise<void>((done) => server.close(() => done()));
    server.closeAllConnections();
    await closed;
  }
  const temp = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    const target = await realpath(root);
    const child = relative(temp, target);
    if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('Unsafe fixture unit cleanup path');
    await rm(target, { recursive: true, force: true });
  }
});

async function serviceFixture(status: number, body: unknown, bodyMode: 'json' | 'incomplete' | 'invalid' = 'json') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-desktop-fixture-unit-')));
  roots.push(root);
  const requests: Array<{ url: string | undefined; authorization: string | undefined }> = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.writeHead(status, { 'content-type': 'application/json' });
    if (bodyMode === 'incomplete') { response.write('{'); return; }
    if (bodyMode === 'invalid') { response.end('{'); return; }
    response.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No isolated HTTP fixture address');
  const registrationFile = join(root, 'service.json');
  await writeFile(registrationFile, JSON.stringify({ pid: process.pid, password: 'fixture-password', url: `http://127.0.0.1:${address.port}` }));
  return { root, registrationFile, port: address.port, requests };
}

describe('official desktop test environment', () => {
  it('keeps the desktop initial state and Windows post-initialization fallback in the same owned profile', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-desktop-fixture-unit-')));
    roots.push(root);
    vi.stubEnv('OPENAI_API_KEY', 'must-not-reach-upstream');
    vi.stubEnv('GITHUB_TOKEN', 'must-not-reach-upstream');
    vi.stubEnv('CODEX_THREAD_ID', 'foreign-session');
    const env = await prepareDesktopProfile(root);
    expect(JSON.parse(await readFile(join(env.OPENCODE_DESKTOP_TEST_ROOT, 'desktop', 'opencode.settings'), 'utf8'))).toEqual({ firstLaunchOnboardingComplete: true });
    const result = await runCommand(process.execPath, ['--input-type=module', '-e', `
      import { homedir, tmpdir } from 'node:os';
      import { join } from 'node:path';
      const initial = process.env.XDG_STATE_HOME;
      delete process.env.XDG_STATE_HOME;
      console.log(JSON.stringify({ home: homedir(), temporary: tmpdir(), initial,
        fallback: join(homedir(), '.local', 'state'), testRoot: process.env.OPENCODE_DESKTOP_TEST_ROOT,
        foreign: ['OPENAI_API_KEY','GITHUB_TOKEN','CODEX_THREAD_ID'].some((key) => process.env[key]) }));
    `], { env });
    expect(result.code).toBe(0);
    const child = JSON.parse(result.stdout);
    expect(child).toMatchObject({ home: join(root, 'profile'), temporary: join(root, 'tmp'), initial: join(root, 'profile', '.local', 'state'), fallback: join(root, 'profile', '.local', 'state'), testRoot: join(root, 'profile', '.local'), foreign: false });
    expect(env.OPENCODE_CONFIG_DIR).toBe(join(root, 'profile', '.local', 'config', 'opencode'));
    expect(env.APPDATA.startsWith(root)).toBe(true);
    expect(env.LOCALAPPDATA.startsWith(root)).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')('reports an unregistered executable under the owned run before allowing cleanup', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-desktop-fixture-unit-')));
    roots.push(root);
    const env = await prepareDesktopProfile(root);
    const binary = join(root, 'native', 'ping.exe');
    await mkdir(join(root, 'native'));
    await copyFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE'), binary);
    const child = spawn(binary, ['-t', '127.0.0.1'], { env, cwd: root, windowsHide: true, stdio: 'ignore' });
    const exited = new Promise<void>((done) => child.once('close', () => done()));
    try {
      await new Promise<void>((done, reject) => { child.once('spawn', done); child.once('error', reject); });
      expect(child.pid).toBeTypeOf('number');
      expect(child.exitCode).toBeNull();
      const inspection = await inspectDesktopRunProcesses(root, env);
      expect(inspection.state).toBe('occupied');
      expect(inspection.processes).toContainEqual({ pid: child.pid, parentPid: process.pid, executablePath: binary });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    }
    const stopped = await inspectDesktopRunProcesses(root, env);
    expect(stopped).toMatchObject({ state: 'clear', processes: [] });
  }, 20000);

  it.each([
    [401, {}, 'compatibility', 'service-authentication', false],
    [403, {}, 'compatibility', 'service-authentication', false],
    [404, {}, 'compatibility', 'service-info-route', false],
    [405, {}, 'compatibility', 'service-info-route', false],
    [200, { pid: process.pid, version: 123 }, 'compatibility', 'service-info-schema', false],
    [200, { pid: process.pid + 1, version: '2.1.3' }, 'compatibility', 'service-info-schema', false],
    [503, {}, 'infrastructure', 'service-readiness', true],
  ])('classifies actual desktop HTTP %i failures without hiding wire changes as infrastructure', async (status, body, category, check, retry) => {
    const fixture = await serviceFixture(Number(status), body);
    await expect(probeDesktopService(fixture.registrationFile, fixture.port)).rejects.toMatchObject({ category, stage: 'setup', check, retry });
    expect(fixture.requests).toEqual([{ url: '/api/info', authorization: `Basic ${Buffer.from('opencode:fixture-password').toString('base64')}` }]);
  });

  it('distinguishes a missing desktop registration from a published malformed registration', async () => {
    const fixture = await serviceFixture(200, { pid: process.pid, version: '2.1.3' });
    await expect(probeDesktopService(join(fixture.root, 'missing.json'), fixture.port)).rejects.toMatchObject({ category: 'infrastructure', stage: 'setup', check: 'service-registration-unavailable', retry: true });
    await writeFile(fixture.registrationFile, '{"url":');
    await expect(probeDesktopService(fixture.registrationFile, fixture.port)).rejects.toMatchObject({ category: 'compatibility', stage: 'setup', check: 'service-registration-schema', retry: false });
    expect(fixture.requests).toEqual([]);
  });

  it('accepts only authenticated health belonging to the registered process', async () => {
    const fixture = await serviceFixture(200, { pid: process.pid, version: '2.1.3' });
    await expect(probeDesktopService(fixture.registrationFile, fixture.port)).resolves.toMatchObject({ pid: process.pid, version: '2.1.3' });
  });

  it('keeps an interrupted successful HTTP body distinct from malformed completed JSON', async () => {
    const pending = await serviceFixture(200, null, 'incomplete');
    await expect(probeDesktopService(pending.registrationFile, pending.port, { signal: AbortSignal.timeout(100) })).rejects.toMatchObject({ category: 'infrastructure', check: 'service-readiness', retry: true });
    expect(pending.requests).toHaveLength(1);
    const malformed = await serviceFixture(200, null, 'invalid');
    await expect(probeDesktopService(malformed.registrationFile, malformed.port)).rejects.toMatchObject({ category: 'compatibility', check: 'service-info-schema', retry: false });
  });

  it.skipIf(process.platform !== 'win32')('retains a locked-log diagnostic while collecting remaining logs for teardown', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-desktop-fixture-unit-')));
    roots.push(root);
    const env = await prepareDesktopProfile(root);
    const directory = join(env.OPENCODE_DESKTOP_TEST_ROOT, 'desktop', 'logs');
    await mkdir(directory, { recursive: true });
    const locked = join(directory, 'locked.log');
    await writeFile(locked, 'owned log held exclusively by the fixture');
    await writeFile(join(directory, 'healthy.log'), `${'前'.repeat(100000)}\nremaining logs stay available`);
    const script = '$stream=[IO.File]::Open($env:CROSSCHAT_LOCKED_LOG,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{[Console]::WriteLine("LOCK_READY");[Console]::Out.Flush();[Console]::ReadLine()|Out-Null}finally{$stream.Dispose()}';
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...env, CROSSCHAT_LOCKED_LOG: locked }, cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<void>((done) => child.once('close', () => done()));
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    try {
      await new Promise<void>((done, reject) => { child.once('spawn', done); child.once('error', reject); });
      await poll(() => output.includes('LOCK_READY'), 'controlled exclusive log lock', 3000);
      const collected = await collectDesktopLogs(root);
      const tail = collected.files[join('profile', '.local', 'desktop', 'logs', 'healthy.log')];
      expect(tail.endsWith('\nremaining logs stay available')).toBe(true);
      expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(64 * 1024);
      expect(collected.errors).toEqual([expect.objectContaining({ path: join('profile', '.local', 'desktop', 'logs', 'locked.log'), code: expect.any(String) })]);
    } finally {
      child.stdin.end('\n');
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    }
  }, 10000);
});
