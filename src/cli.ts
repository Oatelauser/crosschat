#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { MultichatError } from './errors.js';
import { runSend, type SendArgs, type SendDeps } from './commands/send.js';
import { runStatus, type StatusDeps, type StatusFilters } from './commands/status.js';
import { runInstallSkills, type InstallSkillsArgs } from './commands/install-skills.js';
import { runDoctor } from './commands/doctor.js';
import { runClaudeWrapper } from './commands/claude-wrapper.js';
import { runCodexWrapper } from './commands/codex-wrapper.js';
import { defaultOutboxDir, drain } from './outbox.js';
import { legacyStateRoots, stateRoot } from './state-root.js';
import { runWatchdog, spawnWatchdog as ensureWatchdog } from './watchdog.js';
import { appendSendLog, confirmInRollout, defaultSendLogFile, readSendLogTail } from './send-log.js';
import { defaultConversationsFile } from './conversations.js';
import { defaultSshExec } from './federation.js';
import { machineId } from './platform/machine-id.js';
import { conversationSummaries } from './conversation-summary.js';
import { codexHomeDir, listWriterLocks } from './codex/rollout-meta.js';
import { listClaudeSessions } from './claude/registry.js';
import { deliverToClaudeSession } from './claude/deliver.js';
import { listCodexThreads } from './codex/discovery.js';
import { deliverToCodexThread } from './codex/deliver.js';
import { runServe, realServeDeps, type ServeArgs } from './commands/serve.js';
import { runClean, type CleanArgs } from './commands/clean.js';
import { runUninstall, type UninstallArgs } from './commands/uninstall.js';
import { fetchRosterFor, runViaTcpStatus } from './serve/via-tcp.js';
import { DEFAULT_PORT } from './serve/broker.js';

const version: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const usage = `usage: crosschat <command> [options]

commands:
  send --to <name> | --conversation <ref>
                            send a message to a claude/codex session
                            (quote <name> if it contains spaces);
                            options:
                              --body <text>        message text
                                (default: read stdin)
                              --via ssh:<host>     send to a peer machine
                                (host = ~/.ssh/config alias, peer
                                resolves names on its side)
                              --via tcp:<机器>     send via the tcp broker
                                (机器 = machine name from
                                "crosschat serve --list"; requires
                                ~/.crosschat/tcp/node.json)
                              --file <路径>        send a file through the
                                tcp channel (with --via tcp: only,
                                chunked, 64MiB cap; body defaults to
                                "文件 <名> 已送达：<对端路径>")
                              --max-body-kb <KiB>  raise the body cap for
                                this send (default 16;
                                env CROSSCHAT_MAX_BODY_KIB)
                              --max-turn <N>       stamp a soft turn budget
                                into the envelope
                                (env CROSSCHAT_MAX_TURN)
  status [--conversations]  show claude/codex session status, or per-pair
                            conversation overview with --conversations
                              --claude | --codex    pick one main-view section
                                (mutually exclusive, not with --conversations)
                              --name <substr>       filter rows by display name
                                (case-insensitive)
                              --via tcp|ssh         with --conversations only:
                                filter pairs by cross-machine transport
                              --via tcp:<机器>      main view only: enumerate
                                sessions on a remote machine (same
                                filters; ssh peers: ssh <host>
                                crosschat status)
                              --all                 also list unnamed sessions
                                (hidden by default in the main view)
  doctor                    environment health check (exits 1 on any ❌)
  serve [options]           run/manage the tcp broker (star topology,
                            default port ${DEFAULT_PORT}; the first --port
                            given is remembered and reused on bare runs)
                              --port <N>           listen port 1-65535
                              --name <星名>        broker star name
                                (1-32 chars of A-Za-z0-9._-,
                                no colon; the first --name given
                                is remembered; default: hostname)
                              --gen-key [N]        print N node keys (default 1)
                                and register them
                              --list               list registered nodes
                              --remove <label>     remove a node key
                              --connect [星名|星前缀]
                                run this machine as a node client
                                (needs ~/.crosschat/tcp/node.json;
                                selector picks the broker entry;
                                reconnects forever; log with --detach:
                                ~/.crosschat/tcp/node.log or
                                node-<星名>.log)
                              --detach             run the broker or node
                                (with --connect) in the background
                              --stop [broker|node|选择器]
                                stop a running broker/node; a
                                selector stops only that node
                                daemon (default: all nodes, then
                                the broker)
  install-skills [--dir <root>]
                            install the agent skill into <root>/.claude and
                            <root>/.codex (default root: home directory)
  clean [--force]           clean tcp file-channel leftovers (inbox/parts)
                            and 30-day-stale conversation shards: default =
                            lazy rules (items older than 5 days, or inbox
                            over 512MiB oldest-first; shards untouched for
                            30 days); --force deletes everything without
                            confirmation
  uninstall [--yes]         remove crosschat data: ~/.crosschat (state
                            included), pre-014 legacy state dirs, and both
                            agent skills (refuses while "crosschat serve"
                            runs; asks y/n unless --yes)
  claude [any native args]  start the real claude CLI with inbound peer
                            messaging enabled; any native claude args
                            (e.g. -c, --model <m>, --help) pass through
                            unchanged, plus two crosschat-only knobs:
                              --max-body-kb <KiB>  body cap for sends
                                from this session
                                (env CROSSCHAT_MAX_BODY_KIB)
                              --max-turn <N>       turn budget stamped
                                into envelopes
                                (env CROSSCHAT_MAX_TURN)
  codex [any native args]   start the real codex CLI (no codex settings
                            injected); any native codex args (e.g.
                            resume, --profile, --help) pass through
                            unchanged, plus the same two knobs:
                              --max-body-kb <KiB>  body cap for sends
                                from this session
                              --max-turn <N>       turn budget stamped
                                into envelopes

options:
  --json                    single-line JSON output (send/status)
  -v, --version             print version and exit
  --help | help             show this help and exit
`;

/** Hand-rolled send arg parsing (no dependency): --to/--conversation/--body/--via/--file/--origin/--max-body-kb/--max-turn take values, --json is a flag. --origin is machine-injected (008) and stays out of usage. Raw values only — numeric validation lives in limits.ts (invalid silently degrades, ticket A). */
export function parseSendArgs(argv: readonly string[]): SendArgs {
  const args: SendArgs = {};
  const valueOpts = new Set(['--to', '--conversation', '--body', '--via', '--file', '--origin', '--max-body-kb', '--max-turn']);
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
    else if (name === '--file') args.fileArg = value;
    else if (name === '--origin') args.origin = value;
    else if (name === '--max-body-kb') args.maxBodyKb = value;
    else if (name === '--max-turn') args.maxTurn = value;
    else args.bodyArg = value;
  }
  return args;
}

/**
 * status accepts --json/--conversations/--claude/--codex/--name <v>/--via <v>/--all
 * (flags at most once). Validation: --claude/--codex are mutually exclusive and
 * main-view only; bare --via (tcp|ssh) only combines with --conversations;
 * --via tcp:<机器> (E1) only combines with the main view (remote enumeration).
 * `filters` is absent when no filter flag was given.
 */
export function parseStatusArgs(argv: readonly string[]): {
  json: boolean;
  conversations: boolean;
  filters?: StatusFilters;
  /** E1：`--via tcp:<机器>` 远程枚举目标（原样透传，多星限定器在内）。 */
  viaTarget?: string;
} {
  let json = false;
  let conversations = false;
  let section: 'claude' | 'codex' | undefined;
  let name: string | undefined;
  let via: 'tcp' | 'ssh' | undefined;
  let viaTarget: string | undefined;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (token === '--json' && !json) json = true;
    else if (token === '--conversations' && !conversations) conversations = true;
    else if (token === '--claude' && section === undefined) section = 'claude';
    else if (token === '--codex' && section === undefined) section = 'codex';
    else if (token === '--all' && !all) all = true;
    else if (token === '--name' || token.startsWith('--name=')) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new MultichatError('USAGE', 'status: --name requires a value');
      name = value;
    } else if (token === '--via' || token.startsWith('--via=')) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new MultichatError('USAGE', 'status: --via requires a value (tcp, ssh, or tcp:<machine>)');
      if (value.startsWith('tcp:')) viaTarget = value;
      else if (value === 'tcp' || value === 'ssh') via = value;
      else if (value.startsWith('ssh:')) {
        throw new MultichatError('USAGE', 'status: 远程查会话只支持 tcp 形态（--via tcp:<机器>）；ssh 形态对端仍用 ssh <对端> crosschat status');
      } else throw new MultichatError('USAGE', 'status: --via 只接受 tcp、ssh 或 tcp:<机器>');
    } else {
      throw new MultichatError(
        'USAGE',
        `status takes only --json/--conversations/--claude/--codex/--name/--via/--all; got: ${argv.join(' ')}`,
      );
    }
  }
  if (section !== undefined && conversations) {
    throw new MultichatError('USAGE', 'status: --claude/--codex 选段不与 --conversations 组合');
  }
  if (via !== undefined && !conversations) {
    throw new MultichatError('USAGE', 'status: --via 仅与 --conversations 组合');
  }
  if (viaTarget !== undefined && via !== undefined) {
    throw new MultichatError('USAGE', 'status: --via 只能给一次（tcp|ssh 过滤或 tcp:<机器> 枚举二选一）');
  }
  if (viaTarget !== undefined && conversations) {
    throw new MultichatError('USAGE', 'status: --via tcp:<机器> 是主视图远程枚举，不与 --conversations 组合');
  }
  const any = section !== undefined || name !== undefined || via !== undefined || all;
  return {
    json,
    conversations,
    ...(any
      ? {
          filters: {
            ...(section !== undefined ? { section } : {}),
            ...(name !== undefined ? { name } : {}),
            ...(via !== undefined ? { via } : {}),
            ...(all ? { all: true } : {}),
          },
        }
      : {}),
    ...(viaTarget !== undefined ? { viaTarget } : {}),
  };
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

/**
 * Hand-rolled serve arg parsing: --port/--remove/--name take values (space or
 * =), --gen-key/--stop/--connect take optional values (a following non-flag
 * token), --list/--detach are flags. Raw values only — numeric/star-name
 * validation lives in commands/serve.ts.
 */
export function parseServeArgs(argv: readonly string[]): ServeArgs {
  const args: ServeArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) {
      throw new MultichatError('USAGE', `serve: unexpected argument: ${token ?? ''}`);
    }
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    const nextValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        i++;
        return next;
      }
      return undefined;
    };
    if (name === '--list') {
      args.list = true;
    } else if (name === '--detach') {
      args.detach = true;
    } else if (name === '--connect') {
      args.connect = nextValue() ?? '';
    } else if (name === '--port' || name === '--remove' || name === '--name') {
      const value = nextValue();
      if (value === undefined) throw new MultichatError('USAGE', `serve: ${name} requires a value`);
      if (name === '--port') args.portArg = value;
      else if (name === '--name') args.nameArg = value;
      else args.remove = value;
    } else if (name === '--gen-key') {
      args.genKeyArg = nextValue() ?? '1';
    } else if (name === '--stop') {
      const value = nextValue();
      if (value === undefined) args.stopTarget = 'both';
      else if (value === 'broker' || value === 'node') args.stopTarget = value;
      else args.stopSelector = value; // B2：其他取值=节点守护选择器
    } else {
      throw new MultichatError('USAGE', `serve: unknown option: ${name}`);
    }
  }
  return args;
}

/** clean takes only the --force flag; uninstall only --yes. */
export function parseCleanArgs(argv: readonly string[]): CleanArgs {
  const args: CleanArgs = {};
  for (const token of argv) {
    if (token === '--force') args.force = true;
    else throw new MultichatError('USAGE', `clean: unknown option: ${token}`);
  }
  return args;
}

export function parseUninstallArgs(argv: readonly string[]): UninstallArgs {
  const args: UninstallArgs = {};
  for (const token of argv) {
    if (token === '--yes') args.yes = true;
    else throw new MultichatError('USAGE', `uninstall: unknown option: ${token}`);
  }
  return args;
}

function readStdinText(): Promise<string | undefined> {  const stdin = process.stdin;
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
    sendLogFile: defaultSendLogFile(),
    outboxDir: defaultOutboxDir(),
    now: () => Date.now(),
    spawnWatchdog: () => ensureWatchdog(defaultOutboxDir()),
    appendLog: (entry) => appendSendLog(defaultSendLogFile(), entry),
    confirmReceipt: (threadId, marker) => confirmInRollout(codexHomeDir(), threadId, marker),
    conversationStateFile: defaultConversationsFile(),
    // Federation (008/B1): real transport + machine name for --origin.
    sshExec: (argv, input, timeoutMs) => defaultSshExec(argv, input, timeoutMs),
    // B2.1：回信自动补全判据（ssh 别名表 + 本机 node.json 在场）。
    sshConfigText: () => {
      try {
        return readFileSync(join(homedir(), '.ssh', 'config'), 'utf8');
      } catch {
        return undefined;
      }
    },
    tcpBaseDir: join(homedir(), '.crosschat'),
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
    // B2: tcp forwarder status files live under ~/.crosschat/tcp.
    tcpDir: join(homedir(), '.crosschat', 'tcp'),
    // B2.1：成员机在线表——有 node.json 才拉（broker 机 status-broker.json 新鲜时不会走到）。
    // B2：可传条目逐星探（缺省=entries[0]，单条目行为与 B2.1 一致）。
    roster: existsSync(join(homedir(), '.crosschat', 'tcp', 'node.json'))
      ? (entry) => fetchRosterFor(join(homedir(), '.crosschat'), entry)
      : undefined,
    // --conversations --via 的传输族判定源（本机 send-log 尾窗）。
    sendLogTail: () => readSendLogTail(defaultSendLogFile()),
    // E1：status --via tcp:<机器> 的远程枚举腿（未入网时 runViaTcpStatus 自带教学）。
    fetchRemoteStatus: (via) =>
      runViaTcpStatus(via, { env: process.env, tcpBaseDir: join(homedir(), '.crosschat'), machineId: () => machineId() }),
  };
}

function drainAtEntry(): Promise<void> {
  return drainOutboxAtEntry({
    outboxDir: defaultOutboxDir(),
    sendLogFile: defaultSendLogFile(),
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
  /** Send-log file shared with send: drained re-deliveries pass the same tail-window limiter. */
  sendLogFile: string;
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
      { sendLogFile: deps.sendLogFile },
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
      await runWatchdog(defaultOutboxDir(), defaultSendLogFile(), {
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
      const { json, conversations, filters, viaTarget } = parseStatusArgs(rest);
      await drainAtEntry();
      const output = await runStatus(realStatusDeps(), json, conversations, filters, viaTarget);
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
  if (command === 'serve') {
    if (rest.includes('--help')) {
      process.stdout.write(usage);
      return 0;
    }
    try {
      // B2：broker/节点的本机投递与 send 命令共用同一份真 SendDeps。
      return await runServe(parseServeArgs(rest), { ...realServeDeps(), makeSendDeps: (stdinText?: string) => realSendDeps(stdinText) });
    } catch (err) {
      return printFailure(err);
    }
  }
  if (command === 'clean') {
    if (rest.includes('--help')) {
      process.stdout.write(usage);
      return 0;
    }
    try {
      return runClean(parseCleanArgs(rest), {
        tcpDir: join(homedir(), '.crosschat', 'tcp'),
        conversationsDir: join(stateRoot(), 'conversations'),
        now: () => Date.now(),
        stdout: (line) => process.stdout.write(`${line}\n`),
      });
    } catch (err) {
      return printFailure(err);
    }
  }
  if (command === 'uninstall') {
    if (rest.includes('--help')) {
      process.stdout.write(usage);
      return 0;
    }
    try {
      const home = homedir();
      return await runUninstall(parseUninstallArgs(rest), {
        crosschatHome: join(home, '.crosschat'),
        stateRoot: stateRoot(),
        legacyStateRoots: legacyStateRoots(),
        skillDirs: [join(home, '.claude', 'skills', 'crosschat'), join(home, '.codex', 'skills', 'crosschat')],
        now: () => Date.now(),
        stdout: (line) => process.stdout.write(`${line}\n`),
        confirm: () =>
          new Promise<boolean>((resolve) => {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            rl.question('确认删除？(y/n) ', (answer) => {
              rl.close();
              resolve(answer.trim().toLowerCase() === 'y');
            });
          }),
      });
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
