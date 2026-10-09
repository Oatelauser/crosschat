#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { MultichatError } from './errors.js';
import { runSend, type SendArgs, type SendDeps } from './commands/send.js';
import { runStatus, type StatusDeps } from './commands/status.js';
import { runInstallSkills, type InstallSkillsArgs } from './commands/install-skills.js';
import { runDoctor } from './commands/doctor.js';
import { runClaudeWrapper } from './commands/claude-wrapper.js';
import { runCodexWrapper } from './commands/codex-wrapper.js';
import { defaultRateDir } from './rate-limit.js';
import { defaultOutboxDir, drain } from './outbox.js';
import { runWatchdog, spawnWatchdog as ensureWatchdog } from './watchdog.js';
import { appendSendLog, confirmInRollout, defaultSendLogFile } from './send-log.js';
import { defaultConversationsFile } from './conversations.js';
import { defaultSshExec } from './federation.js';
import { machineId } from './platform/machine-id.js';
import { conversationSummaries } from './conversation-summary.js';
import { codexHomeDir, listWriterLocks } from './codex/rollout-meta.js';
import { listClaudeSessions } from './claude/registry.js';
import { deliverToClaudeSession } from './claude/deliver.js';
import { listCodexThreads } from './codex/discovery.js';
import { deliverToCodexThread } from './codex/deliver.js';

const version: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const usage = `usage: crosschat <command> [options]

commands:
  send [--via ssh:<host>] --to <name> | --conversation <ref>
                            send a message (--body <text> or stdin);
                            quote <name> if it contains spaces;
                            --via sends to a peer machine (host = ~/.ssh/config
                            alias, peer resolves names on its side);
                            --max-body-kb <KiB> raises the body cap for this
                            send (default 16; env CROSSCHAT_MAX_BODY_KIB);
                            --max-turn <N> stamps a soft turn budget into
                            the envelope (env CROSSCHAT_MAX_TURN)
  status [--conversations]   show claude/codex session status, or per-pair
                            conversation overview with --conversations
  doctor                    environment health check (exits 1 on any ❌)
  install-skills [--dir <root>]
                            install the agent skill into <root>/.claude and
                            <root>/.codex (default root: home directory)
  claude [args...]          run the real claude CLI with inbound peer
                            messaging enabled; --max-body-kb/--max-turn <N>
                            preset the session's send caps via env;
                            other args pass through
  codex [args...]           run the real codex CLI with the same crosschat
                            knobs via env (no codex settings injected);
                            other args pass through

options:
  --json                    single-line JSON output (send/status)
  -v, --version             print version and exit
  --help | help             show this help and exit
`;

/** Hand-rolled send arg parsing (no dependency): --to/--conversation/--body/--via/--origin/--max-body-kb/--max-turn take values, --json is a flag. --origin is machine-injected (008) and stays out of usage. Raw values only — numeric validation lives in limits.ts (invalid silently degrades, ticket A). */
export function parseSendArgs(argv: readonly string[]): SendArgs {
  const args: SendArgs = {};
  const valueOpts = new Set(['--to', '--conversation', '--body', '--via', '--origin', '--max-body-kb', '--max-turn']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) {
      throw new MultichatError('USAGE', `send: unexpected argument: ${token ?? ''}`);
    }
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (name === '--json') {
      if (inline !== undefined) throw new MultichatError('USAGE', 'send: --json takes no value');
      args.json = true;
      continue;
    }
    if (!valueOpts.has(name)) throw new MultichatError('USAGE', `send: unknown option: ${name}`);
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined) throw new MultichatError('USAGE', `send: ${name} requires a value`);
    if (name === '--to') args.to = value;
    else if (name === '--conversation') args.conversation = value;
    else if (name === '--via') args.via = value;
    else if (name === '--origin') args.origin = value;
    else if (name === '--max-body-kb') args.maxBodyKb = value;
    else if (name === '--max-turn') args.maxTurn = value;
    else args.bodyArg = value;
  }
  return args;
}

/** status accepts only --json and --conversations (each at most once). */
export function parseStatusArgs(argv: readonly string[]): { json: boolean; conversations: boolean } {
  let json = false;
  let conversations = false;
  for (const token of argv) {
    if (token === '--json' && !json) json = true;
    else if (token === '--conversations' && !conversations) conversations = true;
    else {
      throw new MultichatError('USAGE', `status takes only --json/--conversations; got: ${argv.join(' ')}`);
    }
  }
  return { json, conversations };
}

/** install-skills accepts only --dir <root> (space or = separated). */
export function parseInstallSkillsArgs(argv: readonly string[]): InstallSkillsArgs {
  const args: InstallSkillsArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) {
      throw new MultichatError('USAGE', `install-skills: unexpected argument: ${token ?? ''}`);
    }
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (name !== '--dir') throw new MultichatError('USAGE', `install-skills: unknown option: ${name}`);
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined) throw new MultichatError('USAGE', 'install-skills: --dir requires a value');
    args.dir = value;
  }
  return args;
}

function readStdinText(): Promise<string | undefined> {
  const stdin = process.stdin;
  if (stdin.isTTY) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || undefined));
    stdin.on('error', reject);
  });
}

function realSendDeps(stdinText: string | undefined): SendDeps {
  return {
    env: process.env,
    stdinText,
    listClaudeSessions: () => listClaudeSessions(),
    listCodexThreads: () => listCodexThreads(),
    deliverClaude: (target, content) => deliverToClaudeSession(target, content),
    deliverCodex: (threadId, content) => deliverToCodexThread(threadId, content),
    rateDir: defaultRateDir(),
    outboxDir: defaultOutboxDir(),
    now: () => Date.now(),
    spawnWatchdog: () => ensureWatchdog(defaultOutboxDir()),
    appendLog: (entry) => appendSendLog(defaultSendLogFile(), entry),
    confirmReceipt: (threadId, marker) => confirmInRollout(codexHomeDir(), threadId, marker),
    conversationStateFile: defaultConversationsFile(),
    // Federation (008/B1): real transport + machine name for --origin.
    sshExec: (argv, input, timeoutMs) => defaultSshExec(argv, input, timeoutMs),
    // B10: stable per-install id — same-machine decisions survive hostname collisions.
    machineId: () => machineId(),
  };
}

function realStatusDeps(): StatusDeps {
  return {
    listClaudeSessions: () => listClaudeSessions(),
    listCodexThreads: () => listCodexThreads(),
    // 006: TUI occupancy markers come straight from the filesystem.
    listWriterLocks: () => listWriterLocks(codexHomeDir()),
    listConversations: () => conversationSummaries(),
    // B22: bounded recheck budget (2 polls × 200ms per unconfirmed row) so the
    // conversations view stays snappy while catching slow rollout flushes.
    confirmReceipt: (threadId, marker) =>
      confirmInRollout(codexHomeDir(), threadId, marker, { tries: 2, delayMs: 200 }),
  };
}

function drainAtEntry(): Promise<void> {
  return drainOutboxAtEntry({
    outboxDir: defaultOutboxDir(),
    rateDir: defaultRateDir(),
    deliverCodex: (threadId, content, busyTimeoutMs) =>
      deliverToCodexThread(threadId, content, { busyTimeoutMs }),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}

function printFailure(err: unknown): number {
  const me =
    err instanceof MultichatError
      ? err
      : new MultichatError('INTERNAL', err instanceof Error ? err.message : String(err), { cause: err });
  process.stderr.write(`crosschat: ${me.code}: ${me.message}\n`);
  return 1;
}

export interface DrainEntryDeps {
  outboxDir: string;
  /** Rate-limit dir shared with send: drained re-deliveries consume the same per-pair window. */
  rateDir: string;
  deliverCodex(threadId: string, content: string, busyTimeoutMs: number): Promise<unknown>;
  err(line: string): void;
}

/**
 * Opportunistic outbox drain at command entry (send/status only): re-deliver
 * parked messages with a short busy wait under the B11 round budget, one
 * stderr line per thread that got relief, and one dead-letter line for a
 * thread that no longer exists; silent when nothing was parked or nothing
 * went through. Drain failures never fail the invoking command.
 */
export async function drainOutboxAtEntry(deps: DrainEntryDeps): Promise<void> {
  let results;
  try {
    results = await drain(
      deps.outboxDir,
      (threadId, content, busyTimeoutMs) => deps.deliverCodex(threadId, content, busyTimeoutMs),
      { rateDir: deps.rateDir },
    );
  } catch {
    return; // opportunistic: the real command still runs
  }
  for (const result of results) {
    if (result.delivered > 0) deps.err(`outbox: 补投 ${result.delivered} 条给 ${result.toName}`);
    if (result.dropped > 0) {
      deps.err(`outbox: 线程 ${result.threadId} 已不存在，丢弃 ${result.dropped} 条暂存消息`);
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '') {
    process.stderr.write(usage);
    return 1;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  if (command === 'help' || command === '--help') {
    process.stdout.write(usage);
    return 0;
  }
  // Hidden maintenance entry (B12): one drain round by hand, or the watchdog
  // loop when spawned with --watch. Not in usage on purpose.
  if (command === '__drain') {
    if (rest.includes('--watch')) {
      await runWatchdog(defaultOutboxDir(), defaultRateDir(), {
        deliverCodex: (threadId, content, busyTimeoutMs) =>
          deliverToCodexThread(threadId, content, { busyTimeoutMs }),
        err: (line) => process.stderr.write(`${line}\n`),
      });
    } else {
      await drainAtEntry();
    }
    return 0;
  }
  if (command === 'send') {
    if (rest.includes('--help')) {
      process.stdout.write(usage);
      return 0;
    }
    try {
      const args = parseSendArgs(rest);
      await drainAtEntry();
      // Only read stdin when --body is absent: agent harnesses often leave the
      // stdin pipe open forever, and blocking on it with --body given would hang.
      const stdinText = args.bodyArg === undefined ? await readStdinText() : undefined;
      const output = await runSend(args, realSendDeps(stdinText));
      process.stdout.write(`${output}\n`);
      return 0;
    } catch (err) {
      return printFailure(err);
    }
  }
  if (command === 'status') {
    if (rest.includes('--help')) {
      process.stdout.write(usage);
      return 0;
    }
    try {
      const { json, conversations } = parseStatusArgs(rest);
      await drainAtEntry();
      const output = await runStatus(realStatusDeps(), json, conversations);
      process.stdout.write(`${output}\n`);
      return 0;
    } catch (err) {
      return printFailure(err);
    }
  }
  if (command === 'doctor') {
    if (rest.includes('--help')) {
      process.stdout.write(usage);
      return 0;
    }
    if (rest.length > 0) {
      process.stderr.write(`crosschat: USAGE: doctor takes no options; got: ${rest.join(' ')}\n\n`);
      process.stderr.write(usage);
      return 1;
    }
    const report = runDoctor();
    process.stdout.write(`${report.output}\n`);
    return report.failed ? 1 : 0;
  }
  if (command === 'install-skills') {
    if (rest.includes('--help')) {
      process.stdout.write(usage);
      return 0;
    }
    try {
      const args = parseInstallSkillsArgs(rest);
      for (const path of runInstallSkills(args)) process.stdout.write(`installed: ${path}\n`);
      return 0;
    } catch (err) {
      return printFailure(err);
    }
  }
  if (command === 'claude') {
    // Everything passes through to the real claude CLI (including --help).
    try {
      return await runClaudeWrapper(rest);
    } catch (err) {
      return printFailure(err);
    }
  }
  if (command === 'codex') {
    // Everything passes through to the real codex CLI (including --help).
    try {
      return await runCodexWrapper(rest);
    } catch (err) {
      return printFailure(err);
    }
  }
  process.stderr.write(`crosschat: USAGE: unknown command: ${command}\n\n`);
  process.stderr.write(usage);
  return 1;
}

function isDirectRun(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
