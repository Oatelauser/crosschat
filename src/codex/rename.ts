import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { MultichatError } from '../errors.js';
import { isProcessAlive } from '../platform/process-inspector.js';
import { openCodexSession } from './client.js';
import type { CodexSession, CodexSessionFactory } from './client.js';
import { codexHomeDir } from './rollout-meta.js';
import { CodexRpcRejectedError } from './rpc.js';
import type { NativeOperationProvider, OperationAvailability } from '../application/session-operations.js';
import type { DiscoverySession } from '../application/discovery/model.js';

export interface CodexRenameOptions {
  sessionFactory?: CodexSessionFactory;
  codexHome?: string;
  /** Native daemon identity boundary. Never creates, starts or repairs the daemon. */
  ownerIdentity?: () => Promise<string>;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const digest = (value: unknown): boolean => Array.isArray(value) && value.length === 32 && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
const rejected = (message: string): MultichatError => new MultichatError('NATIVE_OPERATION_REJECTED', message);

/** Bounded native PID/start/binary identity, never a user-config or transcript mutation. */
async function daemonIdentity(home: string): Promise<string> {
  const file = await open(join(home, 'app-server-daemon', 'daemon.pid'), 'r');
  try {
    const buffer = Buffer.alloc(8193);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 8192) throw new Error('Native daemon identity too large');
    const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (!record(value) || !Number.isSafeInteger(value.pid) || Number(value.pid) < 1 || !isProcessAlive(Number(value.pid))
      || typeof value.processStartTime !== 'string' || !value.processStartTime || !record(value.executableIdentity)
      || !digest(value.executableIdentity.digest) || !digest(value.executableIdentity.path_digest)) throw new Error('Native daemon identity unavailable');
    return createHash('sha256').update(JSON.stringify([value.pid, value.processStartTime, value.executableIdentity.digest, value.executableIdentity.path_digest])).digest('hex');
  } finally { await file.close(); }
}

/** The CLI daemon is a different endpoint from Desktop's owner-coordination pipe. */
export function createCodexRenameAdapter(options: CodexRenameOptions = {}): NonNullable<NativeOperationProvider['rename']> {
  const home = options.codexHome ?? codexHomeDir();
  const factory = options.sessionFactory ?? openCodexSession();
  const ownerIdentity = options.ownerIdentity ?? (() => daemonIdentity(home));
  const contextKey = async (item: DiscoverySession): Promise<string> => item.attributes.transport === 'cli'
    ? JSON.stringify(['codex-cli', await realpath(home), await ownerIdentity()])
    : JSON.stringify(['codex-other', item.attributes.transport ?? null, item.attributes.ownerId ?? null]);
  async function withSession<T>(signal: AbortSignal | undefined, work: (session: CodexSession) => Promise<T>): Promise<T> {
    let session: CodexSession | undefined;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => { if (!session) return Promise.resolve(); return closing ??= session.close().catch(() => undefined); };
    const abort = () => { void close(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      session = await factory();
      if (signal?.aborted) throw rejected('操作已取消，未发送改名。');
      await session.initialize();
      return await work(session);
    } finally { signal?.removeEventListener('abort', abort); await close(); }
  }
  async function verify(session: CodexSession, item: DiscoverySession, expected: string, signal?: AbortSignal): Promise<void> {
    const identity = session.nativeIdentity;
    const version = identity?.userAgent.match(/\/(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
    if (item.attributes.transport !== 'cli' || !identity || !version || Number(version[1]) !== 0 || Number(version[2]) < 163
      || !session.readThreadMetadata || !session.renameThread || await realpath(identity.codexHome) !== await realpath(home)) {
      throw rejected('此端点尚未核实 Codex CLI 原生改名能力，请使用原生改名后刷新。');
    }
    const thread = await session.readThreadMetadata(item.ref.nativeId);
    if (signal?.aborted || await contextKey(item) !== expected || thread.id !== item.ref.nativeId || thread.status === 'not_loaded' || thread.name !== item.name) {
      throw rejected('原生会话、名称或服务 owner 已变化；未发送改名，请刷新后重新确认。');
    }
  }
  return {
    contextKey,
    async probe(item, signal): Promise<OperationAvailability> {
      if (item.attributes.transport === 'desktop') return { state: 'unsupported', reason: '当前桌面协同接口不提供原生改名及窗口标题同步。', nextStep: '在 Codex 桌面版重命名聊天，再刷新；星内名称跟随原生名称。' };
      if (item.attributes.transport !== 'cli') return { state: 'needs-verification', reason: '无法核实此 Codex 会话的实际原生端点。', nextStep: '核对会话来源后刷新。' };
      try {
        const expected = await contextKey(item);
        await withSession(signal, (session) => verify(session, item, expected, signal));
        return { state: 'executable' };
      } catch (error) {
        return { state: error instanceof MultichatError && error.code === 'NATIVE_OPERATION_REJECTED' ? 'needs-verification' : 'unavailable',
          reason: error instanceof MultichatError ? error.message : 'Codex 原生服务暂不可用。', nextStep: '核对当前原生服务后刷新；恢复后会重新核验。' };
      }
    },
    async apply(item, name, signal, expectedContext): Promise<void> {
      let writeSent = false;
      try {
        await withSession(signal, async (session) => {
          await verify(session, item, expectedContext, signal);
          if (signal?.aborted) throw rejected('操作已取消，未发送改名。');
          // No resume, owner replacement or write replay. A lost setter response stays uncertain.
          writeSent = true;
          await session.renameThread!(item.ref.nativeId, name);
        });
      } catch (error) {
        if (error instanceof CodexRpcRejectedError) throw rejected(`Codex 原生接口拒绝改名：${error.message}`);
        if (!writeSent) throw rejected('原生目标或连接已变化，未发送改名；请刷新后重新确认。');
        throw error;
      }
    },
  };
}
