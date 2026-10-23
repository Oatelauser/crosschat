import { randomBytes } from 'node:crypto';
import type { NodeNameResultFrame, SocketLike } from './protocol.js';

export interface NodeNameTarget { socket: SocketLike; starId: string; machineId: string }
export interface NodeNameReceipt {
  ok: boolean;
  uncertain?: boolean;
  error?: string;
  renamed?: boolean;
  starId?: string;
  machineId?: string;
  showName?: string;
  name?: string;
  saved?: boolean;
  applied?: boolean;
}
interface PendingName {
  target: NodeNameTarget;
  showName: string;
  apply(name: string | undefined): void;
  finish(reply: NodeNameReceipt): void;
}
const unknown = (): NodeNameReceipt => ({ ok: false, uncertain: true, error: '对端改名未取得完整保存及生效回执，结果待核实；不要自动重试。' });

/** Owns each online mutation's exact socket, bounded wait and receipt; it never queues offline writes. */
export class NodeNameChanges {
  private readonly pending = new Map<string, PendingName>();
  constructor(private readonly timeoutMs = 5_000) {}

  request(target: NodeNameTarget, showName: string, apply: PendingName['apply']): Promise<NodeNameReceipt> {
    if (this.pending.size >= 64 || [...this.pending.values()].some((entry) => entry.target.starId === target.starId && entry.target.machineId === target.machineId)) {
      return Promise.resolve({ ok: false, error: '该节点已有改名请求等待确认，请先核实其结果。' });
    }
    return new Promise((resolve) => {
      const id = randomBytes(16).toString('hex');
      const finish = (reply: NodeNameReceipt) => { clearTimeout(timer); this.pending.delete(id); resolve(reply); };
      const timer = setTimeout(() => finish(unknown()), this.timeoutMs);
      this.pending.set(id, { target, showName, apply, finish });
      try { target.socket.send(JSON.stringify({ op: 'node-name-set', id, starId: target.starId, machineId: target.machineId, name: showName })); }
      catch { finish(unknown()); }
    });
  }

  receive(socket: SocketLike, frame: NodeNameResultFrame): void {
    const entry = this.pending.get(frame.id);
    if (!entry || entry.target.socket !== socket || frame.starId !== entry.target.starId || frame.machineId !== entry.target.machineId) return;
    if (!frame.ok) { entry.finish(frame.saved || frame.applied ? unknown() : { ok: false, error: '对端未保存当前星节点名称；请检查该节点的配置。' }); return; }
    if (!frame.saved || !frame.applied || frame.showName !== entry.showName || (entry.showName !== '' && frame.name !== entry.showName)) { entry.finish(unknown()); return; }
    try { entry.apply(frame.name); }
    catch { entry.finish(unknown()); return; }
    entry.finish({ ok: true, renamed: true, starId: frame.starId, machineId: frame.machineId, showName: frame.showName, ...(frame.name === undefined ? {} : { name: frame.name }), saved: true, applied: true });
  }

  disconnect(socket: SocketLike): void {
    for (const entry of [...this.pending.values()]) if (entry.target.socket === socket) entry.finish(unknown());
  }
  stop(): void { for (const entry of [...this.pending.values()]) entry.finish(unknown()); }
}
