import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runStatus, type StatusDeps } from '../src/commands/status.js';
import { runDoctor, type DoctorDeps } from '../src/commands/doctor.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-status-doctor-tcp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

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

describe('status 节点客户端/broker 区块', () => {
  it('shows 未运行 when no status files exist', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out.split('\n').at(-1)).toBe('节点客户端: 未运行');
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
    expect(out).toContain('节点客户端: online tcp:br (since ');
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
    expect(out).toMatch(/节点客户端: 重连等待中，下次尝试 \d{2}:\d{2}:\d{2}/);
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
    expect(out).toContain('节点客户端: 未运行');
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
    expect(out).toContain('节点客户端: 未运行'); // 节点腿没有
    expect(out).toContain('broker: 服务端端口 7260，2 节点在线');
    expect(out).toContain('在线机器: box-a、box-b');
  });

  it('skips the whole forwarder section when tcpDir is not wired (zero regression)', async () => {
    const out = await runStatus(baseStatusDeps(), false);
    expect(out).not.toContain('节点客户端');
    expect(out).not.toContain('broker');
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

  it('B2: multiple node daemons each get a tagged line', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeNodeStatus(join(dir, 'tcp'), {
      state: 'online',
      brokerAlias: 'br1',
      since: '2026-10-10T08:00:00.000Z',
      lastUpdated: iso(-5_000),
    });
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'status-node-work.json'), JSON.stringify({
      state: 'reconnect-wait',
      brokerAlias: 'br2',
      since: iso(-10_000),
      lastUpdated: iso(-1_000),
      nextAttemptAt: iso(30_000),
    }));
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    const lines = out.split('\n');
    expect(lines.some((l) => l.startsWith('节点客户端[默认]: online tcp:br1 (since '))).toBe(true);
    expect(lines.some((l) => l.startsWith('节点客户端[work]: 重连等待中，下次尝试 '))).toBe(true);
  });

  it('B2: a stale daemon among several shows its own 未运行 tag line', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeNodeStatus(join(dir, 'tcp'), {
      state: 'online',
      brokerAlias: 'br1',
      since: '2026-10-10T08:00:00.000Z',
      lastUpdated: iso(-5_000),
    });
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'status-node-work.json'), JSON.stringify({
      state: 'online',
      brokerAlias: 'br2',
      since: iso(-600_000),
      lastUpdated: iso(-600_000),
    }));
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out).toContain('节点客户端[work]: 未运行');
    expect(out).not.toContain('节点客户端: 未运行');
  });

  it('B2: --json adds tcpProfiles per daemon while tcp.node/tcp.broker keep their shape', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeNodeStatus(join(dir, 'tcp'), {
      state: 'online',
      brokerAlias: 'br1',
      since: '2026-10-10T08:00:00.000Z',
      lastUpdated: iso(-5_000),
    });
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'status-node-work.json'), JSON.stringify({
      state: 'online',
      brokerAlias: 'br2',
      since: iso(-5_000),
      lastUpdated: iso(-600_000), // 陈旧 → null
    }));
    const parsed = JSON.parse(await runStatus(baseStatusDeps(join(dir, 'tcp')), true)) as {
      tcp: { node: { state: string; brokerAlias: string }; broker: unknown };
      tcpProfiles: Array<{ selector: string; status: { state: string; brokerAlias: string } | null }>;
    };
    expect(Object.keys(parsed.tcp).sort()).toEqual(['broker', 'node']); // tcp 既有键形状不动
    expect(parsed.tcp.node).toMatchObject({ state: 'online', brokerAlias: 'br1' });
    expect(parsed.tcpProfiles).toHaveLength(2);
    expect(parsed.tcpProfiles[0]).toMatchObject({ selector: '', status: { state: 'online', brokerAlias: 'br1' } });
    expect(parsed.tcpProfiles[1]).toEqual({ selector: 'work', status: null });
  });

  it('B2: multi-entry node.json probes each broker for its own roster table', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({
      brokers: [
        { host: 'h1', port: 1, name: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
        { host: 'h2', port: 2, name: 'br2', starId: 'dddd00001111', key: 'k2' },
      ],
    }));
    const seen: Array<string | undefined> = [];
    const deps = baseStatusDeps(join(dir, 'tcp'));
    deps.roster = async (entry) => {
      seen.push(entry?.name);
      if (entry?.name === 'br1') {
        return [
          { name: 'hub', mid8: 'a1b2c3d4', online: true },
          { name: 'beta', mid8: 'bbbb0000', online: false },
        ];
      }
      return undefined; // br2 不可达
    };
    const out = await runStatus(deps, false);
    expect(seen).toEqual(['br1', 'br2']); // 逐条目探
    expect(out).toContain('broker: br1 可达，1 机器在线');
    expect(out).toContain('在线机器[br1]: hub (a1b2c3d4)');
    expect(out).toContain('离线机器[br1]: beta (bbbb0000)');
    expect(out).toContain('broker: br2 不可达');
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

  it('B2 zero regression: a single legacy entry keeps the exact tcp lines (no starId warning)', () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '127.0.0.1', port: 7260, alias: 'br' }, key: 'k' }));
    writeFileSync(join(dir, 'tcp', 'broker.json'), JSON.stringify({ nodes: [{ label: 'node-1', key: 'k', addedAt: 'x' }] }));
    const report = runDoctor(baseDoctorDeps({ tcpDir: join(dir, 'tcp') }));
    const tcpLines = report.output.split('\n').filter((l) => l.includes('tcp') || l.includes('broker TCP'));
    expect(tcpLines).toEqual([
      '✅ tcp 节点配置可解析（broker br）',
      '✅ tcp broker 注册表可解析（1 节点）',
      '✅ broker TCP 可达（127.0.0.1:7260）',
    ]);
    expect(report.output).not.toContain('starId');
    expect(report.failed).toBe(false);
  });

  it('B2: multi-entry node.json gets per-entry lines, missing-starId and duplicate-star warnings', () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      JSON.stringify({
        brokers: [
          { host: '10.0.0.1', port: 7260, alias: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
          { host: '10.0.0.2', port: 7260, alias: 'br2', starId: 'aaaabbbbcccc', key: 'k2' },
          { host: '10.0.0.3', port: 7260, alias: 'br3', key: 'k3' },
        ],
      }),
    );
    const probes: string[] = [];
    const deps = baseDoctorDeps({
      tcpDir: join(dir, 'tcp'),
      probeTcp: (host) => {
        probes.push(host);
        return host === '10.0.0.1';
      },
    });
    const report = runDoctor(deps);
    expect(report.output).toContain('✅ tcp 节点条目 1/3 可解析（broker br1）');
    expect(report.output).toContain('✅ tcp 节点条目 2/3 可解析（broker br2）');
    expect(report.output).toContain('✅ tcp 节点条目 3/3 可解析（broker br3）');
    expect(report.output).toContain('⚠️ 条目 br3 缺 starId（旧配置——连一次自动回填或重新索取 node.json）');
    expect(report.output).toContain('⚠️ 条目 br1 与 br2 的 starId 相同（aaaabbbbcccc）——疑似同一星配了两次');
    expect(report.output).toContain('✅ 条目 1 broker TCP 可达（br1 10.0.0.1:7260）');
    expect(report.output).toContain('❌ 条目 2 broker TCP 不可达（10.0.0.2:7260）——确认 broker 机 crosschat serve 在跑、网络/防火墙放行端口');
    expect(probes).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']); // 各自探活
    expect(report.failed).toBe(true);
  });
});

describe('F1 doctor 版本对账（常驻 vs 本机 CLI）', () => {
  it('版本一致 → 无警告行', () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeBrokerStatus(join(dir, 'tcp'), { state: 'running', port: 7260, lastUpdated: iso(-3_000), version: '1.5.5' });
    writeNodeStatus(join(dir, 'tcp'), { state: 'online', brokerAlias: 'br', since: iso(-60_000), lastUpdated: iso(-3_000), version: '1.5.5' });
    const report = runDoctor(baseDoctorDeps({ tcpDir: join(dir, 'tcp'), cliVersion: '1.5.5' }));
    expect(report.output).not.toContain('升级后未重启');
    expect(report.failed).toBe(false);
  });

  it('broker 版本不一致 → ⚠️ 点名两版本与重启口诀（不 ❌）', () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeBrokerStatus(join(dir, 'tcp'), { state: 'running', port: 7260, lastUpdated: iso(-3_000), version: '1.5.4' });
    const report = runDoctor(baseDoctorDeps({ tcpDir: join(dir, 'tcp'), cliVersion: '1.5.5' }));
    expect(report.output).toContain('⚠️ 常驻进程（broker）为 v1.5.4，本机 v1.5.5——升级后未重启：serve --stop && serve --detach');
    expect(report.failed).toBe(false); // ⚠️ 级不 ❌
  });

  it('节点守护（带选择器）版本不一致单独点名；旧守护无 version 字段跳过不误报', () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'status-node-work.json'), JSON.stringify({ state: 'online', brokerAlias: 'br', since: iso(-60_000), lastUpdated: iso(-3_000), version: '1.4.0' }));
    // 旧守护：status-node.json 无 version 字段 → 不误报
    writeNodeStatus(join(dir, 'tcp'), { state: 'online', brokerAlias: 'br', since: iso(-60_000), lastUpdated: iso(-3_000) });
    const report = runDoctor(baseDoctorDeps({ tcpDir: join(dir, 'tcp'), cliVersion: '1.5.5' }));
    expect(report.output).toContain('⚠️ 常驻进程（节点守护 work）为 v1.4.0，本机 v1.5.5');
    expect(report.output).not.toContain('节点守护）为 vundefined');
    const warns = report.output.match(/升级后未重启/g) ?? [];
    expect(warns).toHaveLength(1); // 只有 work 一条
  });

  it('cliVersion 未接线 → 整项跳过（零回归）', () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeBrokerStatus(join(dir, 'tcp'), { state: 'running', port: 7260, lastUpdated: iso(-3_000), version: '0.0.1' });
    const report = runDoctor(baseDoctorDeps({ tcpDir: join(dir, 'tcp') }));
    expect(report.output).not.toContain('升级后未重启');
  });
});

describe('E0 broker status 行化妆（星名）', () => {
  it('shows the star name between 服务端 and 端口 when the broker status carries one', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeBrokerStatus(join(dir, 'tcp'), {
      state: 'running',
      port: 7260,
      name: 'cloud',
      lastUpdated: iso(-3_000),
      onlineNodes: ['box-a'],
    });
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out).toContain('broker: 服务端 cloud 端口 7260，1 节点在线');
  });

  it('keeps the pre-E0 line shape when the status file has no name', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeBrokerStatus(join(dir, 'tcp'), { state: 'running', port: 7260, lastUpdated: iso(-3_000) });
    const out = await runStatus(baseStatusDeps(join(dir, 'tcp')), false);
    expect(out).toContain('broker: 服务端端口 7260，0 节点在线');
  });
});
