#!/usr/bin/env node
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createAppToolsStdio } from '../../dist/codex/app-tools-stdio.js';
import { sendViaDesktopAppTools } from '../../dist/integrations/codex-desktop-native.js';

const help = `crosschat native Desktop host integration

node integrations/codex-desktop-native/bridge.mjs --to <name-or-id> --tool codex-desktop --delivery steer --body <text>
Use --body-file <UTF-8 path> instead of --body for multiline text.

This entry needs a host that handles its JSONL tool-request frames through the
official Codex app MCP tools and returns the unmodified results on stdin.
It does not directly send to a named pipe or answer approvals. The only supported
route is local Desktop steer. A timeout after a send request is uncertain: do not
rerun the message. See skills/crosschat/references/codex-desktop-native.md.
`;

let bridge;
try {
  const { values } = parseArgs({ args: process.argv.slice(2), options: {
    to: { type: 'string' }, tool: { type: 'string' }, delivery: { type: 'string' },
    body: { type: 'string' }, 'body-file': { type: 'string' }, help: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  if (values.help) process.stdout.write(help);
  else {
    if ((values.body === undefined) === (values['body-file'] === undefined)) throw new Error('Supply exactly one of --body or --body-file.');
    const body = values.body ?? await readFile(values['body-file'], 'utf8');
    bridge = createAppToolsStdio({ input: process.stdin, output: process.stdout });
    const result = await sendViaDesktopAppTools({ to: values.to, tool: values.tool, delivery: values.delivery, bodyArg: body }, {
      invoke: bridge.invoke, env: process.env,
    });
    process.stdout.write(JSON.stringify({ type: 'completed', result }) + '\n');
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ type: 'failed', code: error?.code ?? 'CODEX_APP_TOOLS_BRIDGE_ERROR', message: error instanceof Error ? error.message : 'Native bridge failed.' }) + '\n');
  process.exitCode = 1;
} finally {
  bridge?.close();
  process.stdin.pause();
}
