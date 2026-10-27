import { randomUUID } from 'node:crypto';
import { SenderConn } from '../../serve/via-tcp.js';
import type { SessionOperationFrame, SessionOperationResultFrame } from '../../serve/protocol.js';
import { resolveTcpContext } from './reading.js';
import { checkAbort } from '../queries/reading.js';

export interface TcpSessionTarget { contextId: string; starId: string; machineId: string; providerId: string; nativeId: string }
export type TcpSessionOperation = (target: TcpSessionTarget, request: SessionOperationFrame['request'], signal?: AbortSignal) => Promise<SessionOperationResultFrame>;

/** Every call rereads configuration, binds the actual star, and owns its transient connection. */
export function createTcpSessionOperation(options: { baseDir: string; timeoutMs?: number }): TcpSessionOperation {
  return async (target, request, signal) => {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const resolved = await resolveTcpContext({ baseDir: options.baseDir, contextId: target.contextId, signal });
    const context = resolved.value;
    const entries = context?.kind === 'local' ? context.nodeConfig?.entries.filter((entry) => entry.starId === target.starId) : context?.entry ? [context.entry] : [];
    if (!entries || entries.length !== 1 || entries[0].starId !== target.starId) throw new Error('所选星缺少唯一的节点连接配置。');
    const entry = entries[0];
    const host = entry.host.includes(':') && !entry.host.startsWith('[') ? `[${entry.host}]` : entry.host;
    const conn = await SenderConn.open(`ws://${host}:${entry.port}`, entry.key, undefined, timeoutMs, signal);
    const abort = () => conn.close(); signal?.addEventListener('abort', abort, { once: true });
    try {
      checkAbort(signal);
      if (conn.starId !== target.starId) throw new Error('连接到的星已改变。');
      const id = randomUUID();
      await conn.send({ op: 'session-operation', id, starId: target.starId, machineId: target.machineId, providerId: target.providerId, nativeId: target.nativeId, request });
      const reply = await conn.waitFor((frame) => frame.op === 'session-operation-result' && frame.id === id, timeoutMs);
      if (reply.op !== 'session-operation-result' || reply.starId !== target.starId || reply.machineId !== target.machineId
        || reply.providerId !== target.providerId || reply.nativeId !== target.nativeId) throw new Error('节点操作回执身份不一致。');
      return reply;
    } finally { signal?.removeEventListener('abort', abort); conn.close(); }
  };
}
