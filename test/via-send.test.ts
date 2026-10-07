import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSshArgv,
  decodeOriginIdentity,
  encodeOrigin,
  parseViaValue,
  validateRemoteFlagValues,
  type SshResult,
} from '../src/federation.js';
import { runSend, type SendArgs, type SendDeps } from '../src/commands/send.js';
import { decodeRef, encodeRef } from '../src/ref.js';
import { parseSendArgs } from '../src/cli.js';
import { MultichatError } from '../src/errors.js';
import type { SendLogEntry } from '../src/send-log.js';
import type { ClaudeRegistryScan, ClaudeSessionEntry } from '../src/claude/registry.js';

const sessions: ClaudeSessionEntry[] = [
  { pid: 201, sessionId: 'cs-boss', kind: 'interactive', name: 'boss', status: 'idle', messagingSocketPath: 'sock-boss' },
];
const scan: ClaudeRegistryScan = { sessions, malformed: 0 };

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crosschat-fed-'));
  tempDirs.push(dir);
  return dir;
}

const logs: SendLogEntry[] = [];
const sshCalls: { argv: string[]; input: string; timeoutMs: number }[] = [];
let sshResult: SshResult = { code: 0, stdout: '', stderr: '' };

function makeDeps(env: Record<string, string | undefined> = {}): SendDeps {
  return {
    env,
    listClaudeSessions: () => scan,
    listCodexThreads: async () => [],
    deliverClaude: async () => ({ status: 'delivered' }),
    deliverCodex: async () => ({ status: 'accepted', turnId: 't1' }),
    rateDir: tempDir(),
    outboxDir: tempDir(),
    now: () => 9_000_000,
    appendLog: (entry) => logs.push(entry),
    hostname: () => 'win-dev',
    sshExec: async (argv, input, timeoutMs) => {
      sshCalls.push({ argv: [...argv], input, timeoutMs });
      return sshResult;
    },
  };
}

const viaSend = (args: Partial<SendArgs>, env: Record<string, string | undefined> = {}) =>
  runSend({ via: 'ssh:build01', ...args } as SendArgs, makeDeps(env));

async function expectCode(promise: Promise<unknown>, code: string): Promise<MultichatError> {
  try {
    await promise;
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe(code);
    return err as MultichatError;
  }
}

describe('parseViaValue', () => {
  it('accepts ssh:<alias> and rejects everything else', () => {
    expect(parseViaValue('ssh:build01')).toEqual({ transport: 'ssh', host: 'build01' });
    expect(parseViaValue('ssh:my_host.2')).toEqual({ transport: 'ssh', host: 'my_host.2' });
    expect(() => parseViaValue('tcp:1.2.3.4')).toThrow(/二期支持/);
    expect(() => parseViaValue('broker:main')).toThrow(/二期支持/);
    expect(() => parseViaValue('quic:x')).toThrow(/仅支持 ssh/);
    expect(() => parseViaValue('build01')).toThrow(/USAGE|--via/);
    expect(() => parseViaValue('ssh:bad host')).toThrow(/注入/);
    expect(() => parseViaValue('ssh:a&b')).toThrow(/注入/);
    expect(() => parseViaValue('ssh:')).toThrow(/注入|USAGE/);
  });
});

describe('validateRemoteFlagValues', () => {
  it('keeps dangerous characters out of the remote argv', () => {
    expect(() => validateRemoteFlagValues({ to: 'my worker' })).toThrow(/id8|conversation/);
    expect(() => validateRemoteFlagValues({ to: 'a&whoami' })).toThrow();
    expect(() => validateRemoteFlagValues({ to: '-x' })).toThrow();
    expect(() => validateRemoteFlagValues({ to: 'worker2' })).not.toThrow();
    expect(() => validateRemoteFlagValues({ conversation: 'mc1_abc-XYZ_1' })).not.toThrow();
    expect(() => validateRemoteFlagValues({ conversation: 'mc3_abc' })).toThrow();
  });
});

describe('origin encode/decode', () => {
  it('round-trips the FULL id (B2.1) with an optional display name; spaces/unicode immune', () => {
    const enc1 = encodeOrigin({ p: 'claude', id: 'cs-full-1', name: '我 boss' }, 'win-dev');
    expect(enc1).toMatch(/^[A-Za-z0-9_-]+$/); // base64url only — never an argv hazard (F1)
    expect(decodeOriginIdentity(enc1)).toEqual({ p: 'claude', id: 'cs-full-1', name: '我 boss', host: 'win-dev' });
    // nameless claude: id only, no name key
    expect(decodeOriginIdentity(encodeOrigin({ p: 'claude', id: 'cs-2' }, 'win-dev'))).toEqual({
      p: 'claude',
      id: 'cs-2',
      host: 'win-dev',
    });
    expect(decodeOriginIdentity(encodeOrigin({ p: 'codex', id: '01a1115b-1a3c-7e71-addc-fee969078e1b' }, 'win-dev'))).toEqual({
      p: 'codex',
      id: '01a1115b-1a3c-7e71-addc-fee969078e1b',
      host: 'win-dev',
    });
    expect(decodeOriginIdentity(encodeOrigin({ p: 'human' }, 'win-dev'))).toEqual({ p: 'human', host: 'win-dev' });
    expect(() => decodeOriginIdentity('!!not-b64!!')).toThrow(/格式非法/);
  });

  it('names may contain @ and / — lastIndexOf(@) keeps the host, first rest-/ bounds the id (B2.1)', () => {
    expect(decodeOriginIdentity(encodeOrigin({ p: 'claude', id: 'cs-x', name: 'a@b/c d' }, 'win-dev'))).toEqual({
      p: 'claude',
      id: 'cs-x',
      name: 'a@b/c d',
      host: 'win-dev',
    });
    expect(() => decodeOriginIdentity(Buffer.from('claude//name@h', 'utf8').toString('base64url'))).toThrow(/格式非法/);
    expect(() => decodeOriginIdentity(Buffer.from('claude/cs-1/@h', 'utf8').toString('base64url'))).toThrow(/格式非法/);
  });
});

describe('buildSshArgv', () => {
  it('fixed face: BatchMode, ConnectTimeout, remote crosschat send --json --origin; body never in argv', () => {
    const origin = encodeOrigin({ p: 'claude', id: 'cs-boss', name: 'boss' }, 'win-dev');
    const argv = buildSshArgv('build01', { to: 'worker2' }, origin);
    expect(argv).toEqual([
      'ssh', 'build01',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      'crosschat', 'send',
      '--to', 'worker2',
      '--json',
      '--origin', origin,
    ]);
    expect(argv).not.toContain('你好 body');
    const argvRef = buildSshArgv('build01', { conversation: 'mc1_ab12' }, origin);
    expect(argvRef).toContain('--conversation');
    expect(argvRef).toContain('mc1_ab12');
  });
});

describe('runViaSend mapping', () => {
  it('renders delivered with @host and logs the audit entry', async () => {
    logs.length = 0;
    sshResult = { code: 0, stdout: '{"status":"delivered","to":"worker2","turn":3,"replyRef":"mc1_R"}\n', stderr: '' };
    const out = await viaSend({ to: 'worker2', bodyArg: '干活' }, { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-boss' });
    expect(out).toBe('delivered to worker2@build01 (turn 3)\nreply-ref: mc1_R');
    expect(sshCalls.at(-1)!.input).toBe('干活'); // body rides stdin, not argv
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ to: 'worker2@build01', target: 'via:build01', status: 'delivered', turn: 3, fromName: 'boss' });
  });

  it('renders parked with the remote mailbox annotated (位于 host)', async () => {
    sshResult = {
      code: 0,
      stdout: '{"status":"parked","to":"worker2","turn":4,"replyRef":"mc1_R","queue":2,"mailbox":"/home/deploy/crosschat/mailbox/01a1.md"}\n',
      stderr: '',
    };
    const out = await viaSend({ to: 'worker2', bodyArg: 'x' });
    expect(out).toContain('已寄存给 worker2@build01');
    expect(out).toContain('队列共 2 条');
    expect(out).toContain('（位于 build01）');
  });

  it('renders queued like the single-machine wording', async () => {
    sshResult = { code: 0, stdout: '{"status":"queued","to":"worker2","turn":5,"replyRef":"mc1_R"}\n', stderr: '' };
    const out = await viaSend({ to: 'worker2', bodyArg: 'x' });
    expect(out).toContain('queued to worker2@build01 (turn 5; 对方正忙，已入队');
  });

  it('local --json passes the receipt through and adds via', async () => {
    sshResult = { code: 0, stdout: '{"status":"delivered","to":"worker2","turn":1,"replyRef":"mc1_R"}\n', stderr: '' };
    const out = await viaSend({ to: 'worker2', bodyArg: 'x', json: true });
    expect(JSON.parse(out)).toEqual({ status: 'delivered', to: 'worker2', turn: 1, replyRef: 'mc1_R', via: 'ssh:build01' });
  });

  it('rethrows the SAME remote business code with [via host] prefix and logs failed', async () => {
    logs.length = 0;
    sshResult = { code: 1, stdout: '', stderr: 'crosschat: MESSAGE_TOO_LARGE: Body is 17000 bytes; the limit is 16384. Write the content to a file and send the path instead.\n' };
    const err = await expectCode(viaSend({ to: 'worker2', bodyArg: 'x' }), 'MESSAGE_TOO_LARGE');
    expect(err.message).toContain('[via build01]');
    expect(err.message).toContain('Write the content to a file');
    expect(logs[0]).toMatchObject({ status: 'failed', code: 'MESSAGE_TOO_LARGE' });
  });

  it('maps unknown remote failures to REMOTE_FAILED with a stderr tail', async () => {
    sshResult = { code: 1, stdout: '', stderr: 'node: internal crash\n' };
    const err = await expectCode(viaSend({ to: 'worker2', bodyArg: 'x' }), 'REMOTE_FAILED');
    expect(err.message).toContain('internal crash');
  });

  it('maps ssh exit 255 to SSH_TRANSPORT_FAILED with the probe hint', async () => {
    sshResult = { code: 255, stdout: '', stderr: 'ssh: connect to host build01 port 22: Connection refused' };
    const err = await expectCode(viaSend({ to: 'worker2', bodyArg: 'x' }), 'SSH_TRANSPORT_FAILED');
    expect(err.message).toContain('ssh build01 crosschat --version');
  });

  it('maps local timeout to SSH_TRANSPORT_TIMEOUT with the do-not-resend discipline', async () => {
    logs.length = 0;
    sshResult = { code: null, stdout: '', stderr: '', timedOut: true };
    const err = await expectCode(viaSend({ to: 'worker2', bodyArg: 'x' }), 'SSH_TRANSPORT_TIMEOUT');
    expect(err.message).toContain('勿盲目重发');
    expect(logs[0]).toMatchObject({ status: 'failed', code: 'SSH_TRANSPORT_TIMEOUT' });
  });

  it('CROSSCHAT_SSH_TIMEOUT_MS overrides the 120s default', async () => {
    sshResult = { code: 0, stdout: '{"status":"delivered","to":"w","turn":1,"replyRef":"r"}\n', stderr: '' };
    await viaSend({ to: 'w', bodyArg: 'x' }, { CROSSCHAT_SSH_TIMEOUT_MS: '5000' });
    expect(sshCalls.at(-1)!.timeoutMs).toBe(5000);
  });

  it('records the remote-issued ref locally so --conversations shows the cross-machine pair', async () => {
    const ref = (() => {
      // mc1_ ref for {v:1,f:{p:'claude',id:'boss'},t:{p:'codex',id:'01a1'},n:'ab',c:1}
      const payload = { v: 1, f: { p: 'claude', id: 'boss' }, t: { p: 'codex', id: '01a1' }, n: 'ab', c: 1 };
      return 'mc1_' + Buffer.from(JSON.stringify(payload)).toString('base64url');
    })();
    sshResult = { code: 0, stdout: `{"status":"delivered","to":"worker2","turn":1,"replyRef":"${ref}"}\n`, stderr: '' };
    const stateFile = join(tempDir(), 'conversations.json');
    await runSend({ via: 'ssh:build01', to: 'worker2', bodyArg: 'x' }, { ...makeDeps(), conversationStateFile: stateFile });
    // B20 shard layout: one file per pair under <dir>/conversations/.
    const shards = readdirSync(join(stateFile, '..', 'conversations'));
    expect(shards).toHaveLength(1);
    // B2: the shard stores the mc2 re-encoding — same decoded ref, compact form.
    const stored = JSON.parse(readFileSync(join(stateFile, '..', 'conversations', shards[0]!), 'utf8')) as { ref: string };
    expect(decodeRef(stored.ref)).toEqual(decodeRef(ref));
    expect(stored.ref.startsWith('mc2_')).toBe(true);
  });
});

describe('remote-side --origin consumption', () => {
  it('falls back to the origin identity when the shell has no agent env', async () => {
    // Remote leg simulation: empty env (sshd shell) + --origin from the sender.
    const origin = encodeOrigin({ p: 'claude', id: 'cs-boss', name: 'boss' }, 'win-dev');
    const delivered: string[] = [];
    const deps = makeDeps();
    deps.deliverClaude = async (_t, content) => {
      delivered.push(content);
      return { status: 'delivered' };
    };
    await runSend({ to: 'boss', bodyArg: 'hi', origin }, deps);
    // Target resolves to the local session named boss; envelope from-name must be
    // the ORIGIN identity (boss), not a collapsed human.
    expect(delivered[0]).toContain('from-name="boss"');
  });

  it('env identity wins over --origin when both are present', async () => {
    const origin = encodeOrigin({ p: 'codex', id: 'zzzz9999' }, 'other-host');
    const delivered: string[] = [];
    const deps = makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-boss' });
    deps.deliverClaude = async (_t, content) => {
      delivered.push(content);
      return { status: 'delivered' };
    };
    await runSend({ to: 'boss', bodyArg: 'hi', origin }, deps);
    expect(delivered[0]).toContain('from-name="boss"'); // env-resolved session name, not the origin codex id8
  });
});

describe('cli parsing and zero regression', () => {
  it('parseSendArgs accepts --via/--origin (space and = forms) and keeps them hidden-legal', () => {
    const args = parseSendArgs(['--via', 'ssh:build01', '--to', 'worker2', '--origin=abc_1', '--json']);
    expect(args).toEqual({ via: 'ssh:build01', to: 'worker2', origin: 'abc_1', json: true });
  });

  it('without --via the ssh executor is never touched (D9 byte-identical local path)', async () => {
    sshCalls.length = 0;
    const deps = makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-boss' });
    const delivered: string[] = [];
    deps.deliverClaude = async (_t, content) => {
      delivered.push(content);
      return { status: 'delivered' };
    };
    await runSend({ to: 'boss', bodyArg: 'hi' }, deps);
    expect(sshCalls).toHaveLength(0);
    expect(delivered[0]).toContain('from-name="boss"');
  });

  it('via sends still enforce the local 16K cap before transport (D6)', async () => {
    sshCalls.length = 0;
    await expectCode(viaSend({ to: 'worker2', bodyArg: 'x'.repeat(16_385) }), 'MESSAGE_TOO_LARGE');
    expect(sshCalls).toHaveLength(0);
  });
});

describe('B2 reply path (m stamping, envelope via, auto-complete)', () => {
  function makeRemoteDeps(opts: { hostname: string; mid?: string; deliverClaude?: (content: string) => void }) {
    const deps = makeDeps();
    return {
      ...deps,
      hostname: () => opts.hostname,
      ...(opts.mid === undefined ? {} : { machineId: () => opts.mid }),
      deliverClaude: async (_t: unknown, content: string) => {
        opts.deliverClaude?.(content);
        return { status: 'delivered' as const };
      },
    };
  }

  it('fills a missing --via from the ref endpoint whose machine is not here', async () => {
    sshCalls.length = 0;
    const ref = encodeRef({ v: 1, f: { p: 'claude', id: 'boss', m: 'win-dev' }, t: { p: 'codex', id: '01a1115b-1a3c-7e71-addc-fee969078e1b', m: 'build01' }, n: '9d4f2ab1c3e85760', c: 1 });
    sshResult = { code: 0, stdout: '', stderr: '' }; // force a deterministic receipt shape
    await runSend({ conversation: ref, bodyArg: 'x' }, makeRemoteDeps({ hostname: 'build01' })).catch(() => undefined);
    expect(sshCalls).toHaveLength(1);
    expect(sshCalls[0]!.argv).toContain('win-dev');
    expect(sshCalls[0]!.argv).toContain(ref);
  });

  it('does not add --via when no endpoint names a foreign machine', async () => {
    sshCalls.length = 0;
    const ref = encodeRef({ v: 1, f: { p: 'claude', id: 'cs-boss' }, t: { p: 'claude', id: 'cs-2' }, n: '0011223344556677', c: 1 });
    // single-machine ref, caller is t (cs-2) via env: target cs-boss resolves locally
    const deps = makeRemoteDeps({ hostname: 'win-dev' });
    await runSend({ conversation: ref, bodyArg: 'x' }, { ...deps, env: { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-2' } }).catch(() => undefined);
    expect(sshCalls).toHaveLength(0);
  });

  it('remote-origin send stamps both endpoints and the envelope carries the return --via', async () => {
    const origin = encodeOrigin({ p: 'claude', id: 'boss', name: 'boss' }, 'win-dev');
    let envelope = '';
    const deps = makeRemoteDeps({
      hostname: 'build01',
      deliverClaude: (content) => { envelope = content; },
    });
    // ssh shell: no agent env, --origin speaks; target boss resolves via the registry scan
    const out = await runSend({ to: 'boss', bodyArg: 'task', origin }, deps);
    expect(out).toContain('delivered to boss');
    const embedded = envelope.match(/mc2_[A-Za-z0-9_-]+/)![0]!;
    const ref = decodeRef(embedded);
    expect(ref.f).toEqual({ p: 'claude', id: 'boss', m: 'win-dev' });
    expect(ref.t).toEqual({ p: 'claude', id: 'cs-boss', m: 'build01' });
    expect(envelope).toContain('crosschat send --via ssh:win-dev --conversation mc2_');
  });

  it('B2.1 regression: the origin FULL id rides the ref (routable), the name only displays', async () => {
    // Defect (user drill 2026-10-07): origin used to carry the display name/id8,
    // so cross-machine reply-hint refs pointed at "alpha" — unroutable, only the
    // --to fallback survived. The ref must carry the full session id.
    const origin = encodeOrigin({ p: 'claude', id: 'a3f9c2e1-5b7d-4f8a-9c21-8e4d2b6a0f33', name: 'alpha' }, 'win-dev');
    let envelope = '';
    const deps = makeRemoteDeps({
      hostname: 'build01',
      deliverClaude: (content) => { envelope = content; },
    });
    await runSend({ to: 'boss', bodyArg: 'task', origin }, deps);
    const ref = decodeRef(envelope.match(/mc2_[A-Za-z0-9_-]+/)![0]!);
    expect(ref.f).toEqual({ p: 'claude', id: 'a3f9c2e1-5b7d-4f8a-9c21-8e4d2b6a0f33', m: 'win-dev' });
    expect(ref.f.id).not.toBe('alpha'); // name must never leak into the routable id
    expect(envelope).toContain('from-name="alpha"'); // display name survives for humans
    expect(envelope).toContain('--via ssh:win-dev --conversation mc2_'); // return route rides the ref
  });

  it('origin host equal to the local hostname leaves the envelope single-machine shaped', async () => {
    const origin = encodeOrigin({ p: 'claude', id: 'boss', name: 'boss' }, 'win-dev');
    let envelope = '';
    const deps = makeRemoteDeps({
      hostname: 'win-dev',
      deliverClaude: (content) => { envelope = content; },
    });
    await runSend({ to: 'boss', bodyArg: 'task', origin }, deps);
    expect(envelope).not.toContain('--via');
    const ref = decodeRef(envelope.match(/mc2_[A-Za-z0-9_-]+/)![0]!);
    expect(ref.f.m).toBe('win-dev');
    expect(ref.t.m).toBe('win-dev');
  });
});

describe('B10 machine-id dual identity (m routes, mid decides same-machine)', () => {
  const fullId = 'a3f9c2e1-5b7d-4f8a-9c21-8e4d2b6a0f33';
  function remoteDeps(opts: { hostname: string; mid?: string; deliverClaude?: (content: string) => void }): SendDeps {
    const deps = makeDeps();
    return {
      ...deps,
      hostname: () => opts.hostname,
      ...(opts.mid === undefined ? {} : { machineId: () => opts.mid }),
      deliverClaude: async (_t: unknown, content: string) => {
        opts.deliverClaude?.(content);
        return { status: 'delivered' as const };
      },
    };
  }

  it('loopback: same host AND same mid stays single-machine (no --via, no warning)', async () => {
    const origin = encodeOrigin({ p: 'claude', id: fullId, name: 'alpha' }, 'yang', 'M1');
    let envelope = '';
    let out = '';
    const deps = remoteDeps({
      hostname: 'yang',
      mid: 'M1',
      deliverClaude: (content) => { envelope = content; },
    });
    out = await runSend({ to: 'boss', bodyArg: 'x', origin }, deps);
    expect(out).not.toContain('⚠');
    expect(envelope).toContain('crosschat send --conversation mc2_');
    expect(envelope).not.toContain('--via ssh:');
    const ref = decodeRef(envelope.match(/mc2_[A-Za-z0-9_-]+/)![0]!);
    expect(ref.f).toEqual({ p: 'claude', id: fullId, m: 'yang', mid: 'M1' });
    expect(ref.t).toEqual({ p: 'claude', id: 'cs-boss', m: 'yang', mid: 'M1' });
  });

  it('hostname collision: equal host, different mid routes cross-machine with a warning', async () => {
    const origin = encodeOrigin({ p: 'claude', id: fullId, name: 'alpha' }, 'yang', 'M-WIN');
    let envelope = '';
    const deps = remoteDeps({
      hostname: 'yang',
      mid: 'M-WSL',
      deliverClaude: (content) => { envelope = content; },
    });
    const out = await runSend({ to: 'boss', bodyArg: 'x', origin }, deps);
    expect(out).toContain('⚠ 两台机器同名 (yang)');
    // The per-machine ssh alias namespace resolves "yang" to the peer here.
    expect(envelope).toContain('--via ssh:yang --conversation mc2_');
    const ref = decodeRef(envelope.match(/mc2_[A-Za-z0-9_-]+/)![0]!);
    expect(ref.f).toEqual({ p: 'claude', id: fullId, m: 'yang', mid: 'M-WIN' });
    expect(ref.t).toEqual({ p: 'claude', id: 'cs-boss', m: 'yang', mid: 'M-WSL' });
  });

  it('json receipt carries the collision warning as a field', async () => {
    const origin = encodeOrigin({ p: 'claude', id: fullId }, 'yang', 'M-WIN');
    const deps = remoteDeps({ hostname: 'yang', mid: 'M-WSL' });
    const out = await runSend({ to: 'boss', bodyArg: 'x', origin, json: true }, deps);
    expect((JSON.parse(out) as { warning?: string }).warning).toContain('两台机器同名');
  });

  it('mid missing on either side falls back to hostname equality (pre-B10 semantics)', async () => {
    // Origin without mid, local machineId undefined: same hostname = same machine.
    const origin = encodeOrigin({ p: 'claude', id: fullId, name: 'alpha' }, 'yang');
    let envelope = '';
    const deps = remoteDeps({ hostname: 'yang', deliverClaude: (c) => { envelope = c; } });
    const out = await runSend({ to: 'boss', bodyArg: 'x', origin }, deps);
    expect(out).not.toContain('⚠');
    expect(envelope).not.toContain('--via ssh:');
  });

  it('auto-complete fills --via for a same-hostname ref whose mid differs', async () => {
    sshCalls.length = 0;
    const ref = encodeRef({
      v: 1,
      f: { p: 'claude', id: 'boss', m: 'yang', mid: 'M-OTHER' },
      t: { p: 'codex', id: '01a1115b-1a3c-7e71-addc-fee969078e1b', m: 'yang', mid: 'M-HERE' },
      n: '9d4f2ab1c3e85760',
      c: 1,
    });
    const deps = makeDeps();
    (deps as { machineId?: () => string | undefined }).machineId = () => 'M-HERE';
    sshResult = { code: 0, stdout: '', stderr: '' };
    await runSend({ conversation: ref, bodyArg: 'x' }, deps).catch(() => undefined);
    expect(sshCalls).toHaveLength(1);
    expect(sshCalls[0]!.argv).toContain('yang');
  });

  it('origin payload round-trips the mid; legacy payloads decode without one', () => {
    const enc = encodeOrigin({ p: 'claude', id: fullId, name: '领 导' }, 'win-dev', 'M-GUID-1');
    const dec = decodeOriginIdentity(enc);
    expect(dec).toEqual({ p: 'claude', id: fullId, name: '领 导', host: 'win-dev', mid: 'M-GUID-1' });
    const legacy = decodeOriginIdentity(encodeOrigin({ p: 'codex', id: '01a1115b-1a3c-7e71-addc-fee969078e1b' }, 'build01'));
    expect(legacy).toEqual({ p: 'codex', id: '01a1115b-1a3c-7e71-addc-fee969078e1b', host: 'build01' });
  });
});
