import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { tcpDir } from '../../serve/registry.js';
import type { AdminReply } from '../../serve/broker.js';

export type AdminOutcome = { kind: 'hot'; reply: AdminReply } | { kind: 'cold' } | { kind: 'failed'; error: string };

export interface AdminSocket {
  write(text: string): unknown;
  destroy(): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
}

export interface AdminTransportDeps {
  baseDir: string;
  readStatus?(): unknown;
  isProcessAlive?(pid: number): boolean;
  connect?(pipe: string, onConnect: () => void): AdminSocket;
}

const ADMIN_RECEIPT_TIMEOUT_MS = 10_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** A connection refusal can be cold. Once connected, only a receipt can confirm a write. */
export async function sendAdminRequest(deps: AdminTransportDeps, req: Record<string, unknown>): Promise<AdminOutcome> {
  let pipe: string | undefined;
  try {
    const st: unknown = deps.readStatus === undefined
      ? JSON.parse(readFileSync(join(tcpDir(deps.baseDir), 'status-broker.json'), 'utf8'))
      : deps.readStatus();
    if (record(st) && st.state === 'running' && typeof st.pid === 'number' &&
      (deps.isProcessAlive ?? isProcessAlive)(st.pid) && typeof st.adminPipe === 'string' && st.adminPipe !== '') {
      pipe = st.adminPipe;
    }
  } catch {
    // Missing/unreadable status remains the existing cold path.
  }
  if (pipe === undefined) return { kind: 'cold' };
  const adminPipe = pipe;
  return new Promise<AdminOutcome>((resolve) => {
    let connected = false;
    let settled = false;
    let socket: AdminSocket;
    const finish = (result: AdminOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const missingReceipt = (): AdminOutcome => ({
      kind: 'failed',
      error: `管理插座 ${adminPipe} 已连上但 ${ADMIN_RECEIPT_TIMEOUT_MS / 1000}s 内无回执——broker 活着即台账唯一写者，绝不回落直写；核对 broker 状态后重试`,
    });
    const timer = setTimeout(() => finish(missingReceipt()), ADMIN_RECEIPT_TIMEOUT_MS);
    const connect = deps.connect ?? ((path, onConnect) => createConnection({ path }, onConnect));
    try {
      socket = connect(adminPipe, () => {
        connected = true;
        socket.write(`${JSON.stringify(req)}\n`);
      });
    } catch {
      clearTimeout(timer);
      resolve({ kind: 'cold' });
      return;
    }
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      try {
        const reply: unknown = JSON.parse(buf.slice(0, idx));
        if (!record(reply) || typeof reply.ok !== 'boolean') {
          finish({ kind: 'failed', error: '管理插座回执形状异常（缺 ok）' });
        } else {
          finish({ kind: 'hot', reply: { ...reply, ok: reply.ok } });
        }
      } catch {
        finish({ kind: 'failed', error: `管理插座回执不可解析：${buf.slice(0, 120)}` });
      }
    });
    socket.on('error', () => finish(connected ? missingReceipt() : { kind: 'cold' }));
    socket.on('close', () => finish(missingReceipt()));
  });
}
