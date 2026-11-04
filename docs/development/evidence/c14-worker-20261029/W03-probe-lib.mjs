// C14-W03-R1 shared helpers: filesystem/format primitives only — no allocation logic.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export const COLLISION_CODE = 'INVALID_CONVERSATION_REF';
export const COLLISION_MARK = '撞号';

export function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function fileStat(file) {
  try {
    const s = statSync(file);
    return { bytes: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return undefined;
  }
}

/** Keeps the last `limit` chars: a worker's JSON result is its final line. */
export function tailBuffer(limit = 64 * 1024) {
  let text = '';
  let truncated = false;
  return {
    push(chunk) {
      text += chunk;
      if (text.length > limit) {
        text = text.slice(-limit);
        truncated = true;
      }
    },
    get text() { return text; },
    get truncated() { return truncated; },
  };
}

function realOrResolved(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

export function isInside(child, parent) {
  const c = realOrResolved(child);
  const p = realOrResolved(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** Recursive deletion is allowed only for a mkdtemp root this probe created. */
export function ownedTempRoot(root) {
  return basename(root).startsWith('crosschat-w03-') && isInside(root, tmpdir());
}

export function readShardHandles(shardDir) {
  let names = [];
  try { names = readdirSync(shardDir).sort(); } catch { return []; }
  const shards = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let shard;
    try { shard = JSON.parse(readFileSync(join(shardDir, name), 'utf8')); } catch { continue; }
    const handles = {};
    for (const [handle, ref] of Object.entries(shard?.handles ?? {})) handles[handle] = String(ref);
    shards.push({ shard: name, handles });
  }
  return shards;
}

/** handle -> [{shard, ref}] */
export function handleIndex(shards) {
  const index = new Map();
  for (const { shard, handles } of shards) {
    for (const [handle, ref] of Object.entries(handles)) {
      if (!index.has(handle)) index.set(handle, []);
      index.get(handle).push({ shard, ref });
    }
  }
  return index;
}

/** Handles actually bound to more than one distinct ref — the authoritative duplicate test. */
export function duplicatesOf(shards) {
  const out = [];
  for (const [handle, hits] of handleIndex(shards)) {
    const refs = [...new Set(hits.map((h) => h.ref))];
    if (refs.length > 1) out.push({ handle, shards: hits.map((h) => h.shard), refs });
  }
  return out;
}

/**
 * own = resolves to this worker's own full ref; collision = the target ambiguity error;
 * other = resolves to a different ref (wrong mapping); error = any other failure.
 */
export function resolveVerdict(resolved, ownRef) {
  if (resolved?.ok === true) return resolved.ref === ownRef ? 'own' : 'other';
  const ambiguous = resolved?.code === COLLISION_CODE && String(resolved?.message ?? '').includes(COLLISION_MARK);
  return ambiguous ? 'collision' : 'error';
}
