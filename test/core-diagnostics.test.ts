import { Worker } from 'node:worker_threads';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import type { DoctorDeps } from '../src/commands/doctor.js';

function fixture(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    nodeVersion: '24.7.0',
    env: {},
    resolveClaude: () => 'claude',
    listClaudeSessions: () => ({ sessions: [], malformed: 1 }),
    codexBin: () => 'codex',
    run: (_bin, args) => args[0] === '--version'
      ? { status: 0, stdout: 'codex-cli 0.160.0\n' }
      : { status: 1, stdout: 'not running\n' },
    exists: () => true,
    readFile: () => undefined,
    homeDir: () => '/isolated-home',
    listOutbox: () => [],
    repoSkillFiles: () => undefined,
    now: () => 1_800_000_000_000,
    ...overrides,
  };
}

describe('structured diagnostics', () => {
  it('separates typed checks and severity counts from the unchanged synchronous CLI rendering', async () => {
    const { collectDoctorDiagnostics, renderDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const deps = fixture({ nodeVersion: '20.0.0' });
    const result = collectDoctorDiagnostics(deps);
    const checks = result.groups.flatMap((group) => group.checks);
    expect(checks.find((check) => check.code === 'node-unsupported')).toMatchObject({
      level: 'error', data: { version: '20.0.0' },
    });
    expect(checks.find((check) => check.code === 'claude-registry-malformed')).toMatchObject({
      level: 'warn', data: { count: 1 },
    });
    expect(result.summary).toEqual({ pass: 5, warn: 3, error: 1, failed: true });
    expect(renderDoctorDiagnostics(result)).toEqual(runDoctor(deps));
    expect(renderDoctorDiagnostics(result).output).toBe([
      '环境',
      '  ❌ Node v20.0.0（需 ≥22）',
      '  ⚠️ claude CLI 可解析（claude），但当前无可路由会话（crosschat claude 启动的会话才可接收）',
      '  ⚠️ claude 注册表 1 个损坏条目（已忽略）',
      '  ✅ codex CLI 0.160.0',
      '  ⚠️ codex daemon 未运行；要用 codex 通道时先执行: codex app-server daemon start',
      '  ✅ claude 侧 skill 已安装（安装源 skill 目录未定位到，跳过版本比对）',
      '  ✅ codex 侧 skill 已安装（安装源 skill 目录未定位到，跳过版本比对）',
      '  ✅ 无双身份残留',
      '其他',
      '  ✅ 发件箱空（无暂存消息）',
      '结论: 5 项通过，3 项警告，1 项错误',
    ].join('\n'));
  });

  it('keeps stopped-daemon info out of counters and never exposes credential fields in check data', async () => {
    const { collectDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const result = collectDoctorDiagnostics(fixture({
      tcpDir: '/isolated-home/tcp', cliVersion: '1.10.0', readDir: () => [],
      readFile: (file) => file.endsWith('status-broker.json')
        ? JSON.stringify({ version: '0.1.0', lastUpdated: '2000-01-01', key: 'secret-key', adminKey: 'secret-admin' })
        : undefined,
    }));
    const checks = result.groups.flatMap((group) => group.checks);
    expect(checks.find((check) => check.code === 'status-stale')).toMatchObject({ level: 'info', data: { file: 'status-broker.json' } });
    expect(result.summary).toEqual({ pass: 6, warn: 3, error: 0, failed: false });
    expect(JSON.stringify(result)).not.toContain('secret-');
  });

  it('parses node configuration from the injected read without opening a real config path or exposing keys', async () => {
    const { collectDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const probeTcp = vi.fn(() => false);
    const result = collectDoctorDiagnostics(fixture({
      tcpDir: '/virtual-only/tcp', probeTcp,
      readFile: (file) => file.endsWith('node.json')
        ? JSON.stringify({ brokers: [{ host: 'test-host', port: 7260, name: 'test-star', key: 'secret-key', adminKey: 'secret-admin' }] })
        : undefined,
    }));
    expect(probeTcp).toHaveBeenCalledWith('test-host', 7260);
    expect(result.groups.find((group) => group.context.kind === 'tcp')).toMatchObject({
      context: { kind: 'tcp', star: 'test-star' },
      checks: [
        { code: 'node-config-ready', level: 'pass', data: {} },
        { code: 'broker-unreachable', level: 'error', data: { host: 'test-host', port: 7260 } },
      ],
    });
    expect(result.summary.failed).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-');
  });
});

describe('isolated cancellable diagnostics', () => {
  it('terminates a real probe child through the default built isolation path on cancellation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crosschat-diagnostic-tree-'));
    const marker = join(dir, 'probe-pid');
    let probePid: number | undefined;
    let settled: Promise<string> | undefined;
    try {
      // Build only the query owner into a local package. The adjacent controlled
      // probe replaces doctor, so this never scans the user's actual settings.
      const querySource = readFileSync(new URL('../src/application/diagnostics/query.ts', import.meta.url), 'utf8');
      const built = ts.transpileModule(querySource, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      }).outputText;
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      writeFileSync(join(dir, 'query.js'), built);
      const modelSource = readFileSync(new URL('../src/application/diagnostics/model.ts', import.meta.url), 'utf8');
      writeFileSync(join(dir, 'model.js'), ts.transpileModule(modelSource, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      }).outputText);
      const childScript = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
      const isolatedScript = `import {spawnSync} from 'node:child_process'; spawnSync(process.execPath,['-e',${JSON.stringify(childScript)}]);`;
      writeFileSync(join(dir, 'worker.js'), isolatedScript);
      writeFileSync(join(dir, 'isolated.js'), isolatedScript);
      const { queryDoctorDiagnostics } = await import(pathToFileURL(join(dir, 'query.js')).href);
      const controller = new AbortController();
      const pending = queryDoctorDiagnostics({ signal: controller.signal });
      settled = pending.then(() => 'resolved', (error: Error) => error.name);
      const deadline = Date.now() + 3_000;
      while (!existsSync(marker) && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(existsSync(marker)).toBe(true);
      probePid = Number(readFileSync(marker, 'utf8'));
      controller.abort();
      const outcome = await Promise.race([
        settled,
        new Promise<string>((resolve) => setTimeout(() => resolve('still waiting for blocking probe'), 500)),
      ]);
      expect(outcome).toBe('AbortError');
      expect(() => process.kill(probePid!, 0)).toThrow();
    } finally {
      if (probePid !== undefined) {
        try { process.kill(probePid); } catch { /* Already owned and terminated. */ }
      }
      await settled;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an already-cancelled query before creating a worker', async () => {
    const { queryDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const controller = new AbortController();
    controller.abort();
    const createWorker = vi.fn(() => new Worker('', { eval: true }));
    await expect(queryDoctorDiagnostics({ signal: controller.signal, createWorker })).rejects.toMatchObject({ name: 'AbortError' });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('runs blocking work off the caller loop and terminates its worker on cancellation', async () => {
    const { queryDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const worker = new Worker("require('node:worker_threads').parentPort.postMessage({ready:true}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);", { eval: true });
    await new Promise<void>((resolve) => worker.once('message', () => resolve()));
    const terminate = vi.spyOn(worker, 'terminate');
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = queryDoctorDiagnostics({ signal: controller.signal, createWorker: () => worker });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).toHaveBeenCalledOnce();
    expect(worker.threadId).toBe(-1);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
  });

  it('releases the worker after success and propagates worker errors without producing a healthy report', async () => {
    const { collectDoctorDiagnostics, queryDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const report = collectDoctorDiagnostics(fixture());
    const worker = new Worker('require("node:worker_threads").parentPort.postMessage(require("node:worker_threads").workerData);', { eval: true, workerData: report });
    const terminate = vi.spyOn(worker, 'terminate');
    expect(await queryDoctorDiagnostics({ createWorker: () => worker })).toEqual(report);
    expect(terminate).toHaveBeenCalledOnce();
    expect(worker.threadId).toBe(-1);

    const broken = new Worker('throw new Error("isolated probe failed");', { eval: true });
    await expect(queryDoctorDiagnostics({ createWorker: () => broken })).rejects.toThrow('isolated probe failed');
    expect(broken.threadId).toBe(-1);
  });

  it('rejects an isolated task that exits without a diagnostic result', async () => {
    const { queryDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const worker = new Worker('', { eval: true });
    await expect(queryDoctorDiagnostics({ createWorker: () => worker })).rejects.toThrow('without a diagnostic result');
    expect(worker.threadId).toBe(-1);
  });

  it('does not return a completed result when cancellation arrives during owner disposal', async () => {
    const { collectDoctorDiagnostics, queryDoctorDiagnostics } = await import('../src/application/diagnostics/index.js');
    const report = collectDoctorDiagnostics(fixture());
    const worker = new Worker('require("node:worker_threads").parentPort.postMessage(require("node:worker_threads").workerData);', { eval: true, workerData: report });
    const controller = new AbortController();
    const terminate = worker.terminate.bind(worker);
    vi.spyOn(worker, 'terminate').mockImplementation(async () => {
      controller.abort();
      return terminate();
    });
    await expect(queryDoctorDiagnostics({ signal: controller.signal, createWorker: () => worker })).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.threadId).toBe(-1);
  });
});
