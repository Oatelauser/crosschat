import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import { registryFileOf, writeRegistry } from '../src/serve/registry.js';
import { runViaTcpSend, tcpTimeoutMs } from '../src/serve/via-tcp.js';
import { runSend, type SendDeps } from '../src/commands/send.js';
import { MultichatError } from '../src/errors.js';
import type { SendLogEntry } from '../src/send-log.js';
import type { ResultFrame, SendFrame } from '../src/serve/protocol.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-via-tcp-'));
afterEach(async () => {
  for (const b of brokers.splice(0)) await b.stop();
});
const brokers: Broker[] = [];
const key = (c: string) => c.repeat(64);

const deliveredReceipt: ResultFrame = {
  op: 'result',
  id: '',
  status: 'delivered',
  turn: '1',
  replyRef: 'mc1_x',
  output: JSON.stringify({ status: 'delivered', to: 'boss', turn: 1, replyRef: 'mc1_x' }),
};

interface Harness {
  port: number;
  deliverLocal: BrokerDeps['deliverLocal'];
}

async function startBroker(deliverLocal: BrokerDeps['deliverLocal']): Promise<Harness> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  // sender 用 key('k')；broker 自己是 'broker-host'（BROKER-MID）→ 本机路由
  writeRegistry(registryFile, {
    nodes: [
      { label: 'self', key: key('k'), machineId: 'BROKER-MID', machineName: 'broker-host', addedAt: 'x' },
      { label: 'ghost', key: key('g'), machineId: 'm-ghost', machineName: 'ghost-host', addedAt: 'x' },
    ],
  });
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: 'test',
    machineId: () => 'BROKER-MID',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: () => {},
    deliverLocal,
    port: 0,
    heartbeatMs: 10_000,
    pongTimeoutMs: 20_000,
    connectTimeoutMs: 5_000,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { port, deliverLocal };
}

interface Fixture {
  deps: SendDeps;
  logs: SendLogEntry[];
  baseDir: string;
}

function makeFixture(harness: Harness, env: Record<string, string | undefined> = {}): Fixture {
  const baseDir = mkdtempSync(join(root, 'home-'));
  mkdirSync(join(baseDir, 'tcp'), { recursive: true });
  writeFileSync(
    join(baseDir, 'tcp', 'node.json'),
    JSON.stringify({ broker: { host: '127.0.0.1', port: harness.port, alias: 'broker-alias' }, key: key('k') }),
  );
  const logs: SendLogEntry[] = [];
  return {
    logs,
    baseDir,
    deps: {
      env,
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [],
      deliverClaude: async () => ({ status: 'delivered' }),
      deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
      rateDir: mkdtempSync(join(root, 'rate-')),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
      appendLog: (entry) => logs.push(entry),
      hostname: () => 'sender-host',
      machineId: () => 'SENDER-MID',
      tcpBaseDir: baseDir,
    },
  };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<MultichatError> {
  try {
    await p;
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe(code);
    return err as MultichatError;
  }
}

describe('runViaTcpSend against a real broker', () => {
  it('delivers and formats output ssh-style, recording send-log', async () => {
    const seen: SendFrame[] = [];
    const h = await startBroker(async (frame) => {
      seen.push(frame);
      return { ...deliveredReceipt, id: frame.id };
    });
    const fx = makeFixture(h);
    const out = await runViaTcpSend({ via: 'tcp:broker-host', to: 'boss', bodyArg: undefined } as never, 'hello', fx.deps);
    expect(out).toBe('delivered to boss@broker-host (turn 1)\nreply-ref: mc1_x');
    // send 帧携带目标与 origin（本机 m/mid 编码）
    expect(seen[0]).toMatchObject({ op: 'send', targetMachine: 'broker-host', to: 'boss', body: 'hello' });
    expect(seen[0]!.origin).toMatch(/^[A-Za-z0-9_-]+$/);
    // 发起侧记账
    expect(fx.logs).toHaveLength(1);
    expect(fx.logs[0]).toMatchObject({ status: 'delivered', target: 'via:tcp:broker-host', replyRef: 'mc1_x' });
  }, 10_000);

  it('rethrows a node business error with the same code and a [via tcp:目标] prefix', async () => {
    const h = await startBroker(async () => ({
      op: 'error' as const,
      code: 'NAME_NOT_FOUND',
      message: 'no session named nobody',
    }));
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', to: 'nobody' } as never, 'x', fx.deps),
      'NAME_NOT_FOUND',
    );
    expect(err.message).toContain('[via tcp:broker-host]');
    expect(err.message).toContain('no session named nobody');
    expect(fx.logs[0]).toMatchObject({ status: 'failed', code: 'NAME_NOT_FOUND' });
  }, 10_000);

  it('teaches PEER_OFFLINE with the ssh-alternative hint', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:ghost-host', to: 'boss' } as never, 'x', fx.deps),
      'PEER_OFFLINE',
    );
    expect(err.message).toContain('对端离线');
    expect(err.message).toContain('--via ssh:ghost-host');
  }, 10_000);

  it('teaches UNKNOWN_MACHINE with the serve --list hint', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:no-such-host', to: 'boss' } as never, 'x', fx.deps),
      'UNKNOWN_MACHINE',
    );
    expect(err.message).toContain('serve --list');
  }, 10_000);

  it('times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording', async () => {
    const h = await startBroker(() => new Promise(() => {})); // 永不回应
    const fx = makeFixture(h, { CROSSCHAT_TCP_TIMEOUT_MS: '400' });
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', to: 'boss' } as never, 'x', fx.deps),
      'TCP_TRANSPORT_FAILED',
    );
    expect(err.message).toContain('远端状态不明');
    expect(err.message).toContain('勿盲目重发');
    expect(fx.logs[0]).toMatchObject({ status: 'failed', code: 'TCP_TRANSPORT_FAILED' });
  }, 10_000);

  it('fails with TCP_TRANSPORT_FAILED when the broker is unreachable', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    // 指向一个无人监听的端口
    writeFileSync(
      join(fx.baseDir, 'tcp', 'node.json'),
      JSON.stringify({ broker: { host: '127.0.0.1', port: 1, alias: 'x' }, key: key('k') }),
    );
    await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', to: 'boss' } as never, 'x', { ...fx.deps, env: { CROSSCHAT_TCP_TIMEOUT_MS: '600' } }),
      'TCP_TRANSPORT_FAILED',
    );
  }, 10_000);

  it('teaches the not-joined error when node.json is missing', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', to: 'boss' } as never, 'x', { ...fx.deps, tcpBaseDir: mkdtempSync(join(root, 'empty-')) }),
      'USAGE',
    );
    expect(err.message).toContain('本机未入网');
  }, 10_000);

  it('--json mode returns the receipt with via: tcp:<target>', async () => {
    const h = await startBroker(async (frame) => ({ ...deliveredReceipt, id: frame.id }));
    const fx = makeFixture(h);
    const out = await runViaTcpSend({ via: 'tcp:broker-host', to: 'boss', json: true } as never, 'hello', fx.deps);
    const parsed = JSON.parse(out) as { status: string; to: string; via: string };
    expect(parsed).toMatchObject({ status: 'delivered', to: 'boss@broker-host', via: 'tcp:broker-host' });
  }, 10_000);
});

describe('send --via tcp: branch in runSend', () => {
  it('prechecks the body with the tcp tail (teaches --file, never scp)', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const big = 'x'.repeat(1_048_577);
    const err = await expectCode(
      runSend({ via: 'tcp:broker-host', to: 'boss', bodyArg: big }, fx.deps),
      'MESSAGE_TOO_LARGE',
    );
    expect(err.message).toContain('--file <路径>');
    expect(err.message).not.toContain('scp');
  }, 10_000);

  it('routes tcp: through runViaTcpSend from the via branch', async () => {
    const h = await startBroker(async (frame) => ({ ...deliveredReceipt, id: frame.id }));
    const fx = makeFixture(h);
    const out = await runSend({ via: 'tcp:broker-host', to: 'boss', bodyArg: 'hi' }, fx.deps);
    expect(out).toContain('delivered to boss@broker-host');
  }, 10_000);

  it('rejects --file without --via tcp:', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    await expectCode(runSend({ to: 'boss', bodyArg: 'x', fileArg: 'C:/tmp/a.txt' }, fx.deps), 'USAGE');
    await expectCode(runSend({ via: 'ssh:peer', to: 'boss', fileArg: 'C:/tmp/a.txt' }, fx.deps), 'USAGE');
  });

  it('same-machine special: local file path becomes the body without any transfer', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const delivered: string[] = [];
    const deps: SendDeps = {
      ...fx.deps,
      hostname: () => 'broker-host', // 目标=本机
      listClaudeSessions: () => ({
        sessions: [{ pid: 1, sessionId: 's1', kind: 'interactive', name: 'boss', status: 'idle', messagingSocketPath: 'p' }],
        malformed: 0,
      }),
      deliverClaude: async (_t, content) => {
        delivered.push(content);
        return { status: 'delivered' };
      },
    };
    const file = join(fx.baseDir, 'report.txt');
    writeFileSync(file, 'data');
    const out = await runSend({ via: 'tcp:broker-host', to: 'boss', fileArg: file }, deps);
    expect(out).toContain('delivered to boss');
    expect(delivered[0]).toContain(file); // 本机路径直接进正文
  }, 10_000);
});

describe('tcpTimeoutMs', () => {
  it('defaults to 120s and honours CROSSCHAT_TCP_TIMEOUT_MS', () => {
    expect(tcpTimeoutMs({})).toBe(120_000);
    expect(tcpTimeoutMs({ CROSSCHAT_TCP_TIMEOUT_MS: '3000' })).toBe(3_000);
    expect(tcpTimeoutMs({ CROSSCHAT_TCP_TIMEOUT_MS: 'wat' })).toBe(120_000);
  });
});
