import { MultichatError } from '../../errors.js';
import { requestAdminOp, SenderConn } from '../../serve/via-tcp.js';
import type { BrokerEntry } from '../../serve/node-config.js';
import type { AdminOpResultFrame } from '../../serve/protocol.js';

export type RemoteManagementRequest =
  | { op: 'list-nodes' }
  | { op: 'list-members' }
  | { op: 'gen-key'; count: string }
  | { op: 'remove-node'; label: string };

export interface RemoteAdminConnection {
  request(action: string, params: { n?: number; host?: string; label?: string }): Promise<AdminOpResultFrame>;
  close(): void;
}

export interface RemoteManagementDeps {
  selector?: string;
  openMember?(entry: BrokerEntry): Promise<RemoteAdminConnection>;
  openAdmin?(entry: BrokerEntry & { adminKey: string }): Promise<RemoteAdminConnection>;
}

const TIMEOUT_MS = 10_000;

function connection(conn: SenderConn): RemoteAdminConnection {
  return { request: (action, params) => requestAdminOp(conn, action, params, TIMEOUT_MS), close: () => conn.close() };
}

/** Member reads and administrator challenge writes retain the existing wire adapter. */
export async function executeRemoteManagement(
  entry: BrokerEntry,
  request: RemoteManagementRequest,
  deps: RemoteManagementDeps = {},
): Promise<AdminOpResultFrame> {
  try {
    if (request.op === 'list-nodes' || request.op === 'list-members') {
      const conn = await (deps.openMember?.(entry) ?? SenderConn.open(`ws://${entry.host}:${entry.port}`, entry.key, undefined, TIMEOUT_MS).then(connection));
      try { return await conn.request(request.op, {}); }
      finally { conn.close(); }
    }
    if (entry.adminKey === undefined) {
      throw new MultichatError('USAGE',
        `本机 node.json 的星 ${entry.name ?? deps.selector ?? entry.starId ?? '?'} 条目无 adminKey（星管理钥）——找 broker 主发放（broker 机 crosschat serve --star <星> --gen-admin-key <label>），把回显的 adminKey 并进该星条目`);
    }
    const conn = await (deps.openAdmin?.({ ...entry, adminKey: entry.adminKey }) ?? SenderConn.openAdmin(`ws://${entry.host}:${entry.port}`, entry.adminKey, TIMEOUT_MS).then(connection));
    try {
      if (request.op === 'gen-key') {
        const n = Number.parseInt(request.count, 10);
        if (!Number.isInteger(n) || n < 1) throw new MultichatError('USAGE', `--gen-key 数量须为 1-10 的整数，收到：${request.count}`);
        return await conn.request('gen-key', { n, host: entry.host });
      }
      return await conn.request('remove-node', { label: request.label });
    } finally {
      conn.close();
    }
  } catch (error) {
    if (error instanceof MultichatError) throw error;
    throw new MultichatError('TCP_TRANSPORT_FAILED',
      `远程管理未达（${error instanceof Error ? error.message : String(error)}）——broker 在跑吗（crosschat serve）？两端 crosschat 都须为 034 挑战应答协议版本`);
  }
}
