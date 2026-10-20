/**
 * 034 星级分权管理面（星管理钥+挑战应答）：
 * - 挑战应答全链：admin connect（不带 auth）→ nonce → HMAC 证明 → connected；
 *   重放拒绝（同连接重复证明=BAD_AUTH）；cap 剥除（challenge-auth 缺席）客户端拒连无降级
 * - op×角色矩阵逐格：成员读本星✅/list-stars❌/发钥❌（ADMIN_REQUIRED）；
 *   星管发钥✅删节点✅ set-name❌；被吊钥 BAD_AUTH
 * - 读回显永不含钥匙（list-nodes/list-members 帧面断言）
 * - set-port 无命令回归：help 不再提供、解析拒绝、插座 op 未知
 * - 审计行在场（来源=本机插座 / 星管理钥(label)）；CLI 发/吊/清单/远程路由
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as net from 'node:net';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { runServe, type ServeDeps } from '../src/commands/serve.js';
import { runDoctor, type DoctorDeps } from '../src/commands/doctor.js';
import { loadBrokerFile, registryFileOf, removeAdminKeyFor, type NodeEntry } from '../src/serve/registry.js';
import { encodeFrame, parseFrame, CAP_CHALLENGE_AUTH, CAP_MULTI_STAR, type Frame } from '../src/serve/protocol.js';
import { SenderConn } from '../src/serve/via-tcp.js';
import { MultichatError } from '../src/errors.js';
import type { SendDeps } from '../src/commands/send.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-admin-key-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const key = (c: string) => c.repeat(64);
const MID = 'MID-TEST';
const STAR_ID = 'aaaabbbbcccc';
const SELF_KEY = key('as');
const EXT_KEY = key('e1');
const ADMIN_KEY = key('ad'); // 播种即知的星管理钥（registry 原文落盘，测试外无人可见）

function entry(partial: Partial<NodeEntry>): NodeEntry {
  return { label: partial.label ?? 'node-1', key: partial.key ?? key('1'), addedAt: '2026-01-01T00:00:00.000Z', ...partial };
}

function fakeSendDeps(): SendDeps {
  return {
    env: {},
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [],
    deliverClaude: async () => ({ status: 'delivered' }),
    deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
    sendLogFile: join(root, 'send-log.jsonl'),
    outboxDir: join(root, 'outbox'),
    now: () => Date.now(),
    hostname: () => 'cli-host',
    machineId: () => MID,
  } as unknown as SendDeps;
}

function cliDeps(extra: Partial<ServeDeps> = {}): { deps: ServeDeps; lines: string[]; errs: string[]; dir: string; registryFile: string } {
  const dir = mkdtempSync(join(root, 'cli-'));
  const lines: string[] = [];
  const errs: string[] = [];
  const deps: ServeDeps = {
    baseDir: dir,
    stdout: (line) => lines.push(line),
    stderr: (line) => errs.push(line),
    env: {},
    version: 'test',
    machineId: () => MID,
    hostname: () => 'cli-host',
    networkInterfaces: () => ({}),
    now: () => Date.now(),
    onSignal: () => {},
    listServeProcesses: () => [],
    makeSendDeps: () => fakeSendDeps(),
    ...extra,
  };
  return { deps, lines, errs, dir, registryFile: registryFileOf(dir) };
}

function startServe(deps: ServeDeps): { stop: () => void; done: Promise<number> } {
  let stop: (() => void) | undefined;
  const d2: ServeDeps = { ...deps, onSignal: (_s, cb) => { stop = cb; } };
  const done = runServe({}, d2);
  return { stop: () => stop!(), done };
}

class TestClient {
  readonly ws: WebSocket;
  private readonly frames: Frame[] = [];
  private readonly waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data: RawData) => {
      const frame = parseFrame(data.toString());
      if (frame === undefined) return;
      this.frames.push(frame);
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i]!;
        if (w.pred(frame)) {
          clearTimeout(w.timer);
          this.waiters.splice(i, 1);
          w.resolve(frame);
          return;
        }
      }
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(frame: Frame): void {
    this.ws.send(encodeFrame(frame));
  }

  waitFor(pred: (f: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    const seen = this.frames.find(pred);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter = {
        pred,
        resolve,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error('frame timeout'));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // 已断开
    }
  }
}

async function serveUrl(deps: ServeDeps): Promise<string> {
  const st = JSON.parse(readFileSync(join(deps.baseDir, 'tcp', 'status-broker.json'), 'utf8')) as { port: number };
  return `ws://127.0.0.1:${st.port}`;
}

/** 管理连接握手（真 HMAC 证明——与 via-tcp SenderConn.openAdmin 同算法）。 */
async function adminHandshake(url: string, adminKey: string): Promise<{ c: TestClient; proof: string }> {
  const c = new TestClient(url);
  await c.opened();
  const info = await c.waitFor((f) => f.op === 'info');
  expect((info as { caps?: string[] }).caps).toContain(CAP_CHALLENGE_AUTH);
  c.send({ op: 'connect', proto: 1, role: 'sender', admin: true, caps: [CAP_MULTI_STAR, CAP_CHALLENGE_AUTH] });
  const challenge = await c.waitFor((f) => f.op === 'auth-challenge');
  const proof = createHmac('sha256', adminKey).update((challenge as { nonce: string }).nonce).digest('hex');
  c.send({ op: 'auth-proof', proof });
  const verdict = await c.waitFor((f) => f.op === 'connected' || f.op === 'error');
  expect(verdict.op).toBe('connected');
  return { c, proof };
}

/** 星钥连接（成员身份）。 */
async function memberHandshake(url: string, auth: string): Promise<TestClient> {
  const c = new TestClient(url);
  await c.opened();
  await c.waitFor((f) => f.op === 'info');
  c.send({ op: 'connect', proto: 1, role: 'sender', auth, caps: [CAP_MULTI_STAR] });
  const verdict = await c.waitFor((f) => f.op === 'connected' || f.op === 'error');
  expect(verdict.op).toBe('connected');
  return c;
}

/** 播种一颗带管理钥的星（管理钥原文已知——断言"回显无钥匙"用）。 */
function seedStarWithAdmin(dir: string, registryFile: string): void {
  mkdirSync(join(dir, 'tcp'), { recursive: true });
  writeFileSync(
    registryFile,
    `${JSON.stringify({
      port: 0,
      stars: [{
        starId: STAR_ID,
        name: 'alpha',
        nodes: [
          entry({ label: 'self', key: SELF_KEY, machineId: MID, machineName: 'cli-host' }),
          entry({ label: 'node-1', key: EXT_KEY, machineId: 'eeee5555eeee', machineName: 'ext-node' }),
          { label: 'ops', adminKey: ADMIN_KEY, addedAt: '2026-01-01T00:00:00.000Z' },
        ],
        roster: [{ sessionId: 'sess-b1', name: 'boss', tool: 'claude', machine: 'eeee5555eeee', machineName: 'ext-node' }],
      }],
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'tcp', 'node.json'),
    `${JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 0, name: 'alpha', starId: STAR_ID, key: SELF_KEY }], showName: 'cli-host' }, null, 2)}\n`,
    'utf8',
  );
}

describe('034 挑战应答全链与角色矩阵', () => {
  it('admin 握手（钥匙永不过线）→ 读/发/删全过 → 成员/星管逐格 → 重放拒绝 → 被吊钥 BAD_AUTH → 审计在场', async () => {
    const { deps, lines, dir, registryFile } = cliDeps();
    seedStarWithAdmin(dir, registryFile);
    const serve = startServe(deps);
    await new Promise((r) => setTimeout(r, 1_500));
    const url = await serveUrl(deps);

    // --- 星管理员：挑战应答握手 + list-nodes/list-members（回显无钥匙） ---
    const { c: admin, proof } = await adminHandshake(url, ADMIN_KEY);
    admin.send({ op: 'admin-op', id: 'q1', action: 'list-nodes' });
    const nodes = JSON.stringify(await admin.waitFor((f) => f.op === 'admin-op-result' && (f as { id?: string }).id === 'q1'));
    expect(nodes).toContain('ext-node');
    expect(nodes).toContain('"admin":true'); // 管理钥条目带标记
    expect(nodes).not.toContain(EXT_KEY); // 回显永不含钥匙
    expect(nodes).not.toContain(ADMIN_KEY);
    admin.send({ op: 'admin-op', id: 'q2', action: 'list-members' });
    const members = JSON.stringify(await admin.waitFor((f) => f.op === 'admin-op-result' && (f as { id?: string }).id === 'q2'));
    expect(members).toContain('boss');

    // --- 星管理员：发钥 ✅（显式动作——仅此路径回显钥匙）→ 台账即时落位 ---
    admin.send({ op: 'admin-op', id: 'q3', action: 'gen-key', n: 1, host: '10.0.0.9' });
    const gen = (await admin.waitFor((f) => f.op === 'admin-op-result' && (f as { id?: string }).id === 'q3')) as {
      results?: Array<{ label: string; key: string }>;
    };
    expect(gen.results).toHaveLength(1);
    expect(gen.results![0]!.key).toMatch(/^[0-9a-f]{64}$/);
    const issuedKey = gen.results![0]!.key;
    expect(loadBrokerFile(registryFile).stars[0]!.nodes.some((n) => n.key === issuedKey)).toBe(true);

    // --- 星管理员：删节点 ✅（自己刚发的 node-2） ---
    admin.send({ op: 'admin-op', id: 'q4', action: 'remove-node', label: gen.results![0]!.label });
    const rm = (await admin.waitFor((f) => f.op === 'admin-op-result' && (f as { id?: string }).id === 'q4')) as { removed?: boolean };
    expect(rm.removed).toBe(true);
    expect(loadBrokerFile(registryFile).stars[0]!.nodes.some((n) => n.key === issuedKey)).toBe(false);

    // --- 星管理员：set-name ❌（星名=broker 主本机）/ list-stars ❌（同） ---
    admin.send({ op: 'admin-op', id: 'q5', action: 'set-name' });
    const e1 = (await admin.waitFor((f) => f.op === 'error' && (f as { id?: string }).id === 'q5')) as { code?: string; message?: string };
    expect(e1.code).toBe('ADMIN_REQUIRED');
    expect(e1.message).toContain('仅 broker 主本机');
    admin.send({ op: 'admin-op', id: 'q6', action: 'list-stars' });
    const e2 = (await admin.waitFor((f) => f.op === 'error' && (f as { id?: string }).id === 'q6')) as { code?: string };
    expect(e2.code).toBe('ADMIN_REQUIRED');

    // --- 管理员不可经 remove-node 吊同侪管理钥（吊钥仅本机） ---
    admin.send({ op: 'admin-op', id: 'q7', action: 'remove-node', label: 'ops' });
    const e3 = (await admin.waitFor((f) => f.op === 'error' && (f as { id?: string }).id === 'q7')) as { code?: string; message?: string };
    expect(e3.code).toBe('ADMIN_REQUIRED');
    expect(e3.message).toContain('--remove-admin-key');

    // --- 重放拒绝：已认证连接上重发同一证明 → BAD_AUTH ---
    admin.send({ op: 'auth-proof', proof });
    const replay = (await admin.waitFor((f) => f.op === 'error' && ((f as { message?: string }).message ?? '').includes('重放'))) as { code?: string; message?: string };
    expect(replay.code).toBe('BAD_AUTH');
    expect(replay.message).toContain('重放');
    await new Promise((r) => setTimeout(r, 300));
    expect(admin.ws.readyState).toBe(WebSocket.CLOSED);

    // --- 普通成员（星钥 sender）：读本星 ✅ / 发钥·删节点 ❌ ADMIN_REQUIRED ---
    const member = await memberHandshake(url, SELF_KEY);
    member.send({ op: 'admin-op', id: 'm1', action: 'list-nodes' });
    const mnodes = JSON.stringify(await member.waitFor((f) => f.op === 'admin-op-result' && (f as { id?: string }).id === 'm1'));
    expect(mnodes).toContain('ext-node');
    expect(mnodes).not.toContain(ADMIN_KEY);
    member.send({ op: 'admin-op', id: 'm2', action: 'list-members' });
    const mmembers = JSON.stringify(await member.waitFor((f) => f.op === 'admin-op-result' && (f as { id?: string }).id === 'm2'));
    expect(mmembers).toContain('boss');
    member.send({ op: 'admin-op', id: 'm3', action: 'gen-key', n: 1, host: '10.0.0.9' });
    const merr = (await member.waitFor((f) => f.op === 'error' && (f as { id?: string }).id === 'm3')) as { code?: string; message?: string };
    expect(merr.code).toBe('ADMIN_REQUIRED');
    expect(merr.message).toContain('星管理员');
    member.send({ op: 'admin-op', id: 'm4', action: 'remove-node', label: 'node-1' });
    const merr2 = (await member.waitFor((f) => f.op === 'error' && (f as { id?: string }).id === 'm4')) as { code?: string };
    expect(merr2.code).toBe('ADMIN_REQUIRED');
    member.send({ op: 'admin-op', id: 'm5', action: 'list-stars' });
    const merr3 = (await member.waitFor((f) => f.op === 'error' && (f as { id?: string }).id === 'm5')) as { code?: string };
    expect(merr3.code).toBe('ADMIN_REQUIRED');
    member.close();

    // --- 被吊钥 BAD_AUTH：冷吊（直写台账——broker 每连接现读）后同钥再连 ---
    removeAdminKeyFor(registryFile, STAR_ID, 'ops');
    const revoked = new TestClient(url);
    await revoked.opened();
    await revoked.waitFor((f) => f.op === 'info');
    revoked.send({ op: 'connect', proto: 1, role: 'sender', admin: true, caps: [CAP_MULTI_STAR, CAP_CHALLENGE_AUTH] });
    const ch2 = await revoked.waitFor((f) => f.op === 'auth-challenge');
    const proof2 = createHmac('sha256', ADMIN_KEY).update((ch2 as { nonce: string }).nonce).digest('hex');
    revoked.send({ op: 'auth-proof', proof: proof2 });
    const dead = (await revoked.waitFor((f) => f.op === 'error')) as { code?: string; message?: string };
    expect(dead.code).toBe('BAD_AUTH');
    expect(dead.message).toContain('星管理钥');
    revoked.close();

    // --- 审计行在场：WS 侧来源=星管理钥(label)；插座侧来源=本机插座 ---
    expect(lines.some((l) => l.includes('audit admin-op gen-key') && l.includes('来源=星管理钥(ops)'))).toBe(true);
    expect(lines.some((l) => l.includes('audit admin-op remove-node') && l.includes('星管理钥(ops)'))).toBe(true);
    expect(lines.some((l) => l.includes('admin-required'))).toBe(true);
    lines.length = 0;
    expect(await runServe({ genAdminKeyArg: 'ops2', starArg: 'alpha' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('audit admin-op gen-admin-key') && l.includes('来源=本机插座'))).toBe(true);
    // 热吊（经插座）：ops2 即时作废语义同上
    expect(await runServe({ removeAdminKeyArg: 'ops2', starArg: 'alpha' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('audit admin-op remove-admin-key') && l.includes('本机插座'))).toBe(true);

    serve.stop();
    expect(await serve.done).toBe(0);
  }, 30_000);

  it('CLI 远程管理路由：--via tcp:<星> 成员读（星钥）+ 星管写（adminKey 挑战应答）', async () => {
    const { deps, lines, dir, registryFile } = cliDeps();
    seedStarWithAdmin(dir, registryFile);
    const serve = startServe(deps);
    await new Promise((r) => setTimeout(r, 1_500));
    const url = await serveUrl(deps);
    const port = Number(url.split(':').pop());

    // 节点机视角 node.json：真实端口 + 星钥 + adminKey（与星钥同条目）
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      `${JSON.stringify({ brokers: [{ host: '127.0.0.1', port, name: 'alpha', starId: STAR_ID, key: SELF_KEY, adminKey: ADMIN_KEY }], showName: 'cli-host' }, null, 2)}\n`,
      'utf8',
    );

    // 读（成员身份，星钥即够）
    lines.length = 0;
    expect(await runServe({ viaArg: 'tcp:alpha', listNodes: true }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('节点表'))).toBe(true);
    expect(lines.some((l) => l.includes('ext-node'))).toBe(true);
    expect(lines.some((l) => l.includes(ADMIN_KEY))).toBe(false); // 回显无钥匙
    lines.length = 0;
    expect(await runServe({ viaArg: 'tcp:alpha', listMembers: true }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('boss'))).toBe(true);

    // 写（星管理员挑战应答）：远端发钥 → 台账落位 → 远端删节点
    lines.length = 0;
    expect(await runServe({ viaArg: 'tcp:alpha', genKeyArg: '1' }, deps)).toBe(0);
    expect(lines.some((l) => l.startsWith('远端发钥'))).toBe(true);
    const after = loadBrokerFile(registryFile).stars[0]!.nodes;
    const issued = after.find((n) => n.adminKey === undefined && n.key !== SELF_KEY && n.key !== EXT_KEY);
    expect(issued).toBeDefined();
    expect(issued!.label).toMatch(/^node-\d+$/);
    lines.length = 0;
    expect(await runServe({ viaArg: 'tcp:alpha', remove: issued!.label }, deps)).toBe(0);
    expect(lines.some((l) => l.includes(`远端移除 ${issued!.label}`))).toBe(true);
    expect(loadBrokerFile(registryFile).stars[0]!.nodes.some((n) => n === issued)).toBe(false);

    // 写 op 无 adminKey → 教学找 broker 主（拿掉 adminKey 的条目机）
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      `${JSON.stringify({ brokers: [{ host: '127.0.0.1', port, name: 'alpha', starId: STAR_ID, key: SELF_KEY }], showName: 'cli-host' }, null, 2)}\n`,
      'utf8',
    );
    const err: unknown = await runServe({ viaArg: 'tcp:alpha', genKeyArg: '1' }, deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).message).toContain('--gen-admin-key');

    serve.stop();
    expect(await serve.done).toBe(0);
  }, 30_000);
});

describe('034 cap 剥除拒连（无降级路径）', () => {
  it('info 无 challenge-auth → openAdminConn 拒绝且一个帧都不发（钥匙绝不离机）', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => wss.once('listening', () => resolve((wss.address() as net.AddressInfo).port)));
    const received: string[] = [];
    wss.on('connection', (ws) => {
      ws.on('message', (data) => received.push(String(data)));
      ws.send(encodeFrame({ op: 'info', proto: 1, server: 'crosschat/stub', caps: [CAP_MULTI_STAR] })); // challenge-auth 被剥
    });
    const err: unknown = await SenderConn.openAdmin(`ws://127.0.0.1:${port}`, ADMIN_KEY, 3_000).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).message).toContain('challenge-auth');
    expect((err as MultichatError).message).toContain('绝不发送星管理钥');
    expect(received).toEqual([]); // 无降级：cap 检查先于一切发送
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }, 15_000);
});

describe('034 set-port 无命令回归（旗标+插座 op 全删）', () => {
  it('help 不再提供 --port 且提供 034 新面；解析拒绝（parseServeArgs 用例见 serve-cli 组）', () => {
    const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    const out = spawnSync(process.execPath, [cliPath, 'serve', '--help'], { encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout).not.toContain('--port');
    expect(out.stdout).toContain('--gen-admin-key');
    expect(out.stdout).toContain('--remove-admin-key');
    expect(out.stdout).toContain('--list-nodes');
    expect(out.stdout).toContain('--via tcp:<星名|前缀>');
  });

  it('管理插座 set-port op 已删（未知 op 拒绝、台账零改动）', async () => {
    const { deps, dir, registryFile } = cliDeps();
    seedStarWithAdmin(dir, registryFile);
    const serve = startServe(deps);
    await new Promise((r) => setTimeout(r, 1_500));
    const st = JSON.parse(readFileSync(join(dir, 'tcp', 'status-broker.json'), 'utf8')) as { adminPipe?: string };
    expect(typeof st.adminPipe).toBe('string');
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ path: st.adminPipe! }, () => {
        socket.write(`${JSON.stringify({ op: 'set-port', port: 1234 })}\n`);
      });
      socket.on('data', (chunk) => {
        resolve(chunk.toString('utf8'));
        socket.destroy();
      });
      socket.on('error', reject);
      setTimeout(() => reject(new Error('pipe timeout')), 5_000);
    });
    expect(JSON.parse(reply)).toMatchObject({ ok: false });
    expect(reply).toContain('未知管理 op');
    expect(loadBrokerFile(registryFile).port).toBe(0); // 台账零改动
    serve.stop();
    expect(await serve.done).toBe(0);
  }, 20_000);
});

describe('034 CLI 发/吊星管理钥与清单（冷路径）', () => {
  it('cold --gen-admin-key 落盘并回显贴钥指引；--list 标记管理钥条目且不回显钥匙；--remove-admin-key 吊', async () => {
    const { deps, lines, registryFile } = cliDeps();
    mkdirSync(join(deps.baseDir, 'tcp'), { recursive: true });
    writeBrokerSeed(registryFile);
    lines.length = 0;
    expect(await runServe({ genAdminKeyArg: 'ops', starArg: 'alpha' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('已发星管理钥 ops') && l.includes('已落盘'))).toBe(true);
    expect(lines.some((l) => l.includes('"adminKey"'))).toBe(true);
    const doc = loadBrokerFile(registryFile);
    const adminEntry = doc.stars[0]!.nodes.find((n) => n.label === 'ops')!;
    expect(adminEntry.adminKey).toMatch(/^[0-9a-f]{64}$/);
    // --list：条目可见、标记（星管理钥）、永不回显钥匙本体
    lines.length = 0;
    expect(await runServe({ list: true }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('ops') && l.includes('（星管理钥）'))).toBe(true);
    expect(lines.some((l) => l.includes(adminEntry.adminKey!))).toBe(false);
    // 吊钥
    lines.length = 0;
    expect(await runServe({ removeAdminKeyArg: 'ops', starArg: 'alpha' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('已吊星管理钥 ops'))).toBe(true);
    expect(loadBrokerFile(registryFile).stars[0]!.nodes.some((n) => n.label === 'ops')).toBe(false);
  });
});

describe('034 doctor 非默认口教学（端口=手编字段）', () => {
  function doctorWithBrokerJson(content: string): string {
    const dir = mkdtempSync(join(root, 'doc-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'broker.json'), content);
    const deps: DoctorDeps = {
      nodeVersion: '22.13.0',
      env: {},
      resolveClaude: () => { throw new Error('skip'); },
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      codexBin: () => { throw new Error('skip'); },
      run: () => ({ status: 0, stdout: 'v0.160.0' }),
      exists: () => false,
      readFile: (p) => (p === join(dir, 'tcp', 'broker.json') ? readFileSync(p, 'utf8') : undefined),
      homeDir: () => dir,
      listOutbox: () => [],
      tcpDir: join(dir, 'tcp'),
      probeTcp: () => true,
      cliVersion: 'test',
      repoSkillFiles: () => undefined,
    };
    return runDoctor(deps).output;
  }

  it('非默认口 → 手编 broker.json 指路；默认口/无 port 不出该行；管理钥条目不判损坏', () => {
    const nodes = [{ label: 'self', key: key('s') }, { label: 'ops', adminKey: key('a') }];
    const nonDefault = doctorWithBrokerJson(JSON.stringify({ port: 9000, stars: [{ starId: 'aaaa', name: 'a', nodes, roster: [] }] }));
    expect(nonDefault).toContain('非默认');
    expect(nonDefault).toContain('broker.json 手编字段');
    expect(nonDefault).toContain('--port 命令已移除');
    const defaultPort = doctorWithBrokerJson(JSON.stringify({ stars: [{ starId: 'aaaa', name: 'a', nodes, roster: [] }] }));
    expect(defaultPort).not.toContain('非默认');
    expect(defaultPort).toContain('可解析'); // 管理钥条目（无 key）不再误判损坏
  });
});

/** 冷路径用最小星（无管理钥——由用例自己发）。 */
function writeBrokerSeed(registryFile: string): void {
  writeFileSync(
    registryFile,
    `${JSON.stringify({ stars: [{ starId: STAR_ID, name: 'alpha', nodes: [entry({ label: 'self', key: SELF_KEY, machineId: MID, machineName: 'cli-host' })], roster: [] }] }, null, 2)}\n`,
    'utf8',
  );
}
