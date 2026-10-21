import { execFile } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Broker, defaultDeliverLocal } from '../src/serve/broker.js';
import { CAP_MULTI_STAR, CAP_SESSION_MEMBERS } from '../src/serve/protocol.js';
import type { SocketLike } from '../src/serve/protocol.js';
import { loadBrokerFile, registryFileOf } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';

const STAR = '1234aabbccdd';
const NODE_KEY = 'a'.repeat(64);
const ADMIN_KEY = 'b'.repeat(64);
const MACHINE = 'aaaabbbb00001111';
const disposals: Array<() => void | Promise<void>> = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const dispose of disposals.reverse()) await dispose();
  disposals.length = 0;
});

type Packet = Record<string, unknown> & { op: string };

class ControlledSocket extends EventEmitter implements SocketLike {
  readyState: number = WebSocket.OPEN;
  readonly frames: Packet[] = [];
  onClosing?: () => void;
  private closing = false;

  send(text: string): void {
    const raw: unknown = JSON.parse(text);
    if (raw === null || typeof raw !== 'object' || !('op' in raw) || typeof raw.op !== 'string') throw new Error('invalid fixture frame');
    this.frames.push(raw as Packet);
  }

  receive(frame: Packet): void {
    this.emit('message', JSON.stringify(frame));
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.onClosing?.();
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

describe('revocation during current process lifecycles', () => {
  it('does not authenticate a replacement if old-socket close synchronously revokes its key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'crosschat-auth-race-'));
    disposals.push(() => rmSync(home, { recursive: true, force: true }));
    const file = registryFileOf(home);
    seedBroker(file, { stars: [{ starId: STAR, name: 'race', nodes: [
      { label: 'victim', key: NODE_KEY, machineId: MACHINE, addedAt: '2026-10-21T00:00:00.000Z' },
      { label: 'admin', adminKey: ADMIN_KEY, addedAt: '2026-10-21T00:00:00.000Z' },
    ] }] });
    const broker = new Broker({
      registryFile: file, statusFile: join(home, 'status-broker.json'), version: 'test', port: 0,
      machineId: () => 'fixture-broker', hostname: () => 'fixture-broker', now: Date.now, log: () => {},
      deliverLocal: defaultDeliverLocal, heartbeatMs: 60_000, connectTimeoutMs: 5_000,
    });
    await broker.start();
    disposals.push(() => broker.stop());
    const sockets: ControlledSocket[] = [];
    const socket = (): ControlledSocket => {
      const value = new ControlledSocket();
      sockets.push(value);
      broker.admitLocal(value, STAR);
      return value;
    };
    disposals.push(() => {
      for (const value of sockets) {
        value.onClosing = undefined;
        value.close();
      }
    });
    const admin = socket();
    admin.receive({ op: 'connect', proto: 1, role: 'sender', admin: true, caps: [CAP_MULTI_STAR] });
    const nonce = admin.frames.find((frame) => frame.op === 'auth-challenge')?.nonce;
    if (typeof nonce !== 'string') throw new Error('fixture did not receive a challenge');
    admin.receive({ op: 'auth-proof', proof: createHmac('sha256', ADMIN_KEY).update(nonce).digest('hex') });
    const connectNode = (value: ControlledSocket): void => {
      value.receive({ op: 'connect', proto: 1, role: 'node', machineId: MACHINE, auth: NODE_KEY, caps: [CAP_MULTI_STAR, CAP_SESSION_MEMBERS] });
    };
    const original = socket();
    connectNode(original);
    original.receive({ op: 'sessions', sessions: [{ sessionId: 'permanent-member', name: 'keep-seat' }] });
    original.onClosing = () => admin.receive({ op: 'admin-op', id: 'during-auth', action: 'remove-node', label: 'victim' });
    const replacement = socket();

    connectNode(replacement);

    expect(admin.frames).toContainEqual(expect.objectContaining({ op: 'admin-op-result', id: 'during-auth', removed: true }));
    expect(replacement.frames).toContainEqual(expect.objectContaining({ op: 'credential-revoked', starId: STAR, kind: 'node' }));
    expect(replacement.frames.some((frame) => frame.op === 'connected')).toBe(false);
    replacement.receive({ op: 'admin-op', id: 'must-not-read', action: 'list-nodes' });
    expect(replacement.frames.some((frame) => frame.id === 'must-not-read')).toBe(false);
    expect(loadBrokerFile(file).stars[0]!.roster).toContainEqual(expect.objectContaining({ sessionId: 'permanent-member' }));
  });

  it('a corrupt self-aggregator pause does not become an unhandled rejection in the broker', async () => {
    const home = mkdtempSync(join(tmpdir(), 'crosschat-owner-pause-'));
    disposals.push(() => rmSync(home, { recursive: true, force: true }));
    const moduleUrl = pathToFileURL(resolve('dist/commands/serve.js')).href;
    const script = `
      import { createHash } from 'node:crypto';
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { setTimeout as delay } from 'node:timers/promises';
      import { runServe } from ${JSON.stringify(moduleUrl)};
      const home = ${JSON.stringify(home)};
      const starId = ${JSON.stringify(STAR)};
      const key = ${JSON.stringify(NODE_KEY)};
      const name = ${JSON.stringify(`race-${randomUUID().slice(0, 8)}`)};
      const tcp = join(home, 'tcp');
      mkdirSync(tcp, { recursive: true });
      writeFileSync(join(tcp, 'broker.json'), JSON.stringify({ port: 0, stars: [{ starId, name, nodes: [
        { label: 'self', key, machineId: 'fixture-mid', machineName: 'fixture-node', addedAt: '2026-10-21T00:00:00.000Z' }
      ], roster: [] }] }));
      writeFileSync(join(tcp, 'node.json'), JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 0, starId, name, key }] }));
      const hash = (value) => createHash('sha256').update(value).digest('hex');
      writeFileSync(join(tcp, 'revoked-' + hash(key) + '-' + hash(starId) + '.json'), '{broken');
      const unhandled = [];
      const logs = [];
      process.on('unhandledRejection', (error) => unhandled.push(error?.code ?? 'unknown'));
      let stop;
      const fakeSend = {
        env: {}, listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [],
        deliverClaude: async () => { throw new Error('must not deliver'); },
        deliverCodex: async () => { throw new Error('must not deliver'); },
        sendLogFile: join(home, 'send.jsonl'), outboxDir: join(home, 'outbox'),
        now: Date.now, hostname: () => 'fixture-node', machineId: () => 'fixture-mid'
      };
      const running = runServe({}, {
        baseDir: home, env: {}, version: 'test', stdout: (line) => logs.push(line), stderr: (line) => logs.push(line),
        machineId: () => 'fixture-mid', hostname: () => 'fixture-node', networkInterfaces: () => ({}), now: Date.now,
        onSignal: (_signal, callback) => { stop = callback; }, listServeProcesses: () => [], makeSendDeps: () => fakeSend
      });
      const deadline = Date.now() + 2000;
      while (stop === undefined && Date.now() < deadline) await delay(10);
      if (stop === undefined) throw new Error('fixture broker did not start');
      await delay(100);
      stop();
      const code = await running;
      process.stdout.write(JSON.stringify({ code, unhandled, logs }));
    `;
    const env = { ...process.env };
    delete env.CROSSCHAT_LIVE;
    const child = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      env, timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024,
    });
    const report: unknown = JSON.parse(child.stdout);

    expect(report).toMatchObject({ code: 0, unhandled: [] });
  });
});
