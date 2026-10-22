import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryEndpoint } from '../src/application/discovery/model.js';
import type { DiagnosticResult } from '../src/application/diagnostics/model.js';
import type { OverviewOptions } from '../src/application/observations/overview.js';
import { queryDoctorDiagnostics } from '../src/application/diagnostics/query.js';
import { defaultDoctorDeps } from '../src/application/diagnostics/deps.js';
import { collectDoctorDiagnostics } from '../src/application/diagnostics/checks.js';
import { writeNodeRevocation } from '../src/serve/revocation.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const now = 1_800_000_000_000;
const capabilities = { discovery: true, delivery: false, launch: false, diagnostics: false };
const report: DiagnosticResult = { groups: [{ context: { kind: 'environment' }, checks: [
  { code: 'node-unsupported', level: 'error', data: { version: '20.0.0' } },
  { code: 'skill-missing', level: 'warn', data: { side: 'claude', path: '/fixture/skill' } },
] }], summary: { pass: 0, warn: 1, error: 1, failed: true } };

async function home() {
  const path = await mkdtemp(join(tmpdir(), 'crosschat-overview-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
function discovery(): DiscoveryEndpoint {
  return { execute: vi.fn(async (request) => {
    if (request.op !== 'list') throw new Error('unexpected detail');
    const page = request.cursor === undefined ? 0 : 1;
    return { op: 'list', providers: ['claude', 'future-provider'].map((providerId) => ({ providerId, capabilities })), page: {
      items: [{ ref: { contextId: 'local', providerId: page === 0 ? 'claude' : 'future-provider', nativeId: `full-${page}` }, name: page === 0 ? null : 'named', rawStatus: 'future-state', capabilities, attributes: {} }],
      completeness: page === 0 ? 'partial' : 'complete', nextCursor: page === 0 ? 'next-page' : null, errors: [], observedAt: now,
    } };
  }) };
}
async function options(overrides: Partial<OverviewOptions> = {}): Promise<OverviewOptions> {
  return { home: await home(), discovery: discovery(), now: () => now,
    readOutbox: async () => ({ items: [], completeness: 'complete', observedAt: now, errors: [] }),
    queryDoctor: vi.fn(async () => report), ...overrides };
}
async function create(config: OverviewOptions) {
  const { createLocalOverview } = await import('../src/application/observations/overview.js');
  return createLocalOverview(config);
}

describe('read-only local overview', () => {
  it('drains safe discovery pages including anonymous and future Providers while status never runs doctor or creates files', async () => {
    const config = await options();
    const app = await create(config);
    const result = await app.readStatus({ contextId: 'local' });
    expect(result.providers).toEqual([
      { providerId: 'claude', count: 1, anonymous: 1, completeness: 'complete' },
      { providerId: 'future-provider', count: 1, anonymous: 0, completeness: 'complete' },
    ]);
    expect(result).toMatchObject({ connections: [{ kind: 'local' }], services: [], outbox: { threads: 0, items: 0 }, lastDoctor: null });
    expect(config.discovery.execute).toHaveBeenCalledTimes(2);
    expect(config.queryDoctor).not.toHaveBeenCalled();
    expect(await readdir(config.home)).toEqual([]);
  });

  it('keeps configuration and live snapshot evidence separate from authenticated or reachable claims', async () => {
    const config = await options();
    const tcp = join(config.home, '.crosschat', 'tcp');
    await mkdir(join(config.home, '.ssh'), { recursive: true });
    await mkdir(tcp, { recursive: true });
    await writeFile(join(config.home, '.ssh', 'config'), 'Host test-alias\nHost *\n');
    const original = JSON.stringify({ brokers: [{ host: 'never-connect.invalid', port: 1, key: 'fixture-secret', name: 'same-name', starId: 'full-star' }] });
    await writeFile(join(tcp, 'node.json'), original);
    await writeFile(join(tcp, 'status-node-same-name.json'), JSON.stringify({ state: 'future-node-state', pid: process.pid, lastUpdated: new Date(now).toISOString() }));
    const result = await (await create(config)).readStatus({ contextId: 'local' });
    expect(result.connections.map((item) => item.kind)).toEqual(['local', 'ssh', 'tcp']);
    expect(result.services[0]).toMatchObject({ state: 'future-node-state', freshness: 'fresh', readiness: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(JSON.stringify(result)).not.toContain('hasAdminKey');
    expect(await readFile(join(tcp, 'node.json'), 'utf8')).toBe(original);
  });

  it('bounds metadata files and reports damaged watchdog evidence without writing or claiming a known state', async () => {
    const config = await options();
    const baseDir = join(config.home, '.crosschat');
    await mkdir(join(baseDir, 'tcp'), { recursive: true });
    await mkdir(join(baseDir, 'outbox'), { recursive: true });
    await writeFile(join(baseDir, 'tcp', 'node.json'), 'x'.repeat(2 * 1024 * 1024 + 1));
    const lock = join(baseDir, 'outbox', 'watchdog.lock');
    await writeFile(lock, 'private-token invalid heartbeat');
    const result = await (await create(config)).readStatus({ contextId: 'local' });
    expect(result).toMatchObject({ completeness: 'partial', watchdog: { running: null, evidence: 'unavailable' } });
    expect(result.errors.some((issue) => issue.source.endsWith('node.json'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(await readFile(lock, 'utf8')).toBe('private-token invalid heartbeat');
  });

  it('retains successful sources when another fails and never treats unknown queue size as zero', async () => {
    const config = await options({
      readContexts: async () => ({ items: [], observedAt: now, errors: [{ source: '/fixture/ssh', kind: 'malformed', message: '配置格式无效', nextStep: '检查 SSH 配置' }] }),
      readServices: async () => ({ items: [], observedAt: now, completeness: 'complete', errors: [] }),
      readOutbox: async () => ({ items: [{ id: 'bad', contextId: 'local', providerId: 'codex', threadId: 'full-id', toName: null, count: null, oldestParkedAt: null,
        mailboxFile: '/fixture/mailbox.md', state: 'oversized', items: [] }], observedAt: now, completeness: 'partial', errors: [{ source: '/fixture/outbox', kind: 'unavailable', message: '文件过大', nextStep: '检查来源大小' }] }),
    });
    const result = await (await create(config)).readStatus({ contextId: 'local' });
    expect(result).toMatchObject({ completeness: 'partial', outbox: { threads: 1, items: null } });
    expect(result.providers).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
  });

  it('does not let cancelled or failed doctor reads overwrite the latest successful in-memory report', async () => {
    let finish: ((value: DiagnosticResult) => void) | undefined;
    const queryDoctor = vi.fn(async () => report);
    const config = await options({ queryDoctor });
    const app = await create(config);
    expect((await app.readStatus({ contextId: 'local' })).lastDoctor).toBeNull();
    const first = await app.readDoctor({ contextId: 'local' });
    expect(first).toMatchObject({ completeness: 'complete', summary: report.summary, observedAt: now });
    expect(first.checks[0]).toMatchObject({ code: 'node-unsupported', level: 'error', label: expect.any(String), guidance: expect.any(String) });
    expect((await app.readStatus({ contextId: 'local' })).lastDoctor).toEqual(first);
    queryDoctor.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const pending = app.readDoctor({ contextId: 'local', signal: controller.signal });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    expect(await pending).toMatchObject({ completeness: 'cancelled', checks: [] });
    finish?.({ groups: [], summary: { pass: 0, warn: 0, error: 0, failed: false } });
    expect((await app.readStatus({ contextId: 'local' })).lastDoctor).toEqual(first);
    queryDoctor.mockRejectedValueOnce(new Error('private-token fixture diagnostic'));
    const failed = await app.readDoctor({ contextId: 'local' });
    expect(failed).toMatchObject({ completeness: 'unavailable', summary: null });
    expect(JSON.stringify(failed)).not.toContain('private-token');
  });

  it('cancels an uncooperative native status source and never publishes a healthy empty replacement', async () => {
    let signal: AbortSignal | undefined;
    const config = await options({ discovery: { execute: async (_request, readOptions) => { signal = readOptions?.signal; return new Promise(() => undefined); } } });
    const app = await create(config);
    const controller = new AbortController();
    const pending = app.readStatus({ contextId: 'local', signal: controller.signal });
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.abort();
    expect(await pending).toMatchObject({ completeness: 'cancelled', providers: [] });
    expect(signal?.aborted).toBe(true);
  });

  it('binds revoked snapshots to the current credential and treats replaced keys or damaged markers as unknown', async () => {
    const config = await options();
    const tcp = join(config.home, '.crosschat', 'tcp');
    await mkdir(tcp, { recursive: true });
    const entry = { host: 'never-connect.invalid', port: 1, key: 'old-fixture-key', starId: 'star-full', name: 'fixture' };
    const file = join(tcp, 'node.json');
    await writeFile(file, JSON.stringify({ brokers: [entry] }));
    await writeFile(join(tcp, 'status-node-fixture.json'), JSON.stringify({ state: 'revoked', brokerAlias: 'fixture', lastUpdated: '2000-01-01' }));
    writeNodeRevocation(file, entry, entry.starId, now);
    const app = await create(config);
    expect((await app.readStatus({ contextId: 'local' })).services[0].pause).toMatchObject({ state: 'revoked' });
    await writeFile(file, JSON.stringify({ brokers: [{ ...entry, key: 'new-fixture-key' }] }));
    expect((await app.readStatus({ contextId: 'local' })).services[0].pause).toMatchObject({ state: 'unknown' });
    await writeFile(file, JSON.stringify({ brokers: [entry] }));
    const marker = (await readdir(tcp)).find((name) => name.startsWith('revoked-'))!;
    await writeFile(join(tcp, marker), '{"private-token":"must-not-escape"}');
    const damaged = await app.readStatus({ contextId: 'local' });
    expect(damaged.services[0].pause).toMatchObject({ state: 'unknown' });
    expect(damaged.completeness).toBe('partial');
    expect(JSON.stringify(damaged)).not.toContain('must-not-escape');
  });
});

describe('safe isolated diagnostics for observation pages', () => {
  it('uses the explicit HOME for registry, TCP, queue, watchdog, skills and mailbox guidance', async () => {
    const directory = await home();
    const deps = defaultDoctorDeps({ home: directory, env: { FIXTURE_ENV: 'bound' } });
    expect(deps.homeDir()).toBe(directory);
    expect(deps.env.FIXTURE_ENV).toBe('bound');
    expect(deps.tcpDir).toBe(join(directory, '.crosschat', 'tcp'));
    await mkdir(join(directory, '.crosschat', 'outbox'), { recursive: true });
    await writeFile(join(directory, '.crosschat', 'outbox', 'fixture-thread.json'), JSON.stringify({ items: [{ id: 'fixture', parkedAt: now, attempts: 0 }] }));
    const result = collectDoctorDiagnostics({ ...deps, resolveClaude: () => 'fixture-claude', listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      codexBin: () => { throw new Error('not installed'); }, repoSkillFiles: () => undefined, probeTcp: () => false });
    const parked = result.groups.flatMap((group) => group.checks).find((check) => check.code === 'outbox-parked');
    expect(parked?.data).toMatchObject({ mailboxFile: join(directory, '.crosschat', 'mailbox', 'fixture-thread.md') });
  });

  it('rejects malformed or secret-bearing IPC result shapes without returning a healthy report', async () => {
    for (const payload of [{ ready: true, token: 'private-token' }, { ...report, groups: [{ context: { kind: 'environment' }, checks: [{ code: 'node-unsupported', level: 'pass', data: { version: '20.0.0', key: 'private-token' } }] }] }]) {
      const worker = new Worker('require("node:worker_threads").parentPort.postMessage(require("node:worker_threads").workerData);', { eval: true, workerData: payload });
      await expect(queryDoctorDiagnostics({ createWorker: () => worker })).rejects.toThrow(/诊断|Diagnostic/);
      expect(worker.threadId).toBe(-1);
    }
  });

  it('binds the isolated process environment to explicit HOME instead of inherited native data overrides', async () => {
    const directory = await home();
    const script = join(directory, 'controlled-diagnostic.cjs');
    await writeFile(script, `const data={firstLine:JSON.stringify({home:process.env.HOME,profile:process.env.USERPROFILE,codex:process.env.CODEX_HOME,sqlite:process.env.CODEX_SQLITE_HOME,fixture:process.env.FIXTURE_ENV}),status:0};process.send({groups:[{context:{kind:'environment'},checks:[{code:'codex-unparsed',level:'warn',data}]}],summary:{pass:0,warn:1,error:0,failed:false}});setInterval(()=>{},1000);`);
    const result = await queryDoctorDiagnostics({ home: directory, env: { CODEX_HOME: '/outside-home', CODEX_SQLITE_HOME: '/outside-sqlite', FIXTURE_ENV: 'bound' },
      createProcess: (spawnOptions) => fork(script, { env: spawnOptions?.env ?? {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32', windowsHide: true }) });
    const check = result.groups[0].checks[0];
    expect(check.code).toBe('codex-unparsed');
    expect(JSON.parse('firstLine' in check.data ? check.data.firstLine : '')).toEqual({ home: directory, profile: directory, codex: join(directory, '.codex'), fixture: 'bound' });
  });

  it('times out and reaps the query owner instead of leaving a blocked probe alive', async () => {
    const worker = new Worker('Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);', { eval: true });
    const pending = queryDoctorDiagnostics({ timeoutMs: 20, createWorker: () => worker });
    const outcome = await Promise.race([pending.then(() => 'healthy', (error: Error) => error.name), new Promise<string>((resolve) => setTimeout(() => resolve('still-running'), 250))]);
    if (outcome === 'still-running') await worker.terminate();
    expect(outcome).toBe('TimeoutError');
    expect(worker.threadId).toBe(-1);
  });
});
