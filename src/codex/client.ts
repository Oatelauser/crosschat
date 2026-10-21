import { MultichatError } from '../errors.js';
import { CodexRpcClient, type CodexRpcNotification } from './rpc.js';
import {
  openCodexProxySession,
  type CodexChannelFactory,
  type CodexProxySpawner,
} from './transport.js';

/**
 * thread.status wire values (schema-confirmed, v2/ThreadStatusChangedNotification):
 * notLoaded | idle | systemError | active{activeFlags:[waitingOnApproval|waitingOnUserInput]}.
 */
export type CodexThreadStatus =
  | 'not_loaded'
  | 'idle'
  | 'busy'
  | 'waiting_approval'
  | 'system_error';

export interface CodexTurn {
  id: string;
  status: string;
}

export interface CodexThreadSummary {
  id: string;
  name: string | null;
  status: CodexThreadStatus;
}

export interface CodexThreadPageOptions {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface CodexRawThreadSummary {
  id: string;
  name: string | null;
  rawStatus: unknown;
  attributes: Readonly<Record<string, unknown>>;
}

export interface CodexThreadPage {
  data: CodexRawThreadSummary[];
  nextCursor: string | null;
  /** Missing on injected modern readers; explicit partial for older payloads. */
  completeness?: 'complete' | 'partial';
}

export interface CodexSession {
  initialize(): Promise<void>;
  listThreads(): Promise<CodexThreadSummary[]>;
  /** Additive read-only paging; optional for existing injected session adapters. */
  listThreadPage?(options: CodexThreadPageOptions): Promise<CodexThreadPage>;
  resumeThread(threadId: string): Promise<CodexThreadStatus>;
  startTurn(threadId: string, text: string): Promise<CodexTurn>;
  steerTurn(threadId: string, expectedTurnId: string, text: string): Promise<string>;
  unsubscribe(threadId: string): Promise<void>;
  /** Isolated live self-test only: creates a thread owned by crosschat. */
  startThread(cwd: string): Promise<string>;
  /** Isolated live self-test only: deletes a thread created by startThread. */
  deleteThread(threadId: string): Promise<void>;
  notifications(): readonly CodexRpcNotification[];
  close(): Promise<void>;
}

export type CodexSessionFactory = () => Promise<CodexSession>;

export interface CodexThreadPageSession extends CodexSession {
  listThreadPage(options: CodexThreadPageOptions): Promise<CodexThreadPage>;
}

export interface CodexSessionOptions {
  requestTimeoutMs?: number;
  executable?: string;
  /** Test seam: replaces spawn + ws transport with a fake channel. */
  channelFactory?: CodexChannelFactory;
  spawnProxy?: CodexProxySpawner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolError(message: string): MultichatError {
  return new MultichatError('CODEX_PROTOCOL_ERROR', message);
}

/** The session owner still closes the transport after a cancelled read. */
async function awaitPage<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException('Codex page read cancelled.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

export function normalizeThreadStatus(value: unknown): CodexThreadStatus {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw protocolError('codex thread.status missing or malformed.');
  }
  switch (value.type) {
    case 'notLoaded':
      return 'not_loaded';
    case 'idle':
      return 'idle';
    case 'systemError':
      return 'system_error';
    case 'active': {
      const flags = Array.isArray(value.activeFlags) ? value.activeFlags : [];
      // waitingOnUserInput is treated like an approval: only the user may answer.
      return flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')
        ? 'waiting_approval'
        : 'busy';
    }
    default:
      throw protocolError(`unknown codex thread status type: ${value.type}`);
  }
}

/**
 * Build a session factory. Each call performs the full fresh operation setup
 * (spawn proxy -> WebSocket upgrade -> JSON-RPC client); the caller owns
 * close(). One session per operation; no pooling, no reuse.
 */
export function openCodexSession(options: CodexSessionOptions = {}): () => Promise<CodexThreadPageSession> {
  return async () => {
    const proxy = await openCodexProxySession(options);
    const rpc = new CodexRpcClient(proxy.channel, options.requestTimeoutMs);
    const input = (text: string) => [{ text, type: 'text' }];
    const session: CodexThreadPageSession = {
      async initialize(): Promise<void> {
        await rpc.request('initialize', {
          capabilities: { experimentalApi: true },
          clientInfo: { name: 'crosschat', title: 'crosschat', version: '1.0.0' },
        });
        rpc.notify('initialized', {});
      },
      async listThreads(): Promise<CodexThreadSummary[]> {
        // Absent sourceKinds, the server defaults to interactive-only sources
        // (cli/vscode — app-server filters.rs INTERACTIVE_SESSION_SOURCES), so
        // `codex exec` threads (source=exec, B19/B20 drill §5.1) would never be
        // listed. Legal values = ThreadSourceKind enum (v2 protocol schema).
        const result = await rpc.request('thread/list', {
          archived: false,
          limit: 20,
          sortKey: 'recency_at',
          sourceKinds: ['cli', 'vscode', 'exec'],
          useStateDbOnly: true,
        });
        if (!isRecord(result) || !Array.isArray(result.data)) {
          throw protocolError('thread/list response missing data array.');
        }
        return result.data.map((raw) => {
          if (!isRecord(raw) || typeof raw.id !== 'string') {
            throw protocolError('thread/list item missing id.');
          }
          return {
            id: raw.id,
            name: typeof raw.name === 'string' ? raw.name : null,
            status: normalizeThreadStatus(raw.status),
          };
        });
      },
      async listThreadPage(page: CodexThreadPageOptions): Promise<CodexThreadPage> {
        if (page.signal?.aborted) throw new DOMException('Codex page read cancelled.', 'AbortError');
        const limit = page.limit ?? 100;
        if (!Number.isSafeInteger(limit) || limit < 1) throw protocolError('thread/list page limit must be a positive integer.');
        const result = await awaitPage(rpc.request('thread/list', {
          archived: false,
          limit,
          ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
          sortKey: 'recency_at',
          sourceKinds: ['cli', 'vscode', 'exec'],
          useStateDbOnly: true,
        }), page.signal);
        if (page.signal?.aborted) throw new DOMException('Codex page read cancelled.', 'AbortError');
        if (!isRecord(result) || !Array.isArray(result.data)) throw protocolError('thread/list response missing data array.');
        if (result.nextCursor !== undefined && result.nextCursor !== null && typeof result.nextCursor !== 'string') throw protocolError('thread/list response has malformed cursor.');
        return {
          data: result.data.map((raw) => {
            if (!isRecord(raw) || typeof raw.id !== 'string') throw protocolError('thread/list item missing id.');
            return {
              id: raw.id,
              name: typeof raw.name === 'string' ? raw.name : null,
              rawStatus: raw.status,
              attributes: { cwd: raw.cwd, path: raw.path, createdAt: raw.createdAt, updatedAt: raw.updatedAt, source: raw.source, originator: raw.originator },
            };
          }),
          nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null,
          completeness: result.nextCursor === undefined ? 'partial' : 'complete',
        };
      },
      async resumeThread(threadId: string): Promise<CodexThreadStatus> {
        const result = await rpc.request('thread/resume', {
          excludeTurns: true,
          threadId,
        });
        if (!isRecord(result) || !isRecord(result.thread) || result.thread.id !== threadId) {
          throw protocolError('thread/resume response missing matching thread.');
        }
        return normalizeThreadStatus(result.thread.status);
      },
      async startTurn(threadId: string, text: string): Promise<CodexTurn> {
        const result = await rpc.request('turn/start', {
          input: input(text),
          threadId,
          turnTrigger: 'crosschat',
        });
        if (
          !isRecord(result) ||
          !isRecord(result.turn) ||
          typeof result.turn.id !== 'string' ||
          typeof result.turn.status !== 'string'
        ) {
          throw protocolError('turn/start response missing turn.');
        }
        return { id: result.turn.id, status: result.turn.status };
      },
      async steerTurn(threadId: string, expectedTurnId: string, text: string): Promise<string> {
        const result = await rpc.request('turn/steer', {
          expectedTurnId,
          input: input(text),
          threadId,
        });
        if (!isRecord(result) || typeof result.turnId !== 'string') {
          throw protocolError('turn/steer response missing turnId.');
        }
        return result.turnId;
      },
      async unsubscribe(threadId: string): Promise<void> {
        await rpc.request('thread/unsubscribe', { threadId });
      },
      async startThread(cwd: string): Promise<string> {
        const result = await rpc.request('thread/start', { cwd });
        if (!isRecord(result) || !isRecord(result.thread) || typeof result.thread.id !== 'string') {
          throw protocolError('thread/start response missing thread id.');
        }
        return result.thread.id;
      },
      async deleteThread(threadId: string): Promise<void> {
        await rpc.request('thread/delete', { threadId });
      },
      notifications(): readonly CodexRpcNotification[] {
        return rpc.notifications;
      },
      async close(): Promise<void> {
        rpc.dispose();
        await proxy.close();
      },
    };
    return session;
  };
}
