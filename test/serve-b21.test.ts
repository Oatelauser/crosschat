/**
 * 票B B2.1（a″ mid8 双轨寻址）行为测试：双轨路由/同机 deliverLocal/冲突列码/
 * 改名免疫/信封 tcp 盖章+ssh 字节锚点/自动补全三分支/roster/自报名净化/自登记。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import { registryFileOf, tcpDir, writeRegistry, type NodeEntry } from '../src/serve/registry.js';
import { encodeFrame, parseFrame, type Frame } from '../src/serve/protocol.js';
import { fetchRoster, runViaTcpSend } from '../src/serve/via-tcp.js';
import { deliverViaRunSend } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { composeEnvelope } from '../src/envelope.js';
import { encodeOrigin, decodeOriginIdentity } from '../src/federation.js';
import { pickAutoVia, runSend, type SendDeps } from '../src/commands/send.js';
import { ensureSelfEntry, realServeDeps, type ServeDeps } from '../src/commands/serve.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-b21-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const key = (c: string) => c.repeat(64);
const brokers: Broker[] = [];
afterEach(async () => {
  for (const b of brokers.splice(0)) await b.stop();
});

/** 极简 ws 客户端：open→connect(role)→waitFor。 */
class Client {
  private readonly frames: Frame[] = [];
  private readonly waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const frame = parseFrame(data.toString());
      if (frame === undefined) return;
      this.frames.push(frame);
      for (const w of this.waiters.splice(0)) if (w.pred(frame)) w.resolve(frame);
    });
  }
  static async connect(url: string, auth: string, opts: { role: 'node' | 'sender'; machineId?: string; name?: string }): Promise<Client> {
    const c = new Client(new WebSocket(url));
    await new Promise<void>((resolve, reject) => {
      c.ws.once('open', () => resolve());
      c.ws.once('error', reject);
    });
    await c.waitFor((f) => f.op === 'info');
    c.send({ op: 'connect', proto: 1, role: opts.role, ...(opts.machineId === undefined ? {} : { machineId: opts.machineId }), auth, ...(opts.name === undefined ? {} : { name: opts.name }) });
    await c.waitFor((f) => f.op === 'connected');
    return c;
  }
  send(frame: Frame): void {
    this.ws.send(encodeFrame(frame));
  }
  waitFor(pred: (f: Frame) => boolean): Promise<Frame> {
    const seen = this.frames.find(pred);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve) => {
      this.waiters.push({ pred, resolve });
    });
  }
}

interface Harness {
  url: string;
  registryFile: string;
  dir: string;
  deliverLocal: BrokerDeps['deliverLocal'];
  logs: string[];
}

function startHarness(nodes: Partial<NodeEntry>[], overrides: Partial<BrokerDeps> = {}): Promise<Harness> {
  return (async (): Promise<Harness> => {
    const dir = mkdtempSync(join(root, 'case-'));
    const registryFile = registryFileOf(dir);
    writeRegistry(registryFile, {
      nodes: [
        ...nodes.map((n, i) => ({
          label: n.label ?? `node-${i + 1}`,
          key: n.key ?? key(`k${i}`),
          machineId: n.machineId,
          machineName: n.machineName,
          addedAt: '2026-01-01T00:00:00.000Z',
        })),
        { label: 'sender-key', key: key('s'), addedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const logs: string[] = [];
    let deliverLocal: BrokerDeps['deliverLocal'] = async () => ({ op: 'error', code: 'NOT_READY', message: 'no local' });
    if (overrides.deliverLocal !== undefined) deliverLocal = overrides.deliverLocal;
    const broker = new Broker({
      registryFile,
      statusFile: join(dir, 'status-broker.json'),
      version: 'test',
      machineId: () => 'a1b2c3d40000',
      hostname: () => 'broker-host',
      now: () => Date.now(),
      log: (l) => logs.push(l),
      deliverLocal,
      port: 0,
      heartbeatMs: 10_000,
      pongTimeoutMs: 20_000,
      connectTimeoutMs: 5_000,
      ...overrides,
    });
    brokers.push(broker);
    const port = await broker.start();
    return { url: `ws://127.0.0.1:${port}`, registryFile, dir, deliverLocal, logs };
  })();
}

async function senderOn(h: Harness): Promise<Client> {
  return Client.connect(h.url, key('s'), { role: 'sender' });
}

describe('B2.1 dual-track addressing', () => {
  it('routes by mid8 prefix, by name, and by label to the right node', async () => {
    const h = await startHarness([
      { machineId: 'aaaa00001111', machineName: 'alpha' },
      { machineId: 'bbbb00002222', machineName: 'beta' },
    ]);
    const alpha = await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'aaaa00001111' });
    const beta = await Client.connect(h.url, key('k1'), { role: 'node', machineId: 'bbbb00002222' });
    const sender = await senderOn(h);
    sender.send({ op: 'send', id: 'm1', targetMachine: 'aaaa0000', body: 'by-mid8' });
    sender.send({ op: 'send', id: 'm2', targetMachine: 'beta', body: 'by-name' });
    sender.send({ op: 'send', id: 'm3', targetMachine: 'node-2', body: 'by-label' });
    const d1 = await alpha.waitFor((f) => f.op === 'deliver' && f.id === 'm1');
    expect(d1.op === 'deliver' && d1.payload).toBe('by-mid8');
    const d2 = await beta.waitFor((f) => f.op === 'deliver' && f.id === 'm2');
    const d3 = await beta.waitFor((f) => f.op === 'deliver' && f.id === 'm3');
    expect(d2.op === 'deliver' && d2.payload).toBe('by-name');
    expect(d3.op === 'deliver' && d3.payload).toBe('by-label');
  }, 10_000);

  it('routes a same-machine target (machineId === broker own) to deliverLocal, not to a node', async () => {
    const local: string[] = [];
    const h = await startHarness([{ machineId: 'a1b2c3d40000', machineName: 'hub' }], {
      deliverLocal: async (frame) => {
        local.push(frame.body);
        return { op: 'result', id: frame.id, status: 'delivered', turn: '1' };
      },
    });
    const sender = await senderOn(h);
    sender.send({ op: 'send', id: 's1', targetMachine: 'a1b2c3d4', body: 'to-self-by-mid' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 's1');
    expect(receipt.op === 'receipt' && receipt.status).toBe('delivered');
    expect(local).toEqual(['to-self-by-mid']);
  }, 10_000);

  it('mid prefix ambiguity → MACHINE_NAME_COLLISION listing 12-char mids, teaching lengthening', async () => {
    const h = await startHarness([
      { machineId: 'aaaa0000aa11', machineName: 'alpha' },
      { machineId: 'aaaa0000bb22', machineName: 'beta' },
    ]);
    const sender = await senderOn(h);
    sender.send({ op: 'send', id: 'x', targetMachine: 'aaaa0000', body: '?' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('MACHINE_NAME_COLLISION');
    const message = err.op === 'error' ? err.message : '';
    expect(message).toContain('aaaa0000aa11');
    expect(message).toContain('aaaa0000bb22');
    expect(message).toContain('加长');
  }, 10_000);

  it('name collision (offline entries included) → collision lists mids, teaches mid addressing', async () => {
    const h = await startHarness([
      { machineId: 'cccc00001111', machineName: 'dup' },
      { machineId: 'dddd00002222', machineName: 'dup' },
    ]);
    const sender = await senderOn(h);
    sender.send({ op: 'send', id: 'x', targetMachine: 'dup', body: '?' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('MACHINE_NAME_COLLISION');
    const message = err.op === 'error' ? err.message : '';
    expect(message).toContain('cccc00001111');
    expect(message).toContain('dddd00002222');
    expect(message).toContain('mid');
  }, 10_000);
});

describe('B2.1 self-reported name lifecycle', () => {
  it('sanitizes the connect name (>32 truncated, control chars stripped)', async () => {
    const h = await startHarness([{ key: key('k0') }]);
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'eeee00001111', name: `${'x'.repeat(40)}\u0007尾` });
    const entry = JSON.parse(readFileSync(h.registryFile, 'utf8')) as { nodes: NodeEntry[] };
    const name = entry.nodes[0]!.machineName ?? '';
    expect(name.length).toBeLessThanOrEqual(32);
    // eslint-disable-next-line no-control-regex -- 断言控制符已剥
    expect(name).not.toMatch(/[\u0000-\u001f]/);
    expect(name.startsWith('xxxx')).toBe(true);
  }, 10_000);

  it('reconnecting with a new name overwrites the registry entry', async () => {
    const h = await startHarness([{ key: key('k0') }]);
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'eeee00001111', name: 'old-name' });
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'eeee00001111', name: 'new-name' });
    const entry = JSON.parse(readFileSync(h.registryFile, 'utf8')) as { nodes: NodeEntry[] };
    expect(entry.nodes[0]!.machineName).toBe('new-name');
  }, 10_000);

  it('rename immunity: mid8 routing still hits the node after it renamed', async () => {
    const h = await startHarness([{ key: key('k0'), machineId: 'ffff00001111', machineName: 'alpha' }]);
    const node = await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'ffff00001111', name: 'alpha' });
    const renamed = await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'ffff00001111', name: 'alpha-2' });
    node.ws.close();
    const sender = await senderOn(h);
    sender.send({ op: 'send', id: 'r1', targetMachine: 'ffff0000', body: 'after-rename' });
    const d = await renamed.waitFor((f) => f.op === 'deliver' && f.id === 'r1');
    expect(d.op === 'deliver' && d.payload).toBe('after-rename');
  }, 10_000);

  it('warns in the log on a mid8 collision at registration', async () => {
    const h = await startHarness([
      { key: key('k0') },
      { key: key('k1'), machineId: '12340000aaaa', machineName: 'taken' },
    ]);
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: '12340000bbbb', name: 'newcomer' });
    expect(h.logs.some((l) => l.includes('mid8 碰撞') && l.includes('12340000'))).toBe(true);
  }, 10_000);
});

describe('B2.1 roster', () => {
  it('broker answers roster with name/mid8/online; broker self always online', async () => {
    const h = await startHarness([
      { machineId: 'a1b2c3d40000', machineName: 'hub' },
      { machineId: 'aaaa00001111', machineName: 'alpha' },
      { machineId: 'bbbb00002222', machineName: 'beta' },
    ]);
    await Client.connect(h.url, key('k1'), { role: 'node', machineId: 'aaaa00001111' });
    const sender = await senderOn(h);
    sender.send({ op: 'roster' });
    const res = await sender.waitFor((f) => f.op === 'roster-result');
    expect(res.op === 'roster-result' && res.machines).toEqual([
      { name: 'hub', mid8: 'a1b2c3d4', online: true },
      { name: 'alpha', mid8: 'aaaa0000', online: true },
      { name: 'beta', mid8: 'bbbb0000', online: false },
    ]);
  }, 10_000);

  it('fetchRoster works against a live broker and returns undefined when unreachable', async () => {
    const h = await startHarness([{ machineId: 'a1b2c3d40000', machineName: 'hub' }]);
    const home = mkdtempSync(join(root, 'home-'));
    mkdirSync(join(home, 'tcp'), { recursive: true });
    writeFileSync(
      join(home, 'tcp', 'node.json'),
      JSON.stringify({ broker: { host: '127.0.0.1', port: Number(new URL(h.url).port) }, key: key('s') }),
    );
    const machines = await fetchRoster(home, 2_000);
    expect(machines).toEqual([{ name: 'hub', mid8: 'a1b2c3d4', online: true }]);
    const badHome = mkdtempSync(join(root, 'bad-'));
    mkdirSync(join(badHome, 'tcp'), { recursive: true });
    writeFileSync(join(badHome, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '127.0.0.1', port: 1 }, key: key('s') }));
    expect(await fetchRoster(badHome, 500)).toBeUndefined();
  }, 10_000);
});

describe('B2.1 reply loop closure', () => {
  it('origin codec: tcp prefix round-trips; ssh/local origins decode without via', () => {
    const identity = { p: 'codex' as const, id: '01a1115b-1a3c-7e71-addc-fee969078e1b' };
    const tcp = encodeOrigin(identity, 'abcd1234', 'abcd1234ef56', 'tcp');
    const decoded = decodeOriginIdentity(tcp);
    expect(decoded.host).toBe('abcd1234');
    expect(decoded.mid).toBe('abcd1234ef56');
    expect(decoded.via).toBe('tcp');
    const ssh = decodeOriginIdentity(encodeOrigin(identity, 'build01', 'm-1'));
    expect(ssh.via).toBeUndefined();
    expect(ssh.host).toBe('build01');
  });

  it('envelope: one unified reply command for every transport (A+ 瘦身)', () => {
    const base = { fromName: 'boss', toName: 'beta', turn: 2, ref: 'mc2_x', body: 'hi' };
    const out = composeEnvelope(base);
    expect(out).toContain('crosschat send --conversation mc2_x --body "<你的回复>"');
    expect(out).not.toContain('--via');
    expect(out).not.toContain('tcp:');
    expect(out).not.toContain('ssh:');
  });

  it('runSend renders the same hint for tcp origins (auto-routing replaces --via)', async () => {
    const envelopes: string[] = [];
    const deps: SendDeps = {
      env: {},
      listClaudeSessions: () => ({
        sessions: [{ pid: 1, sessionId: 's1', kind: 'interactive', name: 'boss', status: 'idle', messagingSocketPath: 'p' }],
        malformed: 0,
      }),
      listCodexThreads: () => [],
      deliverClaude: async (_t, content) => {
        envelopes.push(content);
        return { status: 'delivered' };
      },
      deliverCodex: async () => ({ status: 'delivered' }),
      sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
      hostname: () => 'node-b',
      machineId: () => 'bbbb0000ef',
    };
    const origin = encodeOrigin({ p: 'codex', id: '01a1115b-1a3c-7e71-addc-fee969078e1b' }, 'aaaa0000', 'aaaa0000ef12', 'tcp');
    const out = await runSend({ to: 'boss', bodyArg: 'hello', origin }, deps);
    expect(out).toContain('delivered to boss');
    // A+：回信命令不带 --via——路由由执行侧按 ref 自动补（send.ts autoViaFromRef）
    expect(envelopes[0]).not.toContain('--via');
    expect(envelopes[0]).toContain('crosschat send --conversation mc2_');
  });

  it('pickAutoVia three branches: ssh alias wins byte-identically, tcp when a usable entry exists, else ssh', () => {
    const sshConfig = 'Host build01 peer\n  HostName 10.0.0.2\n';
    // 1) ssh config 有别名 → 照旧 ssh（字节不变）
    expect(pickAutoVia('build01', { sshConfigText: () => sshConfig, tcpBaseDir: 'x' })).toBe('ssh:build01');
    // 2) 无别名 + 本机有可用 tcp 条目（readNodeConfig 成功）→ tcp（tcp 对话的 m=mid8）
    const home = mkdtempSync(join(root, 'via-'));
    mkdirSync(join(home, 'tcp'), { recursive: true });
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '10.0.0.9', port: 7260 }, key: 'k' }));
    expect(pickAutoVia('abcd1234', { sshConfigText: () => sshConfig, tcpBaseDir: home })).toBe('tcp:abcd1234');
    // B1：node.json 存在但不可用（坏形状/空条目）→ 不再引上必死的 tcp 腿，照旧 ssh
    writeFileSync(join(home, 'tcp', 'node.json'), '{}');
    expect(pickAutoVia('abcd1234', { sshConfigText: () => sshConfig, tcpBaseDir: home })).toBe('ssh:abcd1234');
    // 3) 无别名 + 无 node.json → 照旧 ssh
    expect(pickAutoVia('abcd1234', { sshConfigText: () => sshConfig, tcpBaseDir: join(root, 'nope') })).toBe('ssh:abcd1234');
    expect(pickAutoVia('build01', {})).toBe('ssh:build01');
  });
});

describe('B1 self node.json starId backfill (ensureSelfEntry)', () => {
  function selfDeps(dir: string): ServeDeps {
    return { ...realServeDeps(), baseDir: dir, machineId: () => 'a1b2c3d40000', hostname: () => 'hub' };
  }

  it('backfills the registry starId into a matching entry that lacks it, touching nothing else', () => {
    const dir = mkdtempSync(join(root, 'b1self-'));
    const deps = selfDeps(dir);
    const registryFile = registryFileOf(dir);
    mkdirSync(tcpDir(dir), { recursive: true });
    const nodeJson = join(tcpDir(dir), 'node.json');
    writeRegistry(registryFile, {
      starId: 'aaaabbbbcccc',
      nodes: [{ label: 'self', key: 'k', machineId: 'a1b2c3d40000', machineName: 'hub', addedAt: '2026-01-01T00:00:00.000Z' }],
    });
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '127.0.0.1', port: 7260, alias: 'hub' }, key: 'k', name: 'hub' }, null, 2));
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'ok' });
    const parsed = JSON.parse(readFileSync(nodeJson, 'utf8')) as { broker: { host: string; port: number; name?: string; alias?: string; starId?: string }; key: string; showName?: string };
    expect(parsed.broker.starId).toBe('aaaabbbbcccc');
    expect(parsed.key).toBe('k');
    expect(parsed.showName).toBe('hub'); // E0：重写时顶层旧 name 并轨为 showName
    expect(parsed.broker.name).toBe('hub'); // 旧 alias 值并轨进 name（=星名，注册表缺省轨道同取 hostname）
    // 注册表 starId 原样未被改写
    expect((JSON.parse(readFileSync(registryFile, 'utf8')) as { starId?: string }).starId).toBe('aaaabbbbcccc');
  });

  it('generates a starId when the registry lacks one; never rewrites an entry that already has one', () => {
    const dir = mkdtempSync(join(root, 'b1self-'));
    const deps = selfDeps(dir);
    const registryFile = registryFileOf(dir);
    mkdirSync(tcpDir(dir), { recursive: true });
    const nodeJson = join(tcpDir(dir), 'node.json');
    writeRegistry(registryFile, {
      nodes: [{ label: 'self', key: 'k', machineId: 'a1b2c3d40000', machineName: 'hub', addedAt: '2026-01-01T00:00:00.000Z' }],
    });
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '127.0.0.1', port: 7260, alias: 'hub' }, key: 'k', name: 'hub' }, null, 2));
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'ok' });
    const starId = (JSON.parse(readFileSync(nodeJson, 'utf8')) as { broker: { starId?: string } }).broker.starId;
    expect(starId).toMatch(/^[0-9a-f]{12}$/);
    expect((JSON.parse(readFileSync(registryFile, 'utf8')) as { starId?: string }).starId).toBe(starId);
    // 已有 starId（即便与注册表不同）→ 不重写
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '127.0.0.1', port: 7260, alias: 'hub', starId: 'deadbeef0000' }, key: 'k', name: 'hub' }, null, 2));
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'ok' });
    expect((JSON.parse(readFileSync(nodeJson, 'utf8')) as { broker: { starId?: string } }).broker.starId).toBe('deadbeef0000');
  });
});

describe('B2.1 serve self-init', () => {
  it('registers a self entry and writes the local node.json (127.0.0.1); idempotent, status written→ok', () => {
    const dir = mkdtempSync(join(root, 'self-'));
    const deps: ServeDeps = {
      ...realServeDeps(),
      baseDir: dir,
      machineId: () => 'a1b2c3d40000',
      hostname: () => 'hub',
    };
    const registryFile = registryFileOf(dir);
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'written' });
    const reg = JSON.parse(readFileSync(registryFile, 'utf8')) as { nodes: NodeEntry[] };
    expect(reg.nodes).toHaveLength(1);
    expect(reg.nodes[0]).toMatchObject({ label: 'self', machineId: 'a1b2c3d40000', machineName: 'hub' });
    const nodeJson = JSON.parse(readFileSync(join(tcpDir(dir), 'node.json'), 'utf8')) as { brokers: { host: string; port: number; name: string; starId: string; key: string }[]; showName: string };
    // B-fix：自用 node.json 新写一律数组形状（单星=一项）；E0 词表：name=星名、showName=本机显示名
    expect(nodeJson.brokers).toHaveLength(1);
    expect(nodeJson.brokers[0]).toEqual({ host: '127.0.0.1', port: 7260, name: 'hub', starId: expect.any(String), key: expect.any(String) });
    expect(nodeJson.showName).toBe('hub');
    // B0：自用条目的 starId 与注册表一致（12 hex）
    expect(nodeJson.brokers[0]!.starId).toMatch(/^[0-9a-f]{12}$/);
    expect((JSON.parse(readFileSync(registryFile, 'utf8')) as { starId?: string }).starId).toBe(nodeJson.brokers[0]!.starId);
    // 幂等：再来一次不重复登记、不覆盖既有 node.json，状态 ok（静默分支）
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'ok' });
    const reg2 = JSON.parse(readFileSync(registryFile, 'utf8')) as { nodes: NodeEntry[] };
    expect(reg2.nodes).toHaveLength(1);
    expect(existsSync(join(tcpDir(dir), 'node.json'))).toBe(true);
  });

  // 三态体检（B-fix 语义：按"本 broker 钥匙条目"定位——多星机上自用条目与外星条目共存）：
  // 无本 broker 钥匙 → foreign（文件指向谁就报谁）；有钥匙条目但 host/port 不符 → stale；坏文件 → stale
  it('classifies an existing node.json as foreign or stale without touching it', () => {
    const dir = mkdtempSync(join(root, 'self-'));
    const deps: ServeDeps = {
      ...realServeDeps(),
      baseDir: dir,
      machineId: () => 'a1b2c3d40000',
      hostname: () => 'hub',
    };
    const registryFile = registryFileOf(dir);
    const nodeJson = join(tcpDir(dir), 'node.json');
    mkdirSync(tcpDir(dir), { recursive: true });
    // 旧形状他星配置：钥匙不是本 broker 的 → foreign
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '192.168.1.5', port: 7260, alias: 'other' }, key: 'k', name: 'n' }));
    expect(ensureSelfEntry(deps, registryFile, 7260)).toMatchObject({ status: 'foreign', host: '192.168.1.5' });
    // 数组形状含外星条目：同样 foreign（报首条指向）
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '10.9.9.9', port: 7260, alias: 'w', key: 'wk' }], name: 'n' }));
    expect(ensureSelfEntry(deps, registryFile, 7260)).toMatchObject({ status: 'foreign', host: '10.9.9.9' });
    // 本 broker 钥匙条目在、但端口不符（数组形状）→ stale
    const selfKey = (JSON.parse(readFileSync(registryFile, 'utf8')) as { nodes: NodeEntry[] }).nodes[0]!.key!;
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 8123, alias: 'hub', key: selfKey }], name: 'hub' }));
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'stale' });
    writeFileSync(nodeJson, 'not json at all');
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'stale' });
    expect(readFileSync(nodeJson, 'utf8')).toBe('not json at all');
  });
});

describe('B3.1 drill fixes', () => {
  function codexSendDeps(over: { queued?: boolean; receipt?: 'confirmed' | 'unconfirmed' }): SendDeps {
    return {
      env: {},
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [{ id: 'b0ss0000-aaaa', name: 'boss', status: 'idle' }],
      deliverClaude: async () => ({ status: 'delivered' }),
      deliverCodex: async () => ({ status: 'accepted', turnId: 't', ...(over.queued === true ? { queued: true } : {}) }),
      ...(over.receipt === undefined ? {} : { confirmReceipt: async () => over.receipt }),
      sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
    };
  }

  it('bug1: json output stays pure JSON when codex queues (node bridge can parse it)', async () => {
    const out = await runSend({ to: 'boss', bodyArg: 'x', json: true }, codexSendDeps({ queued: true }));
    const parsed = JSON.parse(out) as { status: string; queued?: boolean };
    expect(parsed.status).toBe('delivered');
    expect(parsed.queued).toBe(true);
    expect(out).not.toContain('已入对方服务端队列');
  });

  it('bug1: json output stays pure JSON when the rollout receipt is unconfirmed', async () => {
    const out = await runSend({ to: 'boss', bodyArg: 'x', json: true }, codexSendDeps({ receipt: 'unconfirmed' }));
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain('回执:');
  });

  it('bug1 end-to-end: --file via tcp against a queued node returns delivered output, not INTERNAL', async () => {
    const inboxDir = mkdtempSync(join(root, 'b31-inbox-'));
    const partsDir = mkdtempSync(join(root, 'b31-parts-'));
    const nodeDeps = codexSendDeps({ queued: true });
    const h = await startHarness([{ machineId: 'a1b2c3d40000', machineName: 'hub' }], {
      deliverLocal: (frame, fromMachine) =>
        deliverViaRunSend(
          { op: 'deliver', id: frame.id, ...(fromMachine === undefined ? {} : { fromMachine }), payload: frame.body, to: frame.to, conversation: frame.conversation, origin: frame.origin },
          nodeDeps,
        ),
      fileInbox: new FileInbox({ inboxDir, partsDir }),
    });
    const home = mkdtempSync(join(root, 'b31-home-'));
    mkdirSync(join(home, 'tcp'), { recursive: true });
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '127.0.0.1', port: Number(new URL(h.url).port) }, key: key('s') }));
    const file = join(home, 'drill-a.txt');
    writeFileSync(file, 'payload');
    const out = await runViaTcpSend(
      { via: 'tcp:hub', to: 'boss', fileArg: file, bodyArg: 'drill-a 附件测试' },
      'drill-a 附件测试',
      { ...nodeDeps, tcpBaseDir: home, hostname: () => 'ci-machine', machineId: () => 'cccc00001111' },
    );
    expect(out).toContain('delivered to boss@hub');
    expect(out).not.toContain('INTERNAL');
    expect(out).toMatch(/turn \d/);
  }, 10_000);

  it('bug2: a remote-origin send running inside an agent-env process keeps the origin display name', async () => {
    const envelopes: string[] = [];
    const deps: SendDeps = {
      env: { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-1' }, // 接收进程（broker/节点）残留的 agent 环境
      listClaudeSessions: () => ({
        sessions: [{ pid: 1, sessionId: 's1', kind: 'interactive', name: 'target-name', status: 'idle', messagingSocketPath: 'sock-1' }],
        malformed: 0,
      }),
      listCodexThreads: async () => [],
      deliverClaude: async (_t, content) => {
        envelopes.push(content);
        return { status: 'delivered' };
      },
      deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
      sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
    };
    const origin = encodeOrigin({ p: 'claude', id: 'sender-s9', name: 'wsl-boss' }, 'aaaa0000', 'aaaa0000ef', 'tcp');
    const out = await runSend({ to: 'target-name', bodyArg: 'hi', origin }, deps);
    expect(out).toContain('delivered to target-name');
    expect(envelopes[0]).toContain('from-name="wsl-boss"');
    expect(envelopes[0]).not.toContain('from-name="target-name"');
  });
});

describe('E0 ensureSelfEntry 星名同步（broker 自用条目不走节点客户端，在此对齐）', () => {
  it('overwrites a legacy alias with the registry star name (and keeps starId untouched)', () => {
    const dir = mkdtempSync(join(root, 'e0self-'));
    const deps = { ...realServeDeps(), baseDir: dir, machineId: () => 'a1b2c3d40000', hostname: () => 'hub' } as ServeDeps;
    const registryFile = registryFileOf(dir);
    mkdirSync(tcpDir(dir), { recursive: true });
    const nodeJson = join(tcpDir(dir), 'node.json');
    writeRegistry(registryFile, {
      starId: 'aaaabbbbcccc',
      name: 'cloud',
      nodes: [{ label: 'self', key: 'k', machineId: 'a1b2c3d40000', machineName: 'hub', addedAt: '2026-01-01T00:00:00.000Z' }],
    });
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '127.0.0.1', port: 7260, alias: 'hub', starId: 'aaaabbbbcccc' }, key: 'k', name: 'hub' }, null, 2));
    expect(ensureSelfEntry(deps, registryFile, 7260)).toEqual({ status: 'ok' });
    const parsed = JSON.parse(readFileSync(nodeJson, 'utf8')) as { broker: { name?: string; alias?: string; starId?: string }; showName?: string; name?: string };
    expect(parsed.broker.name).toBe('cloud'); // 星名以注册表为准（显式 --name cloud）
    expect(parsed.broker.alias).toBeUndefined();
    expect(parsed.broker.starId).toBe('aaaabbbbcccc'); // 既有 starId 不碰
    expect(parsed.showName).toBe('hub');
    expect(parsed.name).toBeUndefined();
  });
});
