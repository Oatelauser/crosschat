/** Shared local aggregator transport; callers own the returned pipe. */
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { MultichatError } from '../errors.js';
import { abortError, isRecord } from '../application/sessions/reading.js';
import { attachPipePath } from './node.js';
import type { BrokerEntry } from './node-config.js';
import { MAX_PAYLOAD_BYTES } from './protocol.js';
import type { SessionMemberDecl } from './protocol.js';
import { tcpDir } from './registry.js';
import { assertNodeNotRevoked } from './revocation.js';

export interface AttachStatusReply {
  online: boolean;
  brokerCap: boolean;
  members: SessionMemberDecl[];
  /** Present only while this aggregator has an authenticated broker connection. */
  starId?: string;
  machine?: string;
}

export interface AttachReply extends Partial<AttachStatusReply> {
  ok: boolean;
  error?: string;
  disconnected?: boolean;
  unconfirmed?: boolean;
}

export interface AttachPipeClient {
  send(req: unknown): Promise<AttachReply>;
  waitClose(): Promise<void>;
  close(): void;
}

function parseReply(input: unknown): AttachReply {
  const invalid = (): AttachReply => ({ ok: false, unconfirmed: true, error: 'attach 管道回执格式错误' });
  if (!isRecord(input) || typeof input.ok !== 'boolean') return invalid();
  const reply: AttachReply = { ok: input.ok };
  if (typeof input.error === 'string') reply.error = input.error;
  if (input.online !== undefined) { if (typeof input.online !== 'boolean') return invalid(); reply.online = input.online; }
  if (input.brokerCap !== undefined) { if (typeof input.brokerCap !== 'boolean') return invalid(); reply.brokerCap = input.brokerCap; }
  if (input.starId !== undefined) { if (typeof input.starId !== 'string') return invalid(); reply.starId = input.starId; }
  if (input.machine !== undefined) { if (typeof input.machine !== 'string') return invalid(); reply.machine = input.machine; }
  if (input.members !== undefined) {
    if (!Array.isArray(input.members)) return invalid();
    const members: SessionMemberDecl[] = [];
    for (const item of input.members) {
      if (!isRecord(item) || typeof item.sessionId !== 'string' || item.sessionId === '') return invalid();
      if ((item.name !== undefined && typeof item.name !== 'string') || (item.tool !== undefined && typeof item.tool !== 'string')) return invalid();
      let extendsValue: SessionMemberDecl['extends'];
      if (typeof item.extends === 'string') extendsValue = item.extends;
      else if (item.extends !== undefined) {
        if (!isRecord(item.extends) || typeof item.extends.name !== 'string' || typeof item.extends.machine !== 'string') return invalid();
        extendsValue = { name: item.extends.name, machine: item.extends.machine };
      }
      members.push({ sessionId: item.sessionId,
        ...(typeof item.name === 'string' ? { name: item.name } : {}), ...(typeof item.tool === 'string' ? { tool: item.tool } : {}),
        ...(extendsValue === undefined ? {} : { extends: extendsValue }), ...(item.temporary === true ? { temporary: true } : {}) });
    }
    reply.members = members;
  }
  return reply;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(); };
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(abortError()); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function openPipe(pipePath: string, signal?: AbortSignal): Promise<AttachPipeClient> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: pipePath });
    let connected = false;
    const onAbort = () => { socket.destroy(); if (!connected) reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const waiters: Array<(reply: AttachReply) => void> = [];
    let closedResolve: () => void = () => undefined;
    const closed = new Promise<void>((done) => { closedResolve = done; });
    const disconnected = (): AttachReply => ({ ok: false, disconnected: true, unconfirmed: true, error: 'attach 管道已断开，请求结果未确认' });
    socket.on('error', (error) => { socket.destroy(); if (!connected) reject(error); });
    socket.once('close', () => {
      signal?.removeEventListener('abort', onAbort);
      if (!connected) reject(new Error('attach 管道已断开'));
      for (const waiter of waiters.splice(0)) waiter(disconnected());
      closedResolve();
    });
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > MAX_PAYLOAD_BYTES) { socket.destroy(); return; }
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index < 0) break;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim() === '') continue;
        const waiter = waiters.shift();
        if (waiter === undefined) continue;
        try { const input: unknown = JSON.parse(line); waiter(parseReply(input)); }
        catch { waiter({ ok: false, unconfirmed: true, error: 'attach 管道回执不是合法 JSON' }); }
      }
    });
    socket.once('connect', () => {
      connected = true;
      if (signal?.aborted) { socket.destroy(); reject(abortError()); return; }
      resolve({
        send: (request) => new Promise((done) => {
          if (socket.destroyed || !socket.writable) { done(disconnected()); return; }
          waiters.push(done);
          try { socket.write(`${JSON.stringify(request)}\n`); }
          catch { socket.destroy(); }
        }),
        waitClose: () => closed,
        close: () => { socket.destroy(); },
      });
    });
    if (signal?.aborted) onAbort();
  });
}

export async function connectAttachPipe(pipePath: string, retries = 0, retryMs = 300, signal?: AbortSignal): Promise<AttachPipeClient> {
  for (let attempt = 0; ; attempt++) {
    try { return await openPipe(pipePath, signal); }
    catch (error) {
      if (signal?.aborted || attempt >= retries) throw error;
      await pause(retryMs, signal);
    }
  }
}

export async function queryAttachStatus(pipe: AttachPipeClient): Promise<AttachStatusReply | undefined> {
  const reply = await pipe.send({ op: 'status' });
  return reply.ok && Array.isArray(reply.members) && typeof reply.brokerCap === 'boolean'
    ? { online: reply.online === true, brokerCap: reply.brokerCap, members: reply.members,
      ...(reply.starId === undefined ? {} : { starId: reply.starId }), ...(reply.machine === undefined ? {} : { machine: reply.machine }) }
    : undefined;
}

export interface AggregatorDeps {
  tcpBaseDir: string;
  spawnServeDetach(selector: string): void;
  now?(): number;
  aggregatorTimeoutMs?: number;
  signal?: AbortSignal;
}

/** Same CLI startup policy, with an optional cancellation owner for application callers. */
export async function ensureAggregator(deps: AggregatorDeps, entry: BrokerEntry, selector: string): Promise<AttachPipeClient> {
  const configFile = join(tcpDir(deps.tcpBaseDir), 'node.json');
  if (deps.signal?.aborted) throw abortError();
  assertNodeNotRevoked(configFile, entry);
  const pipePath = attachPipePath(entry, tcpDir(deps.tcpBaseDir));
  try { return await connectAttachPipe(pipePath, 0, 300, deps.signal); }
  catch {
    if (deps.signal?.aborted) throw abortError();
    assertNodeNotRevoked(configFile, entry);
    deps.spawnServeDetach(selector);
  }
  const deadline = (deps.now?.() ?? Date.now()) + (deps.aggregatorTimeoutMs ?? 30_000);
  for (;;) {
    await pause(500, deps.signal);
    assertNodeNotRevoked(configFile, entry);
    try { return await connectAttachPipe(pipePath, 0, 300, deps.signal); }
    catch (error) {
      if (deps.signal?.aborted) throw error;
      if ((deps.now?.() ?? Date.now()) > deadline) {
        const cmd = selector === '' ? 'crosschat serve --connect --detach' : `crosschat serve --connect ${selector} --detach`;
        throw new MultichatError('NOT_READY', `星 ${entry.name ?? selector} 的聚合器未就绪（已尝试自动拉起）——手动排查：${cmd}，看日志 ~/.crosschat/tcp/node*.log`);
      }
    }
  }
}

export function spawnServeDetachReal(selector: string): void {
  const entry = process.argv[1] ?? fileURLToPath(new URL('../cli.js', import.meta.url));
  const child = spawn(process.execPath, [realpathSync(entry), 'serve', '--connect', ...(selector === '' ? [] : [selector]), '--detach'], { detached: true, stdio: 'ignore' });
  child.unref();
}
