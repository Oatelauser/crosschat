import { spawn } from 'node:child_process';
import { hostname as osHostname } from 'node:os';
import { Buffer } from 'node:buffer';
import { MultichatError } from './errors.js';
import { recordConversation } from './conversations.js';
import { decodeRef } from './ref.js';
import type { SendLogEntry } from './send-log.js';
import {
  identityKey,
  resolveCallerIdentity,
  type CallerIdentity,
} from './identity.js';
import type { ClaudeRegistryScan } from './claude/registry.js';
import type { SendArgs, SendDeps } from './commands/send.js';

/**
 * Federation v1 (ticket 008, batch B1): `--via ssh:<host>` turns the local
 * send into `ssh <host> crosschat send …` — the remote CLI keeps full
 * authority (name resolution, delivery, outbox, its own send-log). The body
 * always travels on stdin so no shell-quoting matrix can touch it; every
 * flag value that enters the remote argv is charset-checked instead
 * (design §2: keep dangerous characters out of argv, don't escape them).
 * `--origin` carries the sender's identity over the ssh shell that has no
 * agent env (design D5: without it the remote caller collapses to human and
 * the conversation becomes unreplyable).
 */

/** Result of one ssh execution; `timedOut` marks a local kill. */
export interface SshResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export function parseViaValue(value: string): { transport: 'ssh'; host: string } {
  const idx = value.indexOf(':');
  const usage = new MultichatError(
    'USAGE',
    `--via expects <transport>:<host>, e.g. ssh:build01（host 为 ~/.ssh/config 里的 Host 别名）`,
  );
  if (idx <= 0) throw usage;
  const transport = value.slice(0, idx);
  const host = value.slice(idx + 1);
  if (transport !== 'ssh') {
    const note =
      transport === 'tcp' || transport === 'broker'
        ? `${transport}: 传输二期支持，当前仅 ssh`
        : `未知传输 ${transport}，当前仅支持 ssh:`;
    throw new MultichatError('USAGE', `--via ${note}`);
  }
  // Injection guard (design §2): the host reaches the ssh command line, so it
  // is limited to alias-safe characters — spaces and cmd metachars are out.
  if (!/^[A-Za-z0-9._-]+$/.test(host)) {
    throw new MultichatError(
      'USAGE',
      `--via ssh: host 别名仅限字母/数字/./_/-(防命令行注入)，收到: ${host}`,
    );
  }
  return { transport: 'ssh', host };
}

/** Values that will become part of the remote command line (design §2 whitelist). */
export function validateRemoteFlagValues(args: SendArgs): void {
  if (args.to !== undefined) {
    // No whitespace, no cmd/PowerShell metachars, no leading dash. Names with
    // spaces stay single-machine; cross-machine addressing uses id8/ref.
    if (/[\s&|<>^%"']/.test(args.to) || args.to.startsWith('-')) {
      throw new MultichatError(
        'USAGE',
        `跨机 --to 值不能含空格或特殊字符（${args.to}）——请改用 id8 或 --conversation 寻址`,
      );
    }
  }
  if (args.conversation !== undefined && !/^mc[12]_[A-Za-z0-9_-]+$/.test(args.conversation)) {
    throw new MultichatError('USAGE', `跨机 --conversation 值非法: ${args.conversation}`);
  }
}

/** `<p>/<名或id8>@<hostname>`, base64url-whole — display names may contain spaces/unicode (F1). */
export function encodeOrigin(identity: CallerIdentity, host: string): string {
  const who =
    identity.p === 'claude'
      ? `claude/${identity.name ?? identity.id.slice(0, 8)}`
      : identity.p === 'codex'
        ? `codex/${identity.id.slice(0, 8)}`
        : 'human';
  return Buffer.from(`${who}@${host}`, 'utf8').toString('base64url');
}

/** Remote-side identity fallback for ssh shells without agent env (design D5). */
export function decodeOriginIdentity(encoded: string): CallerIdentity {
  let text: string;
  try {
    text = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    throw new MultichatError('USAGE', '--origin 不是合法的 base64url');
  }
  const at = text.lastIndexOf('@');
  if (at <= 0) throw new MultichatError('USAGE', `--origin 格式非法: ${text}`);
  const head = text.slice(0, at);
  const slash = head.indexOf('/');
  if (slash <= 0) {
    if (head === 'human') return { p: 'human' };
    throw new MultichatError('USAGE', `--origin 格式非法: ${text}`);
  }
  const p = head.slice(0, slash);
  const nameOrId = head.slice(slash + 1);
  if (nameOrId === '') throw new MultichatError('USAGE', `--origin 格式非法: ${text}`);
  if (p === 'claude') return { p: 'claude', id: nameOrId, name: nameOrId };
  if (p === 'codex') return { p: 'codex', id: nameOrId };
  throw new MultichatError('USAGE', `--origin 端点类型非法: ${p}`);
}

/** The exact remote command (fixed face, design D2 — configurable = injectable). */
export function buildSshArgv(host: string, args: SendArgs, originB64: string): string[] {
  const target =
    args.to !== undefined
      ? ['--to', args.to]
      : ['--conversation', args.conversation!];
  return [
    'ssh',
    host,
    '-o',
    'BatchMode=yes', // F2: any interactive prompt becomes a fast failure, not a 120s hang
    '-o',
    'ConnectTimeout=10',
    'crosschat',
    'send',
    ...target,
    '--json',
    '--origin',
    originB64,
  ];
}

/** Real transport: spawn ssh, feed the body on stdin, close it (EOF), cap output. */
export function defaultSshExec(argv: readonly string[], input: string, timeoutMs: number): Promise<SshResult> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1) as string[], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (prev: string, chunk: Buffer): string => (prev.length > 262_144 ? prev : prev + chunk.toString('utf8'));
    child.stdout.on('data', (chunk: Buffer) => { stdout = cap(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = cap(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {/* EPIPE: remote exited early; close event carries the code */});
    child.stdin.end(input, 'utf8');
  });
}

interface RemoteReceipt {
  status: 'delivered' | 'queued' | 'parked';
  to: string;
  turn: number;
  replyRef: string;
  queue?: number;
  mailbox?: string;
}

/** Entry point of the via branch — everything federation lives behind this (D9). */
export async function runViaSend(args: SendArgs, body: string, deps: SendDeps): Promise<string> {
  const { host } = parseViaValue(args.via!);
  validateRemoteFlagValues(args);

  const scan: ClaudeRegistryScan = deps.listClaudeSessions();
  const caller = resolveCallerIdentity(deps.env, scan);
  const origin = encodeOrigin(caller, deps.hostname?.() ?? osHostname());
  const argv = buildSshArgv(host, args, origin);
  const envTimeout = Number(deps.env.CROSSCHAT_SSH_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 120_000;

  const fromName = originDisplayName(caller);
  const logNow = (fields: Omit<SendLogEntry, 'ts'>): void => {
    deps.appendLog?.({ ...fields, ts: new Date(deps.now()).toISOString() });
  };

  const res = await (deps.sshExec ?? defaultSshExec)(argv, body, timeoutMs);

  if (res.timedOut || res.code === null) {
    logNow({ from: identityKey(caller), fromName, to: `${args.to ?? args.conversation}@${host}`, target: `via:${host}`, status: 'failed', code: 'SSH_TRANSPORT_TIMEOUT' });
    throw new MultichatError(
      'SSH_TRANSPORT_TIMEOUT',
      `本地等待 ${Math.round(timeoutMs / 1000)}s 超时，远端状态不明——勿盲目重发（可能与首次投递叠加）。先在对端查 send-log 或 status --conversations 核实后再决定。`,
    );
  }
  if (res.code === 255) {
    logNow({ from: identityKey(caller), fromName, to: `${args.to ?? args.conversation}@${host}`, target: `via:${host}`, status: 'failed', code: 'SSH_TRANSPORT_FAILED' });
    throw new MultichatError(
      'SSH_TRANSPORT_FAILED',
      `ssh 无法到达 ${host}（不通/密钥/known_hosts）。自证: ssh ${host} crosschat --version（顺带核对版本）；检查 ~/.ssh/config 与网络。`,
    );
  }
  if (res.code !== 0) {
    // Remote business error: rethrow the SAME code so self-correction guidance
    // (MESSAGE_TOO_LARGE etc.) stays verbatim (D3); prefix marks the hop.
    const m = res.stderr.match(/crosschat: ([A-Z_]+): (.+)/);
    const err =
      m !== null
        ? new MultichatError(m[1]!, `[via ${host}] ${m[2]}`)
        : new MultichatError('REMOTE_FAILED', `[via ${host}] 远端异常退出(${res.code}): ${res.stderr.slice(-400)}`);
    logNow({ from: identityKey(caller), fromName, to: `${args.to ?? args.conversation}@${host}`, target: `via:${host}`, status: 'failed', code: err.code });
    throw err;
  }

  let receipt: RemoteReceipt;
  try {
    receipt = JSON.parse(res.stdout.trim()) as RemoteReceipt;
  } catch {
    logNow({ from: identityKey(caller), fromName, to: `${args.to ?? args.conversation}@${host}`, target: `via:${host}`, status: 'failed', code: 'REMOTE_FAILED' });
    throw new MultichatError('REMOTE_FAILED', `[via ${host}] 远端回执不是 JSON: ${res.stdout.slice(0, 200)}`);
  }

  const displayTo = `${receipt.to}@${host}`;
  logNow({
    from: identityKey(caller),
    fromName,
    to: displayTo,
    target: `via:${host}`,
    status: receipt.status,
    turn: receipt.turn,
    replyRef: receipt.replyRef,
  });
  // Own-side pair continuity: the remote issued the ref, recording it locally
  // makes the cross-machine pair show up in `status --conversations` (patch B).
  if (deps.conversationStateFile !== undefined) {
    try {
      recordConversation(deps.conversationStateFile, decodeRef(receipt.replyRef), deps.now());
    } catch {
      // a non-decodable ref must never fail the already-delivered send
    }
  }
  if (args.json === true) {
    return JSON.stringify({ ...receipt, via: `ssh:${host}` });
  }
  if (receipt.status === 'parked') {
    return [
      `已寄存给 ${displayTo}（对方忙，未送达）。队列共 ${receipt.queue ?? 1} 条，看门狗每 0.5–5 分钟自动重试，无需手动 status。`,
      `人工随时可读滞留内容: ${receipt.mailbox ?? ''}（位于 ${host}）`,
      `reply-ref: ${receipt.replyRef}`,
    ].join('\n');
  }
  if (receipt.status === 'queued') {
    return `queued to ${displayTo} (turn ${receipt.turn}; 对方正忙，已入队，本轮结束即处理)\nreply-ref: ${receipt.replyRef}`;
  }
  return `delivered to ${displayTo} (turn ${receipt.turn})\nreply-ref: ${receipt.replyRef}`;
}

function originDisplayName(identity: CallerIdentity): string {
  if (identity.p === 'claude') return identity.name ?? `claude/${identity.id.slice(0, 8)}`;
  if (identity.p === 'codex') return `codex/${identity.id.slice(0, 8)}`;
  return 'human';
}
