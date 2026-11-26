import { MultichatError } from '../errors.js';
import type { DeliveryOptions } from '../delivery-mode.js';
import { normalizeThreadStatus } from './client.js';
import type { CodexThreadStatus, CodexThreadSummary } from './client.js';

/** The host owns tool authorization, caller metadata, and the official MCP call. */
export type AppToolsInvoker = (
  tool: 'list_threads' | 'read_thread' | 'send_message_to_thread',
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Native-host metadata stays local to this adapter, outside the legacy core. */
export interface AppToolsThreadSummary extends CodexThreadSummary {
  endpointType: 'desktop';
}

export interface AppToolsDeliveryOptions extends DeliveryOptions {
  endpointType?: string;
}

const HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_PAGES = 100;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function protocolError(message: string, cause?: unknown): MultichatError {
  return new MultichatError('CODEX_APP_TOOLS_PROTOCOL_ERROR', message, { cause });
}

/** Parse the official MCP envelope, never a fabricated native-pipe receipt. */
function resultObject(value: unknown): Record<string, unknown> {
  if (!record(value) || value.isError !== undefined && typeof value.isError !== 'boolean') {
    throw protocolError('Codex app tools returned an invalid MCP response.');
  }
  if (value.isError === true) {
    throw new MultichatError('CODEX_APP_TOOLS_REJECTED', 'The Codex app tool reported a failure.');
  }
  if (!Array.isArray(value.content) || value.content.length !== 1) {
    throw protocolError('Codex app tools returned no unambiguous JSON result.');
  }
  const content: unknown = value.content[0];
  if (!record(content) || content.type !== 'text' || typeof content.text !== 'string'
    || Buffer.byteLength(content.text, 'utf8') > MAX_RESULT_BYTES) {
    throw protocolError('Codex app tools returned invalid or oversized result content.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(content.text); }
  catch { throw protocolError('Codex app tools returned malformed JSON.'); }
  if (!record(parsed)) throw protocolError('Codex app tools returned a non-object JSON result.');
  return parsed;
}

function status(value: unknown, form: 'listing' | 'metadata'): CodexThreadStatus {
  const raw = form === 'listing' && typeof value === 'string'
    ? { type: value, ...(value === 'active' ? { activeFlags: [] } : {}) } : value;
  if (!record(raw) || typeof raw.type !== 'string'
    || raw.type === 'active' && (!Array.isArray(raw.activeFlags)
      || !raw.activeFlags.every((flag: unknown) => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput'))) {
    throw protocolError('Codex app tools returned malformed thread status.');
  }
  if (form === 'listing' && typeof value !== 'string') {
    throw protocolError('Codex app tools returned malformed history status.');
  }
  try { return normalizeThreadStatus(raw); }
  catch (cause) { throw protocolError('Codex app tools returned an unsupported thread status.', cause); }
}

function threadSummary(value: unknown, form: 'listing' | 'metadata', expectedId?: string): AppToolsThreadSummary {
  if (!record(value) || !nonempty(value.id) || expectedId !== undefined && value.id !== expectedId
    || value.kind !== 'codex' || value.hostId !== 'local'
    || value.title !== null && typeof value.title !== 'string') {
    throw protocolError('Codex app tools returned mismatched or malformed local thread metadata.');
  }
  return { id: value.id, endpointType: 'desktop', name: value.title, status: status(value.status, form) };
}

async function readResult(
  invoke: AppToolsInvoker,
  tool: 'list_threads' | 'read_thread',
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response: unknown;
  try { response = await invoke(tool, args); }
  catch (cause) {
    throw new MultichatError('CODEX_APP_TOOLS_UNAVAILABLE', 'The Codex app tool read did not complete.', { cause });
  }
  return resultObject(response);
}

/** Complete local history only; a bounded prefix is never returned as complete. */
export async function listAppToolsThreads(invoke: AppToolsInvoker): Promise<AppToolsThreadSummary[]> {
  const threads: AppToolsThreadSummary[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const result = await readResult(invoke, 'list_threads', {
      mode: 'history', source: 'codex', hostId: 'local', archived: false, limit: HISTORY_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!Array.isArray(result.threads) || result.threads.length > HISTORY_PAGE_SIZE
      || result.nextCursor !== null && !nonempty(result.nextCursor)) {
      throw protocolError('Codex app tools did not return a valid complete history page.');
    }
    for (const value of result.threads) {
      const thread = threadSummary(value, 'listing');
      if (ids.has(thread.id)) throw protocolError('Codex app history repeated a thread; refresh before selecting a target.');
      ids.add(thread.id);
      threads.push(thread);
    }
    if (result.nextCursor === null) return threads;
    if (cursors.has(result.nextCursor)) throw protocolError('Codex app history repeated its cursor.');
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new MultichatError('CODEX_DISCOVERY_INCOMPLETE', 'Codex app history exceeded the bounded page limit; no complete target list was obtained.');
}

export async function readAppToolsThread(invoke: AppToolsInvoker, id: string): Promise<AppToolsThreadSummary> {
  if (!nonempty(id)) throw protocolError('A complete native thread ID is required.');
  const result = await readResult(invoke, 'read_thread', { threadId: id, hostId: 'local', includeTurns: false });
  if (result.schemaVersion !== 1) throw protocolError('Codex app tools returned an unsupported metadata schema.');
  return threadSummary(result.thread, 'metadata', id);
}

/** No queue or retry: native follow-up decides whether to wake or steer the thread. */
export async function deliverAppToolsMessage(
  invoke: AppToolsInvoker,
  id: string,
  content: string,
  options: AppToolsDeliveryOptions = {},
): Promise<{ status: 'accepted'; queued: false }> {
  if (options.mode !== 'steer') {
    throw new MultichatError('CODEX_APP_TOOLS_MODE_UNSUPPORTED', 'Codex app tools require explicit steer delivery; queue is unsupported.');
  }
  if (options.endpointType !== 'desktop') {
    throw new MultichatError('CODEX_ENDPOINT_TYPE_UNSUPPORTED', 'Codex app tools require an explicit Desktop endpoint.');
  }
  if (!nonempty(id) || !nonempty(content)) throw protocolError('A complete thread ID and nonempty message are required.');
  const thread = await readAppToolsThread(invoke, id);
  if (thread.status === 'waiting_approval') {
    throw new MultichatError('CODEX_APPROVAL_REQUIRED', 'The Codex thread is waiting for user approval or input; no follow-up was sent.');
  }
  if (thread.status === 'system_error') throw protocolError('The Codex thread is in system_error state; no follow-up was sent.');
  try {
    const result = resultObject(await invoke('send_message_to_thread', { threadId: id, hostId: 'local', prompt: content }));
    if (result.threadId !== id) throw protocolError('Codex app tools did not acknowledge the selected thread.');
    return { status: 'accepted', queued: false };
  } catch (cause) {
    // A general host failure is not evidence that the native write never happened.
    throw new MultichatError('CODEX_WRITE_UNCERTAIN', 'Codex app tool write acceptance could not be confirmed; it was not retried.', { cause });
  }
}
