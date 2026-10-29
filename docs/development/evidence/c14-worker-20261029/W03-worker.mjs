// C14-W03 worker: one independent allocator caller against the real built module.
import { pathToFileURL } from 'node:url';

const dist = process.env.W03_DIST;
const { claimHandle } = await import(pathToFileURL(dist + '/conversations.js').href);
const { newConversationRef, encodeRef } = await import(pathToFileURL(dist + '/ref.js').href);

const ref = newConversationRef(
  { p: 'claude', id: process.env.W03_EP_A },
  { p: 'codex', id: process.env.W03_EP_B },
);
const handle = claimHandle(process.env.W03_STATE_FILE, ref, Number(process.env.W03_CANDIDATE));
process.stdout.write(JSON.stringify({ id: process.env.W03_WORKER_ID, handle, nonce: ref.n, ref: encodeRef(ref) }) + '\n');
