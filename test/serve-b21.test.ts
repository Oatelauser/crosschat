/**
 * 票B B2.1（a″ mid8 双轨寻址）行为测试：双轨路由/同机 deliverLocal/冲突列码/
 * 改名免疫/信封 tcp 盖章+ssh 字节锚点/自动补全三分支/roster/自报名净化/自登记。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import { registryFileOf, tcpDir, type NodeEntry } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';
import { encodeFrame, parseFrame, type Frame } from '../src/serve/protocol.js';
import { fetchRoster, runViaTcpSend } from '../src/serve/via-tcp.js';
import { deliverViaRunSend } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { composeEnvelope } from '../src/envelope.js';
import { encodeOrigin, decodeOriginIdentity } from '../src/federation.js';
import { encodeRef } from '../src/ref.js';
import { pickAutoVia, runSend, type SendDeps } from '../src/commands/send.js';
import { ensureSelfEntries, realServeDeps, type ServeDeps } from '../src/commands/serve.js';
import { ensureStarIds, loadBrokerFile } from '../src/serve/registry.js';

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
    c.send({ op: 'connect', proto: 1, role: opts.role, ...(opts.machineId === undefined ? {} : { machineId: opts.machineId }), auth, ...(opts.name === undefined ? {} : { name: opts.name }), caps: ['multi-star'] });
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
    seedBroker(registryFile, {
      stars: [{
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
      }],
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
    const name = loadBrokerFile(h.registryFile).stars[0]!.nodes[0]!.machineName ?? '';
    expect(name.length).toBeLessThanOrEqual(32);
    // eslint-disable-next-line no-control-regex -- 断言控制符已剥
    expect(name).not.toMatch(/[\u0000-\u001f]/);
    expect(name.startsWith('xxxx')).toBe(true);
  }, 10_000);

  it('reconnecting with a new name overwrites the registry entry', async () => {
    const h = await startHarness([{ key: key('k0') }]);
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'eeee00001111', name: 'old-name' });
    await Client.connect(h.url, key('k0'), { role: 'node', machineId: 'eeee00001111', name: 'new-name' });
    expect(loadBrokerFile(h.registryFile).stars[0]!.nodes[0]!.machineName).toBe('new-name');
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

describe('B1 self node.json starId backfill (ensureSelfEntries)', () => {
  function selfDeps(dir: string): ServeDeps {
    return { ...realServeDeps(), baseDir: dir, machineId: () => 'a1b2c3d40000', hostname: () => 'hub' };
  }
  const selfNode = (): NodeEntry => ({ label: 'self', key: 'k', machineId: 'a1b2c3d40000', machineName: 'hub', addedAt: '2026-01-01T00:00:00.000Z' });

  it('backfills starId into a matching entry lacking it（旧单条形状并轨数组+补 id）；registry starId 不动', () => {
    const dir = mkdtempSync(join(root, 'b1self-'));
    const deps = selfDeps(dir);
    const registryFile = registryFileOf(dir);
    mkdirSync(tcpDir(dir), { recursive: true });
    const nodeJson = join(tcpDir(dir), 'node.json');
    seedBroker(registryFile, { stars: [{ starId: 'aaaabbbbcccc', nodes: [selfNode()] }] });
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '127.0.0.1', port: 7260 }, key: 'k', name: 'hub' }, null, 2));
    expect(ensureSelfEntries(deps, registryFile, 7260)).toEqual([]); // 对齐成功零出声
    const parsed = JSON.parse(readFileSync(nodeJson, 'utf8')) as { brokers: Array<{ host: string; port: number; starId?: string; key: string }>; showName?: string };
    expect(parsed.brokers[0]!.starId).toBe('aaaabbbbcccc');
    expect(parsed.brokers[0]!.key).toBe('k');
    expect(parsed.showName).toBe('hub'); // 旧顶层 name 并轨 showName
    expect(loadBrokerFile(registryFile).stars[0]!.starId).toBe('aaaabbbbcccc');
  });

  it('serve 序：ensureStarIds 先补 id，自登记带进 node.json；既有 starId 不覆写', () => {
    const dir = mkdtempSync(join(root, 'b1self-'));
    const deps = selfDeps(dir);
    const registryFile = registryFileOf(dir);
    mkdirSync(tcpDir(dir), { recursive: true });
    const nodeJson = join(tcpDir(dir), 'node.json');
    seedBroker(registryFile, { stars: [{ nodes: [selfNode()] }] });
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 7260, key: 'k' }] }));
    ensureStarIds(registryFile);
    ensureSelfEntries(deps, registryFile, 7260);
    const starId = (JSON.parse(readFileSync(nodeJson, 'utf8')) as { brokers: Array<{ starId?: string }> }).brokers[0]!.starId;
    expect(starId).toMatch(/^[0-9a-f]{12}$/);
    expect(loadBrokerFile(registryFile).stars[0]!.starId).toBe(starId);
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 7260, key: 'k', starId: 'deadbeef0000' }] }));
    ensureSelfEntries(deps, registryFile, 7260);
    expect((JSON.parse(readFileSync(nodeJson, 'utf8')) as { brokers: Array<{ starId?: string }> }).brokers[0]!.starId).toBe('deadbeef0000');
  });
});

describe('B2.1 serve self-init（bootstrap 后首跑）', () => {
  it('registers a self entry and writes the local node.json (127.0.0.1); idempotent（再跑零出声零改写）', () => {
    const dir = mkdtempSync(join(root, 'self-'));
    const deps: ServeDeps = {
      ...realServeDeps(),
      baseDir: dir,
      machineId: () => 'a1b2c3d40000',
      hostname: () => 'hub',
    };
    const registryFile = registryFileOf(dir);
    seedBroker(registryFile, { stars: [{ nodes: [] }] }); // bootstrap 后形态（无名空星）
    const notes = ensureSelfEntries(deps, registryFile, 7260);
    expect(notes.some((l) => l.includes('已自动生成本机 node.json'))).toBe(true);
    const star = loadBrokerFile(registryFile).stars[0]!;
    expect(star.nodes).toHaveLength(1);
    expect(star.nodes[0]).toMatchObject({ label: 'self', machineId: 'a1b2c3d40000', machineName: 'hub' });
    const nodeJson = JSON.parse(readFileSync(join(tcpDir(dir), 'node.json'), 'utf8')) as { brokers: Array<{ host: string; port: number; key: string }>; showName: string };
    expect(nodeJson.brokers).toHaveLength(1);
    expect(nodeJson.brokers[0]).toMatchObject({ host: '127.0.0.1', port: 7260 });
    expect(nodeJson.showName).toBe('hub');
    // 幂等：再来一次零出声、node.json 字节不变、注册表不重复登记
    const before = readFileSync(join(tcpDir(dir), 'node.json'), 'utf8');
    expect(ensureSelfEntries(deps, registryFile, 7260)).toEqual([]);
    expect(readFileSync(join(tcpDir(dir), 'node.json'), 'utf8')).toBe(before);
    expect(loadBrokerFile(registryFile).stars[0]!.nodes).toHaveLength(1);
  });

  // foreign（他星配置：不追加自用条目只出声）/ stale（自用钥匙指向不符只出声）/ 坏文件（重建）
  it('classifies an existing node.json as foreign or stale; corrupt file is rebuilt', () => {
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
    seedBroker(registryFile, { stars: [{ nodes: [] }] });
    // 他星配置（钥匙不是本 broker 的）→ foreign 出声、文件原样
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '192.168.1.5', port: 7260 }, key: 'x', name: 'n' }));
    let notes = ensureSelfEntries(deps, registryFile, 7260);
    expect(notes.some((l) => l.includes('不含本 broker 的自用钥匙') && l.includes('192.168.1.5'))).toBe(true);
    expect((JSON.parse(readFileSync(nodeJson, 'utf8')) as { broker: { host: string } }).broker.host).toBe('192.168.1.5');
    // 自用钥匙在、端口漂移 → stale 出声
    const selfKey = loadBrokerFile(registryFile).stars[0]!.nodes[0]!.key;
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 8123, key: selfKey }] }));
    notes = ensureSelfEntries(deps, registryFile, 7260);
    expect(notes.some((l) => l.includes('陈旧或端口漂移'))).toBe(true);
    // 坏文件 → 读不进按不存在重建
    writeFileSync(nodeJson, 'not json at all');
    notes = ensureSelfEntries(deps, registryFile, 7260);
    expect(notes.some((l) => l.includes('已自动生成本机 node.json'))).toBe(true);
    expect(() => JSON.parse(readFileSync(nodeJson, 'utf8'))).not.toThrow();
  });
});

describe('017 showName 单一事实源（ensureSelfEntries 启动刷新 machineName）', () => {
  const selfEntry = (machineName?: string): NodeEntry => ({
    label: 'self',
    key: 'k',
    machineId: 'a1b2c3d40000',
    ...(machineName === undefined ? {} : { machineName }),
    addedAt: '2026-01-01T00:00:00.000Z',
  });
  function setup(machineName?: string): { deps: ServeDeps; registryFile: string; nodeJson: string } {
    const dir = mkdtempSync(join(root, 't017-'));
    mkdirSync(tcpDir(dir), { recursive: true });
    const registryFile = registryFileOf(dir);
    seedBroker(registryFile, { stars: [{ starId: 'aaaabbbbcccc', name: 'hub', nodes: [selfEntry(machineName)] }] });
    return {
      deps: { ...realServeDeps(), baseDir: dir, machineId: () => 'a1b2c3d40000', hostname: () => 'hub' },
      registryFile,
      nodeJson: join(tcpDir(dir), 'node.json'),
    };
  }
  const readSelf = (file: string): NodeEntry =>
    loadBrokerFile(file).stars[0]!.nodes[0]!;

  it('重启（再跑 ensureSelfEntries）读回 showName 刷新注册表 machineName——改名主链', () => {
    const { deps, registryFile, nodeJson } = setup('hub');
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 7260, key: 'k' }], showName: 'cloud' }));
    expect(ensureSelfEntries(deps, registryFile, 7260)).toEqual([]);
    expect(readSelf(registryFile).machineName).toBe('cloud');
  });

  it('foreign 形态（自用条目不在 node.json）照样读顶层 showName 刷新', () => {
    const { deps, registryFile, nodeJson } = setup('hub');
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '10.9.9.9', port: 7260, key: 'wk', name: 'other' }], showName: 'cloud' }));
    const notes = ensureSelfEntries(deps, registryFile, 7260);
    expect(notes.some((l) => l.includes('不含本 broker 的自用钥匙'))).toBe(true);
    expect(readSelf(registryFile).machineName).toBe('cloud');
  });

  it('语义对称：showName 显式缺失/空白 → 清除 machineName（roster 回退纯 mid8）', () => {
    const { deps, registryFile, nodeJson } = setup('hub');
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 7260, key: 'k' }] }));
    expect(ensureSelfEntries(deps, registryFile, 7260)).toEqual([]);
    expect(readSelf(registryFile).machineName).toBeUndefined();
    expect('machineName' in readSelf(registryFile)).toBe(false); // 键整个消失，非 null 残留
    // 空白串同清（sanitizeName 剥空）
    seedBroker(registryFile, { stars: [{ starId: 'aaaabbbbcccc', name: 'hub', nodes: [selfEntry('cloud')] }] });
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 7260, key: 'k' }], showName: '   ' }));
    expect(ensureSelfEntries(deps, registryFile, 7260)).toEqual([]);
    expect(readSelf(registryFile).machineName).toBeUndefined();
  });

  it('node.json 读不了/损坏 → 重建（新语义：坏文件视同不存在）', () => {
    const { deps, registryFile, nodeJson } = setup('cloud');
    writeFileSync(nodeJson, 'not json at all');
    const notes = ensureSelfEntries(deps, registryFile, 7260);
    expect(notes.some((l) => l.includes('已自动生成本机 node.json'))).toBe(true);
    expect(() => JSON.parse(readFileSync(nodeJson, 'utf8'))).not.toThrow();
  });

  it('无变化不写：showName 与现值一致时注册表字节不变（与 E0 星名同步同款）', () => {
    const { deps, registryFile, nodeJson } = setup('cloud');
    writeFileSync(nodeJson, JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 7260, key: 'k', name: 'hub', starId: 'aaaabbbbcccc' }], showName: 'cloud' }, null, 2));
    const before = readFileSync(registryFile, 'utf8');
    expect(ensureSelfEntries(deps, registryFile, 7260)).toEqual([]);
    expect(readFileSync(registryFile, 'utf8')).toBe(before);
  });

  it('端到端：改 showName 重启后，非 hex 名字寻址命中 broker 本机（deliverLocal）', async () => {
    const local: string[] = [];
    const h = await startHarness([{ machineId: 'a1b2c3d40000', machineName: 'hub' }], {
      deliverLocal: async (frame) => {
        local.push(frame.body);
        return { op: 'result', id: frame.id, status: 'delivered', turn: '1' };
      },
    });
    const port = Number(new URL(h.url).port);
    writeFileSync(
      join(tcpDir(h.dir), 'node.json'),
      JSON.stringify({ brokers: [{ host: '127.0.0.1', port, key: key('k0'), name: 'hub' }], showName: 'cloud' }),
    );
    const deps: ServeDeps = { ...realServeDeps(), baseDir: h.dir, machineId: () => 'a1b2c3d40000', hostname: () => 'hub' };
    expect(ensureSelfEntries(deps, h.registryFile, port)).toEqual([]);
    expect(loadBrokerFile(h.registryFile).stars[0]!.nodes[0]!.machineName).toBe('cloud');
    const sender = await senderOn(h);
    sender.send({ op: 'send', id: 'n1', targetMachine: 'cloud', body: 'by-new-name' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'n1');
    expect(receipt.op === 'receipt' && receipt.status).toBe('delivered');
    expect(local).toEqual(['by-new-name']);
  }, 10_000);
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
    // 019 后机器级消息腿走 --conversation：human→codex 真实 ref（接收腿 runSend 按 ref 续话）
    const convRef = encodeRef({ v: 1, f: { p: 'human' }, t: { p: 'codex', id: 'b0ss0000-aaaa' }, n: 'a1b2c3d4', c: 1 });
    const out = await runViaTcpSend(
      { via: 'tcp:hub', conversation: convRef, fileArg: file, bodyArg: 'drill-a 附件测试' },
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

describe('E0 ensureSelfEntries 星名同步（broker 自用条目不走节点客户端，在此对齐）', () => {
  it('overwrites a legacy alias with the registry star name (and keeps starId untouched)', () => {
    const dir = mkdtempSync(join(root, 'e0self-'));
    const deps = { ...realServeDeps(), baseDir: dir, machineId: () => 'a1b2c3d40000', hostname: () => 'hub' } as ServeDeps;
    const registryFile = registryFileOf(dir);
    mkdirSync(tcpDir(dir), { recursive: true });
    const nodeJson = join(tcpDir(dir), 'node.json');
    seedBroker(registryFile, { stars: [{ starId: 'aaaabbbbcccc', name: 'cloud', nodes: [{ label: 'self', key: 'k', machineId: 'a1b2c3d40000', machineName: 'hub', addedAt: '2026-01-01T00:00:00.000Z' }] }] });
    writeFileSync(nodeJson, JSON.stringify({ broker: { host: '127.0.0.1', port: 7260, alias: 'hub', starId: 'aaaabbbbcccc' }, key: 'k', name: 'hub' }, null, 2));
    expect(ensureSelfEntries(deps, registryFile, 7260)).toEqual([]);
    const parsed = JSON.parse(readFileSync(nodeJson, 'utf8')) as { brokers: Array<{ name?: string; starId?: string }>; showName?: string };
    expect(parsed.brokers[0]!.name).toBe('cloud'); // 星名以注册表为准（显式 --name cloud）
    expect(parsed.brokers[0]!.starId).toBe('aaaabbbbcccc'); // 既有 starId 不碰
    expect(parsed.showName).toBe('hub'); // 旧顶层 name 并轨 showName、alias 淘汰
  });
});
