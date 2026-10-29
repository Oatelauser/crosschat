import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MultichatError } from '../../errors.js';
import { parseToolType } from '../../tool-types.js';
import { withSourceStateLock } from './state-lock.js';

/** A Provider has already associated this invocation with this origin/instance. */
export interface SourceContext {
  providerId: string;
  domain: string;
  runtime: string;
  scope: 'origin' | 'instance';
  nativeId: string;
  observedTool?: string;
}
export interface SourceStateOptions {
  directory: string;
  now?: () => number;
  requestConfirmation?: boolean;
  probePromptOwner?: SourcePromptProbe;
  promptOwnerTimeoutMs?: number;
}
export interface SourcePromptOwner { nativeId: string; runtime: string; claim: string }
export type SourcePromptPresence = 'active' | 'inactive' | 'unknown';
export type SourcePromptProbe = (owner: Readonly<SourcePromptOwner>, source: Readonly<SourceContext>, signal: AbortSignal) => Promise<SourcePromptPresence>;
export interface SourceClassification {
  status: 'identified' | 'confirmed' | 'unconfirmed' | 'confirmation-required' | 'confirmation-pending' | 'awaiting-verification' | 'conflict';
  shouldAsk: boolean;
  sourceTool?: string;
  basis?: 'native' | 'user';
  context?: string;
  scope?: 'origin' | 'instance';
  promptClaim?: string;
}
interface SourceRecord {
  schema: 1;
  key: string;
  providerId: string;
  scope: 'origin' | 'instance';
  context: string;
  owner?: SourcePromptOwner;
  choice?: string;
  verified: boolean;
  createdAt: number;
}
const CONTEXT = /^ccid1\.([a-f0-9]{64})\.[a-f0-9-]{36}$/;
const recordError = () => new MultichatError('SOURCE_STATE_INVALID', 'Caller source confirmation state is unreadable or invalid; it was not replaced.');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasCode = (error: unknown, code: string): boolean => isRecord(error) && error.code === code;
function keyOf(source: SourceContext): string {
  if (!source.providerId || !source.domain || !source.runtime || !source.nativeId || !['origin', 'instance'].includes(source.scope)) {
    throw new MultichatError('SOURCE_CONTEXT_INVALID', 'A verified native origin, runtime and full session identity are required.');
  }
  return createHash('sha256').update(JSON.stringify([source.providerId, source.scope, source.domain,
    source.scope === 'instance' ? source.runtime : null])).digest('hex');
}
function contextKey(context: string): string {
  const matched = CONTEXT.exec(context);
  if (matched === null) throw new MultichatError('SOURCE_CONTEXT_INVALID', 'Use the confirmation reference generated for this native source.');
  return matched[1];
}
function requireType(tool: string, providerId: string): void {
  if (parseToolType(tool)?.providerId !== providerId) {
    throw new MultichatError('SOURCE_TYPE_CONFLICT', 'The chosen source type does not match this native Provider.');
  }
}
async function readRecord(key: string, options: SourceStateOptions): Promise<SourceRecord | undefined> {
  const file = join(options.directory, `${key}.json`);
  try {
    const details = await stat(file);
    if (!details.isFile() || details.size > 64 * 1024) throw recordError();
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!isRecord(value) || value.schema !== 1 || value.key !== key || typeof value.providerId !== 'string'
      || !['origin', 'instance'].includes(String(value.scope)) || typeof value.context !== 'string'
      || contextKey(value.context) !== key || typeof value.verified !== 'boolean'
      || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
      || (value.choice !== undefined && (typeof value.choice !== 'string' || parseToolType(value.choice)?.providerId !== value.providerId))
      || (value.owner !== undefined && (!isRecord(value.owner) || typeof value.owner.nativeId !== 'string' || !value.owner.nativeId
        || typeof value.owner.runtime !== 'string' || !value.owner.runtime || typeof value.owner.claim !== 'string' || !value.owner.claim))
      || (value.verified && value.choice === undefined)) throw recordError();
    return value as unknown as SourceRecord;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw recordError();
  }
}
async function saveRecord(record: SourceRecord, options: SourceStateOptions): Promise<void> {
  const file = join(options.directory, `${record.key}.json`);
  const temporary = join(options.directory, `${record.key}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch((error: unknown) => { if (!hasCode(error, 'ENOENT')) throw error; }); }
}
/** Serialize short local state mutations across independent CLI processes. */
async function withRecord<T>(key: string, options: SourceStateOptions, work: () => Promise<T>): Promise<T> {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const result = await withSourceStateLock(options.directory, key, work);
  if (!result.acquired) throw new MultichatError('SOURCE_STATE_BUSY', 'Source confirmation is temporarily busy; no new question or write was issued.');
  return result.value;
}
function classification(record: SourceRecord, status: SourceClassification['status'], shouldAsk = false): SourceClassification {
  return { status, shouldAsk, context: record.context, scope: record.scope,
    ...(shouldAsk && record.owner !== undefined ? { promptClaim: record.owner.claim } : {}),
    ...(record.verified && record.choice !== undefined ? { sourceTool: record.choice, basis: 'user' } : {}) };
}

async function ownerPresence(owner: SourcePromptOwner, source: SourceContext, options: SourceStateOptions): Promise<SourcePromptPresence> {
  if (options.probePromptOwner === undefined) return 'unknown';
  const timeoutMs = options.promptOwnerTimeoutMs ?? 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid native prompt owner timeout.');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const observation = Promise.resolve().then(() => options.probePromptOwner!({ ...owner }, { ...source }, controller.signal))
      .catch((): SourcePromptPresence => 'unknown');
    const result = await Promise.race([observation, new Promise<SourcePromptPresence>((resolve) => {
      timer = setTimeout(() => resolve('unknown'), timeoutMs);
    })]);
    return ['active', 'inactive', 'unknown'].includes(result) ? result : 'unknown';
  } finally { clearTimeout(timer); controller.abort(); }
}
function checkSource(record: SourceRecord, source: SourceContext): void {
  if (record.key !== keyOf(source) || record.providerId !== source.providerId || record.scope !== source.scope) {
    throw new MultichatError('SOURCE_CONTEXT_CHANGED', 'The current native source differs from the source awaiting confirmation.');
  }
}

/** Read-only unless an approved caller explicitly requests the shared first question. */
export async function inspectSource(source: SourceContext, options: SourceStateOptions): Promise<SourceClassification> {
  const key = keyOf(source);
  if (source.observedTool !== undefined) requireType(source.observedTool, source.providerId);
  const read = (record: SourceRecord | undefined): SourceClassification | undefined => {
    if (record !== undefined) {
      checkSource(record, source);
      if (record.choice !== undefined && source.observedTool !== undefined && record.choice !== source.observedTool) return classification(record, 'conflict');
    }
    if (source.observedTool !== undefined) return { status: 'identified', shouldAsk: false, sourceTool: source.observedTool, basis: 'native', scope: source.scope };
    if (record?.verified) return classification(record, 'confirmed');
    if (record?.choice !== undefined) return undefined; // An answer retained while offline now needs revalidation.
    if (record !== undefined && !options.requestConfirmation) return classification(record, 'confirmation-pending');
    return undefined;
  };
  const prior = await readRecord(key, options);
  const existing = read(prior);
  if (existing !== undefined) return existing;
  if (!options.requestConfirmation && prior?.choice === undefined) return { status: 'unconfirmed', shouldAsk: false, scope: source.scope };
  let inactiveClaim: string | undefined;
  if (prior?.owner !== undefined && prior.choice === undefined) {
    if (await ownerPresence(prior.owner, source, options) !== 'inactive') {
      return inspectSource(source, { ...options, requestConfirmation: false });
    }
    inactiveClaim = prior.owner.claim;
  }
  if (prior?.choice === undefined && options.probePromptOwner === undefined) {
    throw new MultichatError('SOURCE_LIFECYCLE_UNAVAILABLE', 'A native prompt-owner lifecycle probe is required before asking a shared source question.');
  }
  return withRecord(key, options, async () => {
    let record = await readRecord(key, options);
    const current = read(record);
    if (current !== undefined) return current;
    if (record !== undefined) checkSource(record, source);
    if (record?.choice !== undefined) {
      record.verified = true;
      await saveRecord(record, options);
      return classification(record, 'confirmed');
    }
    if (record?.owner !== undefined && record.owner.claim !== inactiveClaim) return classification(record, 'confirmation-pending');
    record ??= { schema: 1, key, providerId: source.providerId, scope: source.scope,
      context: `ccid1.${key}.${randomUUID()}`, verified: false, createdAt: options.now?.() ?? Date.now() };
    record.owner = { nativeId: source.nativeId, runtime: source.runtime, claim: randomUUID() };
    await saveRecord(record, options);
    return classification(record, 'confirmation-required', true);
  });
}

/** Save one answer; unavailable provenance keeps it pending instead of claiming success. */
export async function confirmSource(
  context: string,
  tool: string,
  source: Pick<SourceContext, 'providerId' | 'nativeId'> & Partial<SourceContext>,
  options: SourceStateOptions,
): Promise<SourceClassification> {
  const key = contextKey(context);
  return withRecord(key, options, async () => {
    const record = await readRecord(key, options);
    if (record === undefined || record.context !== context || record.providerId !== source.providerId) {
      throw new MultichatError('SOURCE_CONTEXT_CHANGED', 'This confirmation does not match the current native source.');
    }
    requireType(tool, record.providerId);
    if (record.choice !== undefined && record.choice !== tool) throw new MultichatError('SOURCE_TYPE_CONFLICT', 'An existing source classification cannot be silently changed.');
    const verified = source.domain !== undefined && source.runtime !== undefined && source.scope !== undefined;
    if (verified) {
      checkSource(record, source as SourceContext);
      if (source.observedTool !== undefined && source.observedTool !== tool) throw new MultichatError('SOURCE_TYPE_CONFLICT', 'The chosen type conflicts with the current native observation.');
    } else if (!source.nativeId || record.owner?.nativeId !== source.nativeId) {
      throw new MultichatError('SOURCE_CONTEXT_UNAVAILABLE', 'An offline answer can only be retained for the native session that owns this pending question.');
    }
    record.choice = tool;
    record.verified = verified;
    await saveRecord(record, options);
    return classification(record, verified ? 'confirmed' : 'awaiting-verification');
  });
}

/** Native lifecycle integration releases display ownership, never the shared answer. */
export async function releaseSourcePrompt(context: string, source: SourceContext, options: SourceStateOptions, claim: string): Promise<void> {
  const key = contextKey(context);
  await withRecord(key, options, async () => {
    const record = await readRecord(key, options);
    if (record === undefined || record.context !== context) return;
    checkSource(record, source);
    if (!claim || record.owner?.claim !== claim || record.owner.nativeId !== source.nativeId || record.owner.runtime !== source.runtime) return;
    delete record.owner;
    await saveRecord(record, options);
  });
}
