import assert from 'node:assert/strict';
import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { runTui } from '../../dist/tui/main.js';

const home = process.env.NATIVE_RENAME_TUI_HOME;
const evidence = process.env.NATIVE_RENAME_TUI_EVIDENCE;
assert(home && evidence, 'Explicit isolated paths are required');
const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((key) => [key, process.listenerCount(key)]));
const warmup = render(createElement(Text, null, 'Native rename fixture'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const snapshot = () => ({ raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') });
const before = snapshot();
const code = await runTui({ home, contexts: [{ id: 'local', kind: 'local', label: 'NATIVE-RENAME-TUI', target: 'isolated' }] });
await writeFile(evidence, JSON.stringify({ code, before, after: snapshot() }));
process.exitCode = code;
