// One independent allocator: wait for the shared go file, allocate a short
// handle, then resolve it back to a full ref. Used to run real process
// contention against the conversation-state lock. Prints one JSON line.
import { existsSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { handleForRef, resolveHandle } from '../../dist/conversations.js';

const [file, refJson, readyFile, goFile] = process.argv.slice(2);

try {
  writeFileSync(readyFile, 'ready');
  let go = false;
  for (let i = 0; i < 2_000 && !go; i++) {
    go = existsSync(goFile);
    if (!go) await delay(5);
  }
  if (!go) throw new Error('barrier timeout');
  const handle = await handleForRef(file, JSON.parse(refJson));
  let resolve;
  try {
    resolve = { ok: true, ref: resolveHandle(file, handle) };
  } catch (error) {
    resolve = { ok: false, code: error?.code, message: String(error?.message ?? error) };
  }
  process.stdout.write(`${JSON.stringify({ handle, resolve })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: String(error?.message ?? error) })}\n`);
  process.exitCode = 2;
}
