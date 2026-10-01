#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { MultichatError } from './errors.js';
import { runSend, type SendArgs, type SendDeps } from './commands/send.js';
import { runStatus, type StatusDeps } from './commands/status.js';
import { defaultRateDir } from './rate-limit.js';
import { listClaudeSessions } from './claude/registry.js';
import { deliverToClaudeSession } from './claude/deliver.js';
import { listCodexThreads } from './codex/discovery.js';
import { deliverToCodexThread } from './codex/deliver.js';

const version: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const usage = `usage: multichat <command> [options]

commands:
  send --to <name> | --conversation <ref>
                            send a message (--body <text> or stdin)
  status                    show claude/codex session status
  install-skills            install agent-side skills         (not implemented yet)
  claude                    claude adapter helpers            (not implemented yet)

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
    now: () => Date.now(),
  };
}

function realStatusDeps(): StatusDeps {
  return {
    listClaudeSessions: () => listClaudeSessions(),
    listCodexThreads: () => listCodexThreads(),
  };
}

function printFailure(err: unknown): number {
  const me =
    err instanceof MultichatError
      ? err
      : new MultichatError('INTERNAL', err instanceof Error ? err.message : String(err), { cause: err });
  process.stderr.write(`multichat: ${me.code}: ${me.message}\n`);
  return 1;
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
      const output = await runStatus(realStatusDeps(), json);
      process.stdout.write(`${output}\n`);
      return 0;
    } catch (err) {
      return printFailure(err);
    }
  }
  if (command === 'install-skills' || command === 'claude') {
    process.stderr.write(`multichat: NOT_IMPLEMENTED: ${command} is not implemented yet (planned for B4).\n`);
    return 1;
  }
  process.stderr.write(`multichat: USAGE: unknown command: ${command}\n\n`);
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
