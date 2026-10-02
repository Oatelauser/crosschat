#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { MultichatError } from './errors.js';
import { runSend, type SendArgs, type SendDeps } from './commands/send.js';
import { runStatus, type StatusDeps } from './commands/status.js';
import { runInstallSkills, type InstallSkillsArgs } from './commands/install-skills.js';
import { runClaudeWrapper } from './commands/claude-wrapper.js';
import { defaultRateDir } from './rate-limit.js';
import { defaultOutboxDir, drain } from './outbox.js';
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
  send --to <name> | --conversation <ref>
                            send a message (--body <text> or stdin);
                            quote <name> if it contains spaces
  status                    show claude/codex session status
  install-skills [--dir <root>]
                            install the agent skill into <root>/.claude and
                            <root>/.codex (default root: home directory)
  claude [args...]          run the real claude CLI with inbound peer
                            messaging enabled; other args pass through

options:
  --json                    single-line JSON output (send/status)
  -v, --version             print version and exit
  --help | help             show this help and exit
`;

/** Hand-rolled send arg parsing (no dependency): --to/--conversation/--body take values, --json is a flag. */
export function parseSendArgs(argv: readonly string[]): SendArgs {
  const args: SendArgs = {};
  const valueOpts = new Set(['--to', '--conversation', '--body']);
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
    else args.bodyArg = value;
  }
  return args;
}

/** status accepts no options except --json. */
export function parseStatusArgs(argv: readonly string[]): { json: boolean } {
  if (argv.length === 0) return { json: false };
  if (argv.length === 1 && argv[0] === '--json') return { json: true };
  throw new MultichatError('USAGE', `status takes only --json; got: ${argv.join(' ')}`);
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
  };
}

function realStatusDeps(): StatusDeps {
  return {
    listClaudeSessions: () => listClaudeSessions(),
    listCodexThreads: () => listCodexThreads(),
  };
}

function drainAtEntry(): Promise<void> {
  return drainOutboxAtEntry({
    outboxDir: defaultOutboxDir(),
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
  deliverCodex(threadId: string, content: string, busyTimeoutMs: number): Promise<unknown>;
  err(line: string): void;
}

/**
 * Opportunistic outbox drain at command entry (send/status only): re-deliver
 * parked messages with a short busy wait, one stderr line per thread that got
 * relief; silent when nothing was parked or nothing went through. Drain
 * failures never fail the invoking command.
 */
export async function drainOutboxAtEntry(deps: DrainEntryDeps): Promise<void> {
  let results;
  try {
    results = await drain(deps.outboxDir, (threadId, content, busyTimeoutMs) =>
      deps.deliverCodex(threadId, content, busyTimeoutMs),
    );
  } catch {
    return; // opportunistic: the real command still runs
  }
  for (const result of results) {
    if (result.delivered > 0) deps.err(`outbox: 补投 ${result.delivered} 条给 ${result.toName}`);
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
      const { json } = parseStatusArgs(rest);
      await drainAtEntry();
      const output = await runStatus(realStatusDeps(), json);
      process.stdout.write(`${output}\n`);
      return 0;
    } catch (err) {
      return printFailure(err);
    }
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
