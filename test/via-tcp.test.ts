import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import { registryFileOf, type NodeEntry } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { runViaTcpSend, sendViaTcp, selectBrokerEntry, tcpTimeoutMs } from '../src/serve/via-tcp.js';
import { formatSendResult } from '../src/application/send/format.js';
import type { BrokerEntry } from '../src/serve/node.js';
import { decodeRef, encodeRef } from '../src/ref.js';
import { recordConversation } from '../src/conversations.js';
import { runSend, type SendDeps } from '../src/commands/send.js';
import { MultichatError } from '../src/errors.js';
import type { SendLogEntry } from '../src/send-log.js';
import type { ResultFrame, SendFrame } from '../src/serve/protocol.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-via-tcp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(async () => {
  for (const b of brokers.splice(0)) await b.stop();
});
const brokers: Broker[] = [];
const key = (c: string) => c.repeat(64);

/** D0 降级临时文件探针：os.tmpdir 里的 crosschat-msg-*（与跑前快照做差，历史残迹不干扰）。 */
const msgTemps = (before?: Set<string>): string[] => {
  const all = readdirSync(tmpdir())
    .filter((f) => f.startsWith('crosschat-msg-'))
    .map((f) => join(tmpdir(), f));
  return before === undefined ? all : all.filter((f) => !before.has(f));
};

const deliveredReceipt: ResultFrame = {
  op: 'result',
  id: '',
  status: 'delivered',
  turn: '1',
  replyRef: 'mc1_x',
  output: JSON.stringify({ status: 'delivered', to: 'boss', turn: 1, replyRef: 'mc1_x' }),
};

describe('typed TCP receipt evidence', () => {
  it('reports queued evidence internally while preserving the delivered wire and CLI contract', async () => {
    const harness = await startBroker(async (frame) => ({
      ...deliveredReceipt, id: frame.id,
      output: JSON.stringify({ status: 'delivered', to: 'boss', turn: 1, replyRef: 'mc1_x', queued: true }),
    }));
    const fixture = makeFixture(harness);
    const result = await sendViaTcp({ conversation: 'mc1_x', via: 'tcp:broker-host' }, 'test', fixture.deps);
    expect(result.status).toBe('queued');
    expect(result.receipt.status).toBe('delivered');
    expect(JSON.parse(formatSendResult(result, true)).status).toBe('delivered');
    expect(formatSendResult(result)).toContain('delivered to boss@');
  });
});

interface Harness {
  port: number;
  deliverLocal: BrokerDeps['deliverLocal'];
}

async function startBroker(deliverLocal: BrokerDeps['deliverLocal'], inboxDirs?: { inboxDir: string; partsDir: string }, nodes?: NodeEntry[]): Promise<Harness> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  // sender 用 key('k')；broker 自己是 'broker-host'（BROKER-MID）→ 本机路由
  seedBroker(registryFile, {
    stars: [{
      nodes: nodes ?? [
        { label: 'self', key: key('k'), machineId: 'BROKER-MID', machineName: 'broker-host', addedAt: 'x' },
        { label: 'ghost', key: key('g'), machineId: 'm-ghost', machineName: 'ghost-host', addedAt: 'x' },
      ],
    }],
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
    ...(inboxDirs === undefined ? {} : { fileInbox: new FileInbox(inboxDirs) }),
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
    JSON.stringify({ broker: { host: '127.0.0.1', port: harness.port, name: 'broker-alias' }, key: key('k') }),
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
      sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
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

describe('019 两段式会话投递退役', () => {
  it('tcp 机器级目标 + --to 会话名 → SESSION_NOT_MEMBER 报错教学（连接前即拒绝，不依赖网络）', async () => {
    const fx = makeFixture(await startBroker(async () => deliveredReceipt));
    // tcpBaseDir 指向空目录：若收窄未先于入网检查生效，会得 USAGE 而非 SESSION_NOT_MEMBER
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', to: 'boss' } as never, 'x', { ...fx.deps, tcpBaseDir: mkdtempSync(join(root, 'empty-')) }),
      'SESSION_NOT_MEMBER',
    );
    expect(err.message).toContain('两段式会话投递已退役');
    expect(err.message).toContain('--connect');
    expect(err.message).toContain('三段寻址');
    // 带星选择器的两段式同判（tcp:<星>:<机器> + --to）
    await expectCode(
      runViaTcpSend({ via: 'tcp:live:broker-host', to: 'boss' } as never, 'x', { ...fx.deps, tcpBaseDir: mkdtempSync(join(root, 'empty-')) }),
      'SESSION_NOT_MEMBER',
    );
  });

  it('机器级零回归：--conversation 腿与 --file 腿照常投递（不受收窄影响）', async () => {
    const seen: SendFrame[] = [];
    const h = await startBroker(async (frame) => {
      seen.push(frame);
      return { ...deliveredReceipt, id: frame.id };
    });
    const fx = makeFixture(h);
    const out = await runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x' } as never, 'x', fx.deps);
    expect(out).toContain('delivered to boss@broker-host');
    expect(seen[0]).toMatchObject({ op: 'send', targetMachine: 'broker-host', conversation: 'mc1_x' });
    expect(seen[0]!.to).toBeUndefined();
  }, 10_000);
});

describe('runViaTcpSend against a real broker', () => {
  it('delivers and formats output ssh-style, recording send-log', async () => {
    const seen: SendFrame[] = [];
    const h = await startBroker(async (frame) => {
      seen.push(frame);
      return { ...deliveredReceipt, id: frame.id };
    });
    const fx = makeFixture(h);
    const out = await runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x', bodyArg: undefined } as never, 'hello', fx.deps);
    expect(out).toBe('delivered to boss@broker-host (turn 1)\nreply-ref: mc1_x');
    // send 帧携带目标与 origin（本机 m/mid 编码）
    expect(seen[0]).toMatchObject({ op: 'send', targetMachine: 'broker-host', conversation: 'mc1_x', body: 'hello' });
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
      runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x' } as never, 'x', fx.deps),
      'NAME_NOT_FOUND',
    );
    expect(err.message).toContain('[via tcp:broker-host]');
    expect(err.message).toContain('no session named nobody');
    expect(fx.logs[0]).toMatchObject({ status: 'failed', code: 'NAME_NOT_FOUND' });
  }, 10_000);

  it('027-F: selector present → error echo carries the star segment (misread-proof)', async () => {
    const h = await startBroker(async () => ({
      op: 'error' as const,
      code: 'SESSION_OFFLINE',
      message: '成员已下线',
    }));
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:broker-alias:broker-host', conversation: 'mc1_x' } as never, 'x', fx.deps),
      'SESSION_OFFLINE',
    );
    expect(err.message).toContain('[via tcp:broker-alias:broker-host]');
  }, 10_000);

  it('teaches PEER_OFFLINE with the ssh-alternative hint', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:ghost-host', conversation: 'mc1_x' } as never, 'x', fx.deps),
      'PEER_OFFLINE',
    );
    expect(err.message).toContain('对端离线');
    expect(err.message).toContain('若两端另配了 ssh 也可走 ssh 形态');
  }, 10_000);

  it('teaches UNKNOWN_MACHINE with the serve --list hint', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:no-such-host', conversation: 'mc1_x' } as never, 'x', fx.deps),
      'UNKNOWN_MACHINE',
    );
    expect(err.message).toContain('serve --list');
  }, 10_000);

  it('017 重名锁死：两台同名 machineName，--via tcp:<名> 得 MACHINE_NAME_COLLISION 且报错列 mid8 教消歧', async () => {
    // 改名自由化会抬高重名概率——name 轨多命中必须维持"报错+列 mid"（broker.ts 现行为回归锁）
    const h = await startBroker(async () => deliveredReceipt, undefined, [
      { label: 'self', key: key('k'), machineId: 'BROKER-MID', machineName: 'broker-host', addedAt: 'x' },
      { label: 'dup-a', key: key('a'), machineId: 'aaaa00001111', machineName: 'dup-name', addedAt: 'x' },
      { label: 'dup-b', key: key('b'), machineId: 'bbbb00002222', machineName: 'dup-name', addedAt: 'x' },
    ]);
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:dup-name', conversation: 'mc1_x' } as never, 'x', fx.deps),
      'MACHINE_NAME_COLLISION',
    );
    expect(err.message).toContain('[via tcp:dup-name]');
    expect(err.message).toContain('aaaa0000'); // mid8 在列（12 位形态含前 8）
    expect(err.message).toContain('bbbb0000');
    expect(err.message).toContain('mid');
  }, 10_000);

  it('times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording', async () => {
    const h = await startBroker(() => new Promise(() => {})); // 永不回应
    const fx = makeFixture(h, { CROSSCHAT_TCP_TIMEOUT_MS: '400' });
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x' } as never, 'x', fx.deps),
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
      JSON.stringify({ broker: { host: '127.0.0.1', port: 1, name: 'x' }, key: key('k') }),
    );
    await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x' } as never, 'x', { ...fx.deps, env: { CROSSCHAT_TCP_TIMEOUT_MS: '600' } }),
      'TCP_TRANSPORT_FAILED',
    );
  }, 10_000);

  it('teaches the not-joined error when node.json is missing', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const err = await expectCode(
      runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x' } as never, 'x', { ...fx.deps, tcpBaseDir: mkdtempSync(join(root, 'empty-')) }),
      'USAGE',
    );
    expect(err.message).toContain('本机未入网');
  }, 10_000);

  it('--json mode returns the receipt with via: tcp:<target>', async () => {
    const h = await startBroker(async (frame) => ({ ...deliveredReceipt, id: frame.id }));
    const fx = makeFixture(h);
    const out = await runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x', json: true } as never, 'hello', fx.deps);
    const parsed = JSON.parse(out) as { status: string; to: string; via: string };
    expect(parsed).toMatchObject({ status: 'delivered', to: 'boss@broker-host', via: 'tcp:broker-host' });
  }, 10_000);
});

describe('send --via tcp: branch in runSend', () => {
  it('D0: body over the 1MiB line auto-downgrades to the file channel (一次成功, temp deleted)', async () => {
    const inboxDir = mkdtempSync(join(root, 'inbox-'));
    const partsDir = mkdtempSync(join(root, 'parts-'));
    const bodies: string[] = [];
    const h = await startBroker(
      async (frame) => {
        bodies.push(frame.body);
        return { ...deliveredReceipt, id: frame.id };
      },
      { inboxDir, partsDir },
    );
    const fx = makeFixture(h);
    const before = new Set(msgTemps());
    const big = 'x'.repeat(1_048_577);
    const out = await runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', bodyArg: big }, fx.deps);
    expect(out).toContain('delivered to boss@broker-host');
    expect(out).toContain('正文超限已自动转文件通道：');
    // 投递的正文是文件通道的自动通知（带对端落地路径），不是超长原文
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('已送达');
    expect(bodies[0]).toContain(join(inboxDir));
    expect(bodies[0]).not.toContain(big.slice(0, 64));
    // 对端落地文件内容 = 原文
    const landed = out.split('正文超限已自动转文件通道：')[1]!.trim();
    expect(readFileSync(landed, 'utf8')).toBe(big);
    // 成功后临时文件已删（tmpdir 无新增 crosschat-msg-*）
    expect(msgTemps(before)).toHaveLength(0);
  }, 20_000);

  it('D0: body over 64MiB still fails FILE_TOO_LARGE, keeping the原文 temp file with its path', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    const before = new Set(msgTemps());
    const huge = 'x'.repeat(64 * 1024 * 1024 + 1);
    const err = await expectCode(
      runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', bodyArg: huge }, fx.deps),
      'FILE_TOO_LARGE',
    );
    expect(err.message).toContain('64MiB');
    expect(err.message).toContain('正文原文已保留');
    const kept = msgTemps(before);
    expect(kept).toHaveLength(1);
    expect(err.message).toContain(kept[0]!);
    rmSync(kept[0]!, { force: true });
  }, 30_000);

  it('D0: a failed downgraded send keeps the temp file and teaches its local path', async () => {
    const inboxDir = mkdtempSync(join(root, 'inbox-'));
    const partsDir = mkdtempSync(join(root, 'parts-'));
    const h = await startBroker(
      async () => ({ op: 'error' as const, code: 'NAME_NOT_FOUND', message: 'no session named nobody' }),
      { inboxDir, partsDir },
    );
    const fx = makeFixture(h);
    const before = new Set(msgTemps());
    const err = await expectCode(
      runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', bodyArg: 'x'.repeat(1_048_577) }, fx.deps),
      'NAME_NOT_FOUND',
    );
    expect(err.message).toContain('[via tcp:broker-host]');
    expect(err.message).toContain('正文原文已保留');
    const kept = msgTemps(before);
    expect(kept).toHaveLength(1);
    rmSync(kept[0]!, { force: true });
  }, 20_000);

  it('D0: explicit --file output stays free of the downgrade note', async () => {
    const inboxDir = mkdtempSync(join(root, 'inbox-'));
    const partsDir = mkdtempSync(join(root, 'parts-'));
    const h = await startBroker(async (frame) => ({ ...deliveredReceipt, id: frame.id }), { inboxDir, partsDir });
    const fx = makeFixture(h);
    const before = new Set(msgTemps());
    const file = join(fx.baseDir, 'note.txt');
    writeFileSync(file, 'small');
    const out = await runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', fileArg: file, bodyArg: '见附件' }, fx.deps);
    expect(out).toContain('delivered to boss@broker-host');
    expect(out).not.toContain('正文超限已自动转文件通道');
    expect(msgTemps(before)).toHaveLength(0);
  }, 10_000);

  it('routes tcp: through runViaTcpSend from the via branch', async () => {
    const h = await startBroker(async (frame) => ({ ...deliveredReceipt, id: frame.id }));
    const fx = makeFixture(h);
    const out = await runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', bodyArg: 'hi' }, fx.deps);
    expect(out).toContain('delivered to boss@broker-host');
  }, 10_000);

  it('rejects --file without --via tcp:', async () => {
    const h = await startBroker(async () => deliveredReceipt);
    const fx = makeFixture(h);
    await expectCode(runSend({ to: 'boss', bodyArg: 'x', fileArg: 'C:/tmp/a.txt' }, fx.deps), 'USAGE');
    await expectCode(runSend({ via: 'ssh:peer', to: 'boss', fileArg: 'C:/tmp/a.txt' }, fx.deps), 'USAGE');
  });

  it('B2.1: same-machine target rides the broker and resolves local by machineId (hostname shortcut deleted)', async () => {
    const inboxDir = mkdtempSync(join(root, 'inbox-'));
    const partsDir = mkdtempSync(join(root, 'parts-'));
    const bodies: string[] = [];
    const h = await startBroker(
      async (frame) => {
        bodies.push(frame.body);
        return deliveredReceipt;
      },
      { inboxDir, partsDir },
    );
    const fx = makeFixture(h);
    const file = join(fx.baseDir, 'report.txt');
    writeFileSync(file, 'data');
    // 发送方与 broker 不同名不同 mid——旧 hostname 同机特例不再触发，
    // 消息上 broker，resolveTarget 按注册表 machineId===broker 本机判定走 deliverLocal。
    const out = await runSend({ via: 'tcp:broker-host', conversation: 'mc1_x', fileArg: file }, fx.deps);
    expect(out).toContain('delivered to boss');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('文件 report.txt 已送达');
    expect(bodies[0]).toContain(join(inboxDir)); // 落的是 broker 本机收件路径
  }, 10_000);
});

describe('tcpTimeoutMs', () => {
  it('defaults to 120s and honours CROSSCHAT_TCP_TIMEOUT_MS', () => {
    expect(tcpTimeoutMs({})).toBe(120_000);
    expect(tcpTimeoutMs({ CROSSCHAT_TCP_TIMEOUT_MS: '3000' })).toBe(3_000);
    expect(tcpTimeoutMs({ CROSSCHAT_TCP_TIMEOUT_MS: 'wat' })).toBe(120_000);
  });
});

describe('B1 multi-star entry selection (selectBrokerEntry)', () => {
  const entries: BrokerEntry[] = [
    { host: '10.0.0.1', port: 1, name: 'alpha', starId: 'aaaa11110000', key: 'a' },
    { host: '10.0.0.2', port: 2, name: 'beta', starId: 'bbbb22220000', key: 'b' },
  ];
  const convWith = (starId?: string): string =>
    encodeRef({
      v: 1,
      f: { p: 'human' },
      t: { p: 'claude', id: 'a3f9c2e1-5b7d-4f8a-9c21-8e4d2b6a0f33' },
      n: 'ab',
      c: 1,
      ...(starId === undefined ? {} : { starId }),
    });

  function expectUsage(fn: () => unknown): MultichatError {
    try {
      fn();
      expect.unreachable('should have thrown USAGE');
    } catch (err) {
      expect(err).toBeInstanceOf(MultichatError);
      expect((err as MultichatError).code).toBe('USAGE');
      return err as MultichatError;
    }
  }

  it('a: selector matches the star name exactly first, then a unique starId prefix', () => {
    expect(selectBrokerEntry(entries, 'beta', undefined)).toBe(entries[1]);
    expect(selectBrokerEntry(entries, 'aaaa11', undefined)).toBe(entries[0]);
    expect(selectBrokerEntry(entries, 'bbbb', undefined)).toBe(entries[1]);
    // 星名优先于前缀：选择器恰为星名时不看 starId
    expect(selectBrokerEntry([...entries, { host: 'h', port: 3, name: 'be', starId: 'beta0000', key: 'x' }], 'beta', undefined)).toBe(entries[1]);
  });

  it('a: an ambiguous starId prefix teaches lengthening', () => {
    const twins: BrokerEntry[] = [
      { host: 'h1', port: 1, name: 'one', starId: 'aaaa11110000', key: 'k' },
      { host: 'h2', port: 2, name: 'two', starId: 'aaaa22220000', key: 'k' },
    ];
    const err = expectUsage(() => selectBrokerEntry(twins, 'aaaa', undefined));
    expect(err.message).toContain('命中多个星');
    expect(err.message).toContain('加长');
  });

  it('a: a selector with no hit lists every entry in cloud(6b76e1) form', () => {
    const err = expectUsage(() => selectBrokerEntry(entries, 'zzz', undefined));
    expect(err.message).toContain('alpha(aaaa11)');
    expect(err.message).toContain('beta(bbbb22)');
  });

  it('b: a bare via with --conversation routes by ref.starId exact match', () => {
    expect(selectBrokerEntry(entries, undefined, convWith('bbbb22220000'))).toBe(entries[1]);
    expect(selectBrokerEntry(entries, undefined, convWith('aaaa11110000'))).toBe(entries[0]);
  });

  it('b: ref.starId absent from node.json teaches config check', () => {
    const err = expectUsage(() => selectBrokerEntry(entries, undefined, convWith('cccc33330000')));
    expect(err.message).toContain('cccc33330000');
    expect(err.message).toContain('不在本机 node.json');
    expect(err.message).toContain('向管理员索取');
  });

  it('c: a single entry is used bare; a conversation starId still routes or teaches (b precedes c)', () => {
    const solo: BrokerEntry[] = [{ host: 'h', port: 9, starId: 'aaaa11110000', key: 'k' }];
    expect(selectBrokerEntry(solo, undefined, undefined)).toBe(solo[0]);
    expect(selectBrokerEntry(solo, undefined, convWith(undefined))).toBe(solo[0]);
    expect(selectBrokerEntry(solo, undefined, convWith('aaaa11110000'))).toBe(solo[0]);
    // ref 指向别的星：即使本机只有一条也教学（会话不经过本机的星）
    const err = expectUsage(() => selectBrokerEntry(solo, undefined, convWith('cccc33330000')));
    expect(err.message).toContain('不在本机 node.json');
  });

  it('d: multiple entries with no selector to go on list star names and show the selector example', () => {
    const err = expectUsage(() => selectBrokerEntry(entries, undefined, undefined));
    expect(err.message).toContain('alpha');
    expect(err.message).toContain('beta');
    expect(err.message).toContain('--via tcp:alpha:');
    const viaConversation = expectUsage(() => selectBrokerEntry(entries, undefined, convWith(undefined)));
    expect(viaConversation.message).toContain('tcp:alpha:');
  });
});

describe('B1 multi-entry node.json through the real send path', () => {
  it('bare tcp with two entries refuses with the entry list; tcp:<星名>:<target> and ref.starId both route', async () => {
    const h = await startBroker(async (frame) => ({ ...deliveredReceipt, id: frame.id }));
    const fx = makeFixture(h);
    writeFileSync(
      join(fx.baseDir, 'tcp', 'node.json'),
      JSON.stringify({
        brokers: [
          { host: '127.0.0.1', port: 1, name: 'dead', starId: 'dddd00000000', key: key('d') },
          { host: '127.0.0.1', port: h.port, name: 'live', starId: 'aaaa11112222', key: key('k') },
        ],
        showName: 'multi-star sender',
      }),
    );
    // 裸 tcp：多条目教选择器（示例取第一条的别名）
    const bare = await expectCode(runViaTcpSend({ via: 'tcp:broker-host', conversation: 'mc1_x' } as never, 'x', fx.deps), 'USAGE');
    expect(bare.message).toContain('dead');
    expect(bare.message).toContain('--via tcp:dead:');
    // 选择器走别名 → 连上 live 条目
    const out = await runViaTcpSend({ via: 'tcp:live:broker-host', conversation: 'mc1_x' } as never, 'hello', fx.deps);
    expect(out).toContain('delivered to boss@broker-host');
    // 裸 tcp + --conversation（ref.starId=live 的星）→ 同样连上
    const conv = encodeRef({
      v: 1,
      f: { p: 'human' },
      t: { p: 'claude', id: 'a3f9c2e1-5b7d-4f8a-9c21-8e4d2b6a0f33' },
      n: 'ab',
      c: 1,
      starId: 'aaaa11112222',
    });
    const out2 = await runViaTcpSend({ via: 'tcp:broker-host', conversation: conv } as never, 'hi', fx.deps);
    expect(out2).toContain('delivered to boss@broker-host');
  }, 10_000);
});

describe('016① 跨机回执机器段统一 name(mid8)', () => {
  // 真实平台形状：本地=linux 32 hex，对端=win 带杠 MachineGuid
  const localMid = '1111a2b3c4d5e6f7a8b9c0d1e2f30011';
  const peerMid = 'ec542c2c-9d2a-4bbb-9ccc-222233334444';
  const peerMid8 = 'ec542c2c';
  /** 回执 ref（对端接收腿签发）：f=本机端点（tcp origin m=mid8），t=对端端点（m=对端 hostname）。 */
  const peerRef = () =>
    encodeRef({
      v: 1,
      f: { p: 'claude', id: '1111a2b3-aaaa', m: localMid.slice(0, 8), mid: localMid },
      t: { p: 'codex', id: 'ec542c2c-9999', m: 'peer-host', mid: peerMid },
      n: '0011223344556677',
      c: 1,
      starId: 'aaaa00001111',
    });

  /** broker 即对端机（machineId=对端 mid）→ mid/名两种寻址都落 deliverLocal。 */
  async function startPeerBroker(deliverLocal: BrokerDeps['deliverLocal']): Promise<Harness> {
    const dir = mkdtempSync(join(root, 'case-'));
    const registryFile = registryFileOf(dir);
    seedBroker(registryFile, {
      stars: [{ nodes: [{ label: 'self', key: key('k'), machineId: peerMid, machineName: 'peer-host', addedAt: 'x' }] }],
    });
    const broker = new Broker({
      registryFile,
      statusFile: join(dir, 'status-broker.json'),
      version: 'test',
      machineId: () => peerMid,
      hostname: () => 'peer-host',
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

  const realReceipt: BrokerDeps['deliverLocal'] = async (frame) => ({
    op: 'result',
    id: frame.id,
    status: 'delivered',
    turn: '2',
    replyRef: peerRef(),
    output: JSON.stringify({ status: 'delivered', to: 'boss', turn: 2, replyRef: peerRef() }),
  });

  function realFixture(h: Harness): Fixture {
    const fx = makeFixture(h);
    fx.deps.machineId = () => localMid;
    fx.deps.hostname = () => 'sender-host';
    fx.deps.conversationStateFile = join(fx.baseDir, 'conversations.json');
    return fx;
  }

  it('mid 寻址回信 + 会话分片有名（信封到达时持久化）→ name(mid8)', async () => {
    const h = await startPeerBroker(realReceipt);
    const fx = realFixture(h);
    // 模拟此前跨机信封到达：from-machine 名随分片持久化（016 新字段）
    recordConversation(fx.deps.conversationStateFile!, decodeRef(peerRef()), 1_000, { [peerMid8]: 'cloudleg' });
    const out = await runViaTcpSend({ via: `tcp:${peerMid}`, conversation: 'mc1_x' } as never, 'hello', fx.deps);
    expect(out).toContain('delivered to boss@cloudleg(ec542c2c) (turn 2)');
    // 记账 to 同格式（status --conversations 的对端名来源）
    expect(fx.logs.at(-1)).toMatchObject({ to: 'boss@cloudleg(ec542c2c)', target: `via:tcp:${peerMid}` });
  }, 10_000);

  it('mid 寻址回信 + 旧状态（无名）→ 回退纯 mid8（不再裸奔完整指纹）', async () => {
    const h = await startPeerBroker(realReceipt);
    const fx = realFixture(h);
    const out = await runViaTcpSend({ via: `tcp:${peerMid}`, conversation: 'mc1_x' } as never, 'hello', fx.deps);
    expect(out).toContain('delivered to boss@ec542c2c (turn 2)');
  }, 10_000);

  it('按名发送（无状态）→ 名字取自输入，指纹取自回执 ref', async () => {
    const h = await startPeerBroker(realReceipt);
    const fx = realFixture(h);
    const out = await runViaTcpSend({ via: 'tcp:peer-host', conversation: 'mc1_x' } as never, 'hello', fx.deps);
    expect(out).toContain('delivered to boss@peer-host(ec542c2c) (turn 2)');
  }, 10_000);

  it('旧版远端回执（ref 不可解码）+ mid 寻址 → 仍收敛到 mid8', async () => {
    const h = await startPeerBroker(async (frame) => ({ ...deliveredReceipt, id: frame.id }));
    const fx = realFixture(h);
    const out = await runViaTcpSend({ via: `tcp:${peerMid}`, conversation: 'mc1_x' } as never, 'hello', fx.deps);
    expect(out).toContain('delivered to boss@ec542c2c (turn 1)');
  }, 10_000);
});
