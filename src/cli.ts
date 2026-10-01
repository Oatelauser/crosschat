#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';

const version: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const usage = `usage: multichat <command> [options]

commands:
  send <agent> <message>   send a message to an agent        (not implemented in B0)
  status                   show adapter/link status          (not implemented in B0)
  install-skills           install agent-side skills         (not implemented in B0)
  claude                   claude adapter helpers            (not implemented in B0)

options:
  -v, --version            print version and exit
  --help | help            show this help and exit
`;

const knownCommands = new Set(['send', 'status', 'install-skills', 'claude']);

const arg = process.argv[2] ?? '';

if (arg === '--version' || arg === '-v') {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

if (arg === 'help' || arg === '--help') {
  process.stdout.write(usage);
  process.exit(0);
}

if (arg === '') {
  process.stderr.write(usage);
  process.exit(1);
}

if (!knownCommands.has(arg)) {
  process.stderr.write(`unknown command: ${arg}\n\n`);
  process.stderr.write(usage);
  process.exit(1);
}

process.stderr.write(`${arg}: not implemented in B0\n`);
process.exit(1);
