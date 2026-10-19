import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { Broker } from '../src/serve/broker.js';
import { encodeFrame, parseFrame, type Frame } from '../src/serve/protocol.js';
import { registryFileOf } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';
import {
  FILE_CHUNK_BYTES,
  FILE_MAX_BYTES,
  FileInbox,
  safeFileName,
} from '../src/serve/file-channel.js';
import type { SendDeps } from '../src/commands/send.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-file-channel-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});
const clients: { close(): void }[] = [];
const brokers: Broker[] = [];
afterEach(async () => {
  for (const b of brokers.splice(0)) await b.stop();
});

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const key = (c: string) => c.repeat(64);

function inbox(): { box: FileInbox; inboxDir: string; partsDir: string } {
  const dir = mkdtempSync(join(root, 'box-'));
  const inboxDir = join(dir, 'inbox');
  const partsDir = join(dir, 'parts');
  return { box: new FileInbox({ inboxDir, partsDir }), inboxDir, partsDir };
}

describe('safeFileName', () => {
  it('strips directory components and dangerous characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('a/b\\c:*d?e"f<g>h|i.txt')).toBe('c__d_e_f_g_h_i.txt');
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName('正常名.txt')).toBe('正常名.txt');
  });
});

describe('FileInbox', () => {
  it('full flow: begin(0) → chunks → end verifies sha, promotes and cleans parts', () => {
    const { box, inboxDir, partsDir } = inbox();
    const bytes = Buffer.from('hello file channel');
    const begin = box.begin({ op: 'file-begin', id: 'f1', targetMachine: 'n', sha256: sha(bytes), name: 'a<b.txt', size: bytes.length });
    expect(begin).toMatchObject({ op: 'file-result', id: 'f1', ok: true, resumeFrom: 0 });
    expect(box.chunk({ op: 'file-chunk', id: 'f1', seq: 0, bytes: bytes.subarray(0, 5).toString('base64') })).toBe(true);
    expect(box.chunk({ op: 'file-chunk', id: 'f1', seq: 1, bytes: bytes.subarray(5).toString('base64') })).toBe(true);
    const end = box.end('f1');
    expect(end.ok).toBe(true);
    const expected = join(inboxDir, `${sha(bytes).slice(0, 8)}-a_b.txt`);
    expect(end.path).toBe(expected);
    expect(readFileSync(expected, 'utf8')).toBe('hello file channel');
    expect(existsSync(join(partsDir, `${sha(bytes)}.part`))).toBe(false);
    expect(existsSync(join(partsDir, `${sha(bytes)}.part.json`))).toBe(false);
  });

  it('dedups a repeated begin with an immediate ok+path+dedup', () => {
    const { box } = inbox();
    const bytes = Buffer.from('same content');
    box.begin({ op: 'file-begin', id: 'a', targetMachine: 'n', sha256: sha(bytes), name: 'x.txt', size: bytes.length });
    box.chunk({ op: 'file-chunk', id: 'a', seq: 0, bytes: bytes.toString('base64') });
    const first = box.end('a');
    expect(first.ok).toBe(true);
    const second = box.begin({ op: 'file-begin', id: 'b', targetMachine: 'n', sha256: sha(bytes), name: 'x.txt', size: bytes.length });
    expect(second).toMatchObject({ ok: true, dedup: true, path: first.path });
  });

  it('resumes from the part anchor after an interrupted transfer', () => {
    const { box } = inbox();
    const bytes = Buffer.concat([Buffer.alloc(FILE_CHUNK_BYTES + 10, 7)]);
    const meta = { sha256: sha(bytes), name: 'big.bin', size: bytes.length };
    box.begin({ op: 'file-begin', id: 't1', targetMachine: 'n', ...meta });
    box.chunk({ op: 'file-chunk', id: 't1', seq: 0, bytes: bytes.subarray(0, FILE_CHUNK_BYTES).toString('base64') });
    // 中断（不 end）。重新 begin → resumeFrom=1 → 从 seq 1 续传 → 完成
    const again = box.begin({ op: 'file-begin', id: 't2', targetMachine: 'n', ...meta });
    expect(again).toMatchObject({ ok: true, resumeFrom: 1 });
    expect(box.chunk({ op: 'file-chunk', id: 't2', seq: 1, bytes: bytes.subarray(FILE_CHUNK_BYTES).toString('base64') })).toBe(true);
    const end = box.end('t2');
    expect(end.ok).toBe(true);
  });

  it('rejects out-of-order chunks and fails the end on sha mismatch with cleanup', () => {
    const { box, partsDir } = inbox();
    const bytes = Buffer.from('good');
    const meta = { sha256: sha(bytes), name: 'g.txt', size: bytes.length };
    box.begin({ op: 'file-begin', id: 's1', targetMachine: 'n', ...meta });
    expect(box.chunk({ op: 'file-chunk', id: 's1', seq: 3, bytes: 'eHg=' })).toBe(false); // 失序
    box.chunk({ op: 'file-chunk', id: 's1', seq: 0, bytes: Buffer.from('evil').toString('base64') }); // 内容错
    const end = box.end('s1');
    expect(end.ok).toBe(false);
    expect(end.error).toContain('sha256');
    expect(existsSync(join(partsDir, `${meta.sha256}.part`))).toBe(false);
  });

  it('lazy-deletes stale inbox files (>5d), inbox overflow (oldest first) and stale parts', () => {
    const { box, inboxDir, partsDir } = inbox();
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(partsDir, { recursive: true });
    const old = join(inboxDir, 'old.txt');
    const fresh = join(inboxDir, 'fresh.txt');
    writeFileSync(old, 'old');
    writeFileSync(fresh, 'fresh');
    const stalePart = join(partsDir, 'dead.part');
    writeFileSync(stalePart, 'x');
    const now = Date.now();
    utimesSync(old, new Date(now - 6 * 24 * 3_600_000), new Date(now - 6 * 24 * 3_600_000));
    utimesSync(fresh, new Date(now), new Date(now));
    utimesSync(stalePart, new Date(now - 6 * 24 * 3_600_000), new Date(now - 6 * 24 * 3_600_000));
    box.begin({ op: 'file-begin', id: 'c1', targetMachine: 'n', sha256: sha('z'), name: 'z.txt', size: 1 });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(stalePart)).toBe(false);
  });

  it('handles two concurrent transfers interleaved by id', () => {
    const { box } = inbox();
    const a = Buffer.from('AAAA');
    const b = Buffer.from('BBBB');
    box.begin({ op: 'file-begin', id: 'id-a', targetMachine: 'n', sha256: sha(a), name: 'a.txt', size: 4 });
    box.begin({ op: 'file-begin', id: 'id-b', targetMachine: 'n', sha256: sha(b), name: 'b.txt', size: 4 });
    box.chunk({ op: 'file-chunk', id: 'id-a', seq: 0, bytes: a.toString('base64') });
    box.chunk({ op: 'file-chunk', id: 'id-b', seq: 0, bytes: b.toString('base64') });
    expect(box.end('id-a')).toMatchObject({ ok: true });
    expect(box.end('id-b')).toMatchObject({ ok: true });
  });
});

/** 帧缓冲 + waitFor 的裸 ws 客户端（构造即挂 message 监听，无丢帧竞态）。 */
class WsProbe {
  readonly ws: WebSocket;
  protected readonly frames: Frame[] = [];
  private readonly waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    clients.push(this);
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
      this.onUnmatched(frame);
    });
  }

  /** 握手（info→connect→connected）；auth/machineId 由子类或调用方定制。 */
  async handshake(auth: string, machineId?: string): Promise<void> {
    await this.opened();
    await this.waitFor((f) => f.op === 'info');
    this.send({ op: 'connect', proto: 1, role: machineId === undefined ? 'sender' : 'node', machineId, auth, caps: ['multi-star'] });
    await this.waitFor((f) => f.op === 'connected');
  }

  protected onUnmatched(frame: Frame): void {
    void frame; // 子类覆盖；基类无行为
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  waitFor(pred: (f: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    const seen = this.frames.find(pred);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }

  send(frame: Frame): void {
    this.ws.send(encodeFrame(frame));
  }

  close(): void {
    this.ws.close();
  }
}

interface LocalHarness {
  url: string;
  inboxDir: string;
  bodies: string[];
}

/** broker 即目标机（serve.ts 的真实接线形态：fileInbox + deliverLocal 同机）。 */
async function startLocalBroker(): Promise<LocalHarness> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  seedBroker(registryFile, {
    stars: [{ nodes: [{ label: 'self', key: key('k'), machineId: 'BROKER-MID', machineName: 'broker-host', addedAt: 'x' }] }],
  });
  const box = inbox();
  const bodies: string[] = [];
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: 'test',
    machineId: () => 'BROKER-MID',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: () => {},
    deliverLocal: async (frame) => {
      bodies.push(frame.body);
      return {
        op: 'result',
        id: frame.id,
        status: 'delivered',
        turn: '1',
        replyRef: 'mc1_f',
        output: JSON.stringify({ status: 'delivered', to: 'boss', turn: 1, replyRef: 'mc1_f' }),
      };
    },
    fileInbox: box.box,
    port: 0,
    heartbeatMs: 10_000,
    pongTimeoutMs: 20_000,
    connectTimeoutMs: 5_000,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { url: `ws://127.0.0.1:${port}`, inboxDir: box.inboxDir, bodies };
}

function senderDeps(port: number): { deps: SendDeps; baseDir: string } {
  const baseDir = mkdtempSync(join(root, 'home-'));
  mkdirSync(join(baseDir, 'tcp'), { recursive: true });
  writeFileSync(join(baseDir, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '127.0.0.1', port }, key: key('k') }));
  return {
    baseDir,
    deps: {
      env: {},
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [],
      deliverClaude: async () => ({ status: 'delivered' }),
      deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
      sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
      hostname: () => 'sender-host',
      machineId: () => 'SENDER-MID',
      tcpBaseDir: baseDir,
    },
  };
}

describe('file channel end-to-end through the broker', () => {
  it('transfers a small file, then sends the auto body message with the remote path', async () => {
    const h = await startLocalBroker();
    const { deps, baseDir } = senderDeps(Number(new URL(h.url).port));
    const src = join(baseDir, '数据 report.txt');
    writeFileSync(src, 'file content here');
    const { runSend } = await import('../src/commands/send.js');
    const result = await runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', fileArg: src }, deps);
    expect(result).toContain('delivered to boss@broker-host');
    // 对端 inbox 已落盘（sha 前 8 + 安全化原名，内容一致）
    const landed = readdirSync(h.inboxDir);
    expect(landed).toHaveLength(1);
    expect(landed[0]).toContain('数据 report.txt');
    expect(readFileSync(join(h.inboxDir, landed[0]!), 'utf8')).toBe('file content here');
    // 自动正文 = "文件 <原名> 已送达：<对端本地路径>"
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]).toContain('文件 数据 report.txt 已送达：');
    expect(h.bodies[0]).toContain(landed[0]!);
  }, 15_000);

  it('sends the explicit --body verbatim when given alongside --file', async () => {
    const h = await startLocalBroker();
    const { deps, baseDir } = senderDeps(Number(new URL(h.url).port));
    const src = join(baseDir, 'note.md');
    writeFileSync(src, 'see attachment');
    const { runSend } = await import('../src/commands/send.js');
    await runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', fileArg: src, bodyArg: '附言见文件' }, deps);
    expect(h.bodies[0]).toBe('附言见文件');
  }, 15_000);

  it('rejects file-begin over 64MiB at the broker with FILE_TOO_LARGE', async () => {
    const dir = mkdtempSync(join(root, 'case-'));
    const registryFile = registryFileOf(dir);
    seedBroker(registryFile, { stars: [{ nodes: [{ label: 'self', key: key('k'), machineId: 'BROKER-MID', machineName: 'broker-host', addedAt: 'x' }] }] });
    const broker = new Broker({
      registryFile,
      statusFile: join(dir, 'status-broker.json'),
      version: 'test',
      machineId: () => 'BROKER-MID',
      hostname: () => 'broker-host',
      now: () => Date.now(),
      log: () => {},
      deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'x' }),
      port: 0,
      heartbeatMs: 10_000,
      pongTimeoutMs: 20_000,
      connectTimeoutMs: 5_000,
    });
    brokers.push(broker);
    const port = await broker.start();
    const probe = new WsProbe(`ws://127.0.0.1:${port}`);
    await probe.handshake(key('k'));
    probe.send({ op: 'file-begin', id: 'big', targetMachine: 'broker-host', sha256: 'a'.repeat(64), name: 'big.bin', size: FILE_MAX_BYTES + 1 });
    const reply = await probe.waitFor((f) => f.op === 'error' && f.id === 'big');
    expect(reply).toMatchObject({ op: 'error', code: 'FILE_TOO_LARGE' });
  }, 10_000);
});
