// C14-W03-R1 worker: one independent allocator caller against the real built module.
// Resolves its own returned handle and reports the full ref so the caller can compare
// it verbatim with this worker's own ref (no truncated prefixes).
import { pathToFileURL } from 'node:url';

function emit(payload, code) {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(code);
}

const id = process.env.W03_WORKER_ID;

try {
  const dist = process.env.W03_DIST;
  const { claimHandle, resolveHandle } = await import(pathToFileURL(dist + '/conversations.js').href);
  const { newConversationRef, encodeRef } = await import(pathToFileURL(dist + '/ref.js').href);

  const ref = newConversationRef(
    { p: 'claude', id: process.env.W03_EP_A },
    { p: 'codex', id: process.env.W03_EP_B },
  );
  const ownRef = encodeRef(ref);
  const stateFile = process.env.W03_STATE_FILE;
  const handle = claimHandle(stateFile, ref, Number(process.env.W03_CANDIDATE));

  let resolve;
  try {
    resolve = { ok: true, ref: resolveHandle(stateFile, handle) };
  } catch (error) {
    resolve = { ok: false, code: error?.code ?? 'UNKNOWN', message: String(error?.message ?? error) };
  }

  emit({ id, handle, nonce: ref.n, ref: ownRef, renames: globalThis.__w03Renames ?? 0, resolve }, 0);
} catch (error) {
  emit({ id, error: String(error?.message ?? error) }, 2);
}
