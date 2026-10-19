/**
 * F0 热修（machineId 跨形态归一）行为测试：
 * 四形态互投矩阵（drill 真实值）/onConnect 绑定双侧归一/roster 与注册碰撞
 * mid8 归一/UNKNOWN_MACHINE did-you-mean/conversation ref 回信带杠机器集成。
 * 铁律锚点：存储与帧保持历史形态（注册表写值=帧原值，ref 编解码不动）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import { registryFileOf, type NodeEntry } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';
import { encodeFrame, parseFrame, type Frame } from '../src/serve/protocol.js';
import { runSend, type SendDeps } from '../src/commands/send.js';
import { encodeRef } from '../src/ref.js';
import { normalizeMid } from '../src/platform/machine-id.js';
import type { ClaudeRegistryScan } from '../src/claude/registry.js';
import type { CodexThreadSummary } from '../src/codex/client.js';

// drill 实证的真实形态：Windows MachineGuid 带杠 UUID 与其纯 hex 形态
const DASHED = 'ec542c2c-28e7-42d1-9028-10f989d21f8b';
const PURE = 'ec542c2c28e742d1902810f989d21f8b';

const root = mkdtempSync(join(tmpdir(), 'crosschat-f0-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const key = (c: string) => c.repeat(64);
const brokers: Broker[] = [];
afterEach(async () => {
  for (const b of brokers.splice(0)) await b.stop();
});

function seed(file: string, nodes: Partial<NodeEntry>[]): void {
  seedBroker(file, {
    stars: [{
      nodes: nodes.map((n, i) => ({
        label: n.label ?? `node-${i + 1}`,
        key: n.key ?? key(`k${i}`),
        machineId: n.machineId,
        machineName: n.machineName,
        addedAt: '2026-01-01T00:00:00.000Z',
      })),
    }],
  });
}

async function startBroker(nodes: Partial<NodeEntry>[], overrides: Partial<BrokerDeps> = {}): Promise<{
  url: string;
  registryFile: string;
  logs: string[];
}> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  seed(registryFile, [...nodes, { label: 'sender-key', key: key('s') }]);
  const logs: string[] = [];
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: 'test',
    machineId: () => '1111aaaa2222bbbb', // Linux 形态 broker（纯 hex），与被测带杠机器异机
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: (l) => logs.push(l),
    deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'no local' }),
    port: 0,
    heartbeatMs: 10_000,
    pongTimeoutMs: 20_000,
    connectTimeoutMs: 5_000,
    ...overrides,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { url: `ws://127.0.0.1:${port}`, registryFile, logs };
}

/** 极简 ws 客户端（b21 同款）：open→info→connect(role)→waitFor。 */
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
  static async raw(url: string): Promise<Client> {
    const c = new Client(new WebSocket(url));
    await new Promise<void>((resolve, reject) => {
      c.ws.once('open', () => resolve());
      c.ws.once('error', reject);
    });
    await c.waitFor((f) => f.op === 'info');
    return c;
  }
  static async connect(url: string, auth: string, opts: { role: 'node' | 'sender'; machineId?: string; name?: string }): Promise<Client> {
    const c = await Client.raw(url);
    c.send({
      op: 'connect',
      proto: 1,
      role: opts.role,
      ...(opts.machineId === undefined ? {} : { machineId: opts.machineId }),
      auth,
      ...(opts.name === undefined ? {} : { name: opts.name }),
      caps: ['multi-star'],
    });
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

async function senderOn(url: string): Promise<Client> {
  return Client.connect(url, key('s'), { role: 'sender' });
}

/** 带杠机器节点上线（真实形态：Windows 的 machineId() 恒带杠）。 */
async function dashedNodeOnline(url: string, k: string, machineId: string, name = 'win-box'): Promise<Client> {
  return Client.connect(url, k, { role: 'node', machineId, name });
}

/** 一笔 send→deliver→result→receipt 完整投递；返回 deliver 帧（证路由命中）。 */
async function roundTrip(sender: Client, node: Client, spec: string, id: string): Promise<Frame> {
  sender.send({ op: 'send', id, targetMachine: spec, body: `to-${id}` });
  const deliver = await node.waitFor((f) => f.op === 'deliver' && f.id === id);
  node.send({
    op: 'result',
    id,
    status: 'delivered',
    turn: '1',
    output: JSON.stringify({ status: 'delivered', to: 'workteam', turn: 1 }),
  });
  const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === id);
  expect(receipt.op === 'receipt' && receipt.status).toBe('delivered');
  return deliver;
}

describe('F0 normalizeMid（归一函数）', () => {
  it('drill 真实形态：带杠 UUID ↔ 纯 hex 互为归一结果', () => {
    expect(normalizeMid(DASHED)).toBe(PURE);
    expect(normalizeMid(PURE)).toBe(PURE);
    expect(normalizeMid(DASHED.toUpperCase())).toBe(PURE); // 大写带杠同归
    expect(normalizeMid('ec542c2c-28e7')).toBe('ec542c2c28e7'); // 带杠短前缀
  });

  it('非 hex 全剥；空/纯垃圾归一为空串（比对边界据此跳过）', () => {
    expect(normalizeMid('')).toBe('');
    expect(normalizeMid('---')).toBe('');
    expect(normalizeMid('zzz')).toBe('');
  });
});

describe('F0 四形态互投矩阵（注册表形态 × spec 形态，节点以真实带杠帧上线）', () => {
  const cases: { registry: string; spec: string; tag: string }[] = [
    { registry: DASHED, spec: DASHED, tag: '带杠×带杠' },
    { registry: DASHED, spec: PURE, tag: '带杠×纯hex' },
    { registry: PURE, spec: DASHED, tag: '纯×带杠' },
    { registry: PURE, spec: PURE, tag: '纯×纯' },
  ];
  for (const c of cases) {
    it(`注册表 ${c.tag}：send 直达节点（原 hex 判定拒收带杠 → UNKNOWN_MACHINE）`, async () => {
      const h = await startBroker([{ key: key('k0'), machineId: c.registry, machineName: 'win-box' }]);
      const node = await dashedNodeOnline(h.url, key('k0'), DASHED); // 帧值恒带杠（存储历史形态）
      const sender = await senderOn(h.url);
      const deliver = await roundTrip(sender, node, c.spec, 'm1');
      expect(deliver).toMatchObject({ op: 'deliver', payload: 'to-m1' });
    }, 10_000);
  }

  it('带杠前缀 spec（截断在杠上）也按归一前缀命中', async () => {
    const h = await startBroker([{ key: key('k0'), machineId: PURE, machineName: 'win-box' }]);
    const node = await dashedNodeOnline(h.url, key('k0'), DASHED);
    const sender = await senderOn(h.url);
    await roundTrip(sender, node, 'ec542c2c-28e7', 'm2'); // 归一 'ec542c2c28e7' = 前缀
  }, 10_000);

  it('归一前缀歧义仍 MACHINE_NAME_COLLISION（多命中教学不变）', async () => {
    const h = await startBroker([
      { key: key('k0'), machineId: DASHED, machineName: 'win-a' },
      { key: key('k1'), machineId: 'ec542c2c28e742d1aaaa0f989d21f8b', machineName: 'win-b' },
    ]);
    const sender = await senderOn(h.url);
    sender.send({ op: 'send', id: 'x', targetMachine: 'ec542c2c', body: '?' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('MACHINE_NAME_COLLISION');
  }, 10_000);
});

describe('F0 onConnect 绑定比对（双侧归一，防升级窗口断连）', () => {
  it('带杠旧条目 vs 纯 hex 新帧：同值放行', async () => {
    const h = await startBroker([{ key: key('k0'), machineId: DASHED }]);
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: PURE });
  }, 10_000);

  it('纯 hex 旧条目 vs 带杠新帧：同值放行', async () => {
    const h = await startBroker([{ key: key('k0'), machineId: PURE }]);
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: DASHED });
  }, 10_000);

  it('异值仍拒（BAD_AUTH）', async () => {
    const h = await startBroker([{ key: key('k0'), machineId: DASHED }], { authFailDelayMs: 20 });
    const c = await Client.raw(h.url);
    c.send({ op: 'connect', proto: 1, role: 'node', machineId: '9999aaaa9999aaaa9999aaaa9999aaaa', auth: key('k0'), caps: ['multi-star'] });
    const err = await c.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('BAD_AUTH');
    expect(err.op === 'error' && err.message).toContain('machineId');
  }, 10_000);

  it('两形态互指同机：顶换语义保持（旧连接被顶掉）', async () => {
    const h = await startBroker([{ key: key('k0'), machineId: DASHED }]);
    const first = await Client.connect(h.url, key('k0'), { role: 'node', machineId: DASHED });
    const second = await Client.connect(h.url, key('k0'), { role: 'node', machineId: PURE });
    await new Promise<void>((resolve) => {
      if (first.ws.readyState === WebSocket.CLOSED) return resolve();
      first.ws.once('close', () => resolve());
    });
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
  }, 10_000);
});

describe('F0 roster 与注册碰撞 mid8（归一后取前 8 位）', () => {
  it('带杠条目 roster mid8 = 归一形态，在线判定跨形态成立', async () => {
    const h = await startBroker([{ key: key('k0'), machineId: DASHED, machineName: 'win-box' }]);
    await dashedNodeOnline(h.url, key('k0'), DASHED);
    const sender = await senderOn(h.url);
    sender.send({ op: 'roster' });
    const res = await sender.waitFor((f) => f.op === 'roster-result');
    expect(res.op === 'roster-result' && res.machines).toEqual([
      { name: 'win-box', mid8: 'ec542c2c', online: true },
    ]);
  }, 10_000);

  it('注册时 mid8 碰撞预警跨形态不漏报（带杠新帧 vs 纯 hex 旧条目）', async () => {
    const h = await startBroker([
      { key: key('k0') },
      { key: key('k1'), machineId: 'aaaa00001111', machineName: 'taken' }, // 纯 hex 旧条目
    ]);
    // 带杠新帧：raw slice 'aaaa-000' ≠ 'aaaa0000'，旧判定漏报；归一后同 mid8
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'aaaa-00001111', name: 'newcomer' });
    expect(h.logs.some((l) => l.includes('mid8 碰撞') && l.includes('aaaa0000'))).toBe(true);
  }, 10_000);
});

describe('F0 UNKNOWN_MACHINE did-you-mean', () => {
  it('候选自动列出 label/name(mid8)', async () => {
    const h = await startBroker([
      { key: key('k0'), machineId: DASHED, machineName: 'win-box' },
      { key: key('k1'), machineId: 'dddd00001111', machineName: 'linux-box' },
    ]);
    const sender = await senderOn(h.url);
    sender.send({ op: 'send', id: 'u1', targetMachine: 'ghost', body: '?' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('UNKNOWN_MACHINE');
    const message = err.op === 'error' ? err.message : '';
    expect(message).toContain('node-1/win-box(ec542c2c)');
    expect(message).toContain('node-2/linux-box(dddd0000)');
    expect(message).toContain('已注册');
  }, 10_000);

  it('归一 spec 是某条目 mid 前缀 → 明示候选（did-you-mean）', async () => {
    const h = await startBroker([{ key: key('k0'), machineId: DASHED, machineName: 'win-box' }]);
    const sender = await senderOn(h.url);
    // 下划线变体落名字轨（非 hex-dash 字符集），归一后恰是 mid 前缀
    sender.send({ op: 'send', id: 'u2', targetMachine: 'ec542c2c_28e7', body: '?' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('UNKNOWN_MACHINE');
    const message = err.op === 'error' ? err.message : '';
    expect(message).toContain('machine-id 前缀');
    expect(message).toContain('node-1/win-box(ec542c2c)');
  }, 10_000);

  it('候选 ≤10 条封顶（12 台机器只列前 10）', async () => {
    const h = await startBroker(
      Array.from({ length: 12 }, (_, i) => ({
        key: key(`k${i}`),
        label: `node-${i + 1}`,
        machineId: `${(i + 1).toString(16).padStart(2, '0')}000000${i.toString(16).padStart(4, '0')}`,
        machineName: `m-${i + 1}`,
      })),
    );
    const sender = await senderOn(h.url);
    sender.send({ op: 'send', id: 'u3', targetMachine: 'ghost', body: '?' });
    const err = await sender.waitFor((f) => f.op === 'error');
    const message = err.op === 'error' ? err.message : '';
    const listed = message.split('已注册：')[1] ?? '';
    expect(listed.split('、')).toHaveLength(10);
    expect(listed).toContain('node-10');
    expect(listed).not.toContain('node-11');
    expect(listed).not.toContain('node-12');
  }, 10_000);

  it('归一为空的条目不参与匹配（候选与前缀命中都跳过）', async () => {
    const h = await startBroker([
      { key: key('k0'), machineId: 'zzz', machineName: 'junk' }, // 归一为空
      { key: key('k1'), machineId: 'dddd00001111', machineName: 'linux-box' },
    ]);
    const sender = await senderOn(h.url);
    sender.send({ op: 'send', id: 'u4', targetMachine: 'ghost', body: '?' });
    const err = await sender.waitFor((f) => f.op === 'error');
    const message = err.op === 'error' ? err.message : '';
    expect(message).not.toContain('junk'); // 空归一条目不进候选
    expect(message).toContain('linux-box');
    // hex 轨同样不被空归一条目劫持：前缀投递直达真实条目
    const linuxNode = await Client.connect(h.url, key('k1'), { role: 'node', machineId: 'dddd00001111' });
    sender.send({ op: 'send', id: 'u5', targetMachine: 'dddd0000', body: 'ok' });
    const d = await linuxNode.waitFor((f) => f.op === 'deliver' && f.id === 'u5');
    expect(d.op).toBe('deliver');
  }, 10_000);
});

describe('F0 conversation ref 回信带杠机器（drill 场景，真 broker 集成）', () => {
  it('Linux 机回信 Windows 机：autoVia 归一对端 mid，broker 归一命中带杠注册条目', async () => {
    const h = await startBroker([
      { key: key('k0'), machineId: DASHED, machineName: 'win-box' }, // Windows 在 broker 注册表的带杠条目
    ]);
    const winNode = await dashedNodeOnline(h.url, key('k0'), DASHED); // Windows 节点真实带杠帧
    // 本机（Linux 形态，machineId 纯 hex）：ref.f=Windows 会话（带杠 mid），t=本机 codex
    const ref = encodeRef({
      v: 1,
      f: { p: 'claude', id: 'cs-win', m: 'ec542c2c', mid: DASHED },
      t: { p: 'codex', id: 'team1111-aaaa', m: '1111aaaa', mid: '1111aaaa2222bbbb' },
      n: '0011223344556677',
      c: 1,
      starId: 'abcd00001111',
    });
    const home = mkdtempSync(join(root, 'home-'));
    mkdirSync(join(home, 'tcp'), { recursive: true });
    writeFileSync(
      join(home, 'tcp', 'node.json'),
      JSON.stringify({
        brokers: [{ host: '127.0.0.1', port: Number(new URL(h.url).port), name: 'star-a', starId: 'abcd00001111', key: key('s') }],
      }),
    );
    const scan: ClaudeRegistryScan = { sessions: [], malformed: 0 };
    const threads: CodexThreadSummary[] = [];
    const deps: SendDeps = {
      env: { CODEX_THREAD_ID: 'team1111-aaaa' },
      listClaudeSessions: () => scan,
      listCodexThreads: async () => threads,
      deliverClaude: async () => ({ status: 'delivered' }),
      deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
      sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
      hostname: () => 'linux-host',
      machineId: () => '1111aaaa2222bbbb', // 本机纯 hex（Linux）
      tcpBaseDir: home,
    };
    const outP = runSend({ conversation: ref, bodyArg: 'pong' }, deps);
    const deliver = await winNode.waitFor((f) => f.op === 'deliver');
    expect(deliver).toMatchObject({ op: 'deliver', payload: 'pong' });
    winNode.send({
      op: 'result',
      id: deliver.op === 'deliver' ? deliver.id : '',
      status: 'delivered',
      turn: '1',
      output: JSON.stringify({ status: 'delivered', to: 'workteam', turn: 1 }),
    });
    const out = await outP;
    expect(out).toContain('delivered to workteam');
    // 旗舰路径证据：spec 以归一纯 hex 形态进 broker 路由（不再是带杠串）
    expect(h.logs.some((l) => l.includes(PURE) && l.includes('delivered'))).toBe(true);
  }, 10_000);
});
