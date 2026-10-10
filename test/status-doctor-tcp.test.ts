import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runStatus, type StatusDeps } from '../src/commands/status.js';
import { runDoctor, type DoctorDeps } from '../src/commands/doctor.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-status-doctor-tcp-'));

function baseStatusDeps(tcpDir?: string): StatusDeps {
  return {
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [],
    ...(tcpDir === undefined ? {} : { tcpDir }),
  };
}

const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

function writeNodeStatus(dir: string, status: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status-node.json'), JSON.stringify(status));
}

function writeBrokerStatus(dir: string, status: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status-broker.json'), JSON.stringify(status));
}

describe('status 转发器区块', () => {
  it('shows 未运行 when no status files exist', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out.split('\n').at(-1)).toBe('转发器: 未运行');
  });

  it('shows online with alias and since for a fresh node status', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeNodeStatus(join(dir, 'tcp'), {
      state: 'online',
      brokerAlias: 'br',
      since: '2026-10-10T08:00:00.000Z',
      lastUpdated: iso(-5_000),
    });
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out).toContain('转发器: online tcp:br (since ');
  });

  it('shows the reconnect-wait line with the next attempt for a fresh waiting node', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeNodeStatus(join(dir, 'tcp'), {
      state: 'reconnect-wait',
      brokerAlias: 'br',
      since: iso(-10_000),
      lastUpdated: iso(-1_000),
      nextAttemptAt: iso(30_000),
    });
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out).toMatch(/转发器: 重连等待中，下次尝试 \d{2}:\d{2}:\d{2}/);
  });

  it('treats a stale (>90s) node status as 未运行', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeNodeStatus(join(dir, 'tcp'), {
      state: 'online',
      brokerAlias: 'br',
      since: iso(-600_000),
      lastUpdated: iso(-120_000),
    });
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out).toContain('转发器: 未运行');
  });

  it('shows the broker line plus online machines from a fresh running broker status', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeBrokerStatus(join(dir, 'tcp'), {
      state: 'running',
      port: 7260,
      lastUpdated: iso(-3_000),
      onlineNodes: ['box-a', 'box-b'],
    });
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out).toContain('转发器: 未运行'); // 节点腿没有
    expect(out).toContain('转发器: 服务端端口 7260，2 节点在线');
    expect(out).toContain('在线机器: box-a、box-b');
  });

  it('skips the whole 转发器 section when tcpDir is not wired (zero regression)', async () => {
    const out = await runStatus(baseStatusDeps(), false);
    expect(out).not.toContain('转发器');
    const parsed = JSON.parse(await runStatus(baseStatusDeps(), true)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['claude', 'codex']);
  });

  it('json mode carries the tcp section only when tcpDir is wired', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeBrokerStatus(join(dir, 'tcp'), {
      state: 'running',
      port: 7260,
      lastUpdated: iso(-3_000),
      onlineNodes: ['box-a'],
    });
    const parsed = JSON.parse(await runStatus(baseStatusDeps(join(dir, 'tcp')), true)) as {
      tcp: { node: unknown; broker: { port: number; onlineNodes: string[] } };
    };
    expect(parsed.tcp.node).toBeNull();
    expect(parsed.tcp.broker).toEqual({ port: 7260, onlineNodes: ['box-a'] });
  });
});

function baseDoctorDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    nodeVersion: '22.0.0',
    env: {},
    resolveClaude: () => 'claude',
    listClaudeSessions: () => ({ sessions: [{ pid: 1, sessionId: 's', kind: 'interactive', name: 'n', status: 'idle', messagingSocketPath: 'p' }], malformed: 0 }),
    codexBin: () => 'codex',
    run: () => ({ status: 0, stdout: '0.160.0' }),
    exists: () => true,
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    homeDir: () => root,
    listOutbox: () => [],
    repoSkillContent: () => 'skill',
    probeTcp: () => true,
    ...overrides,
  };
}

describe('doctor tcp 三项检查', () => {
  it('skips tcp checks when tcpDir is not wired', () => {
    const deps = baseDoctorDeps();
    const report = runDoctor(deps);
    expect(report.output).not.toContain('tcp');
    expect(report.failed).toBe(false);
  });

  it('passes all three when configs parse and the broker is reachable', () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '127.0.0.1', port: 7260, alias: 'br' }, key: 'k' }));
    writeFileSync(join(dir, 'tcp', 'broker.json'), JSON.stringify({ nodes: [{ label: 'node-1', key: 'k', addedAt: 'x' }] }));
    const deps = baseDoctorDeps({ tcpDir: join(dir, 'tcp') });
    const report = runDoctor(deps);
    expect(report.output).toContain('✅ tcp 节点配置可解析（broker br）');
    expect(report.output).toContain('✅ tcp broker 注册表可解析（1 节点）');
    expect(report.output).toContain('✅ broker TCP 可达（127.0.0.1:7260）');
    expect(report.failed).toBe(false);
  });

  it('fails on a corrupt node.json and an unreachable broker', () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'node.json'), '{not json');
    const deps = baseDoctorDeps({ tcpDir: join(dir, 'tcp'), probeTcp: () => false });
    const report = runDoctor(deps);
    expect(report.output).toContain('❌ tcp 节点配置 node.json 损坏');
    expect(report.failed).toBe(true);
  });

  it('fails with guidance when the broker socket is unreachable', () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '10.255.255.1', port: 7260 }, key: 'k' }));
    const deps = baseDoctorDeps({ tcpDir: join(dir, 'tcp'), probeTcp: () => false });
    const report = runDoctor(deps);
    expect(report.output).toContain('❌ broker TCP 不可达');
    expect(report.output).toContain('crosschat serve');
    expect(report.failed).toBe(true);
  });
});
