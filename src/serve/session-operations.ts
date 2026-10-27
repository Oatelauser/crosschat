import { randomUUID } from 'node:crypto';
import type { SessionOperationFrame, SessionOperationResultFrame, SocketLike } from './protocol.js';

interface Pending {
  sender: SocketLike;
  target: SocketLike;
  request: SessionOperationFrame;
  timer: ReturnType<typeof setTimeout>;
  confirm(frame: SessionOperationResultFrame): SessionOperationResultFrame;
}
/** Bounded, exact socket routing. Cancellation never turns an issued write into a rollback. */
export class SessionOperationRoutes {
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly timeoutMs = 5_000) {}
  request(sender: SocketLike, target: SocketLike, request: SessionOperationFrame, confirm: Pending['confirm']): void {
    if (this.pending.size >= 64 || [...this.pending.values()].filter((item) => item.sender === sender).length >= 8) {
      this.reply(sender, request, 'rejected', '当前会话操作过多，请等待已发请求完成。'); return;
    }
    if ([...this.pending.values()].some((item) => item.sender === sender && item.request.id === request.id)) return;
    const id = randomUUID();
    const timer = setTimeout(() => this.finish(id, '操作等待超时；已发修改结果待核实，请刷新，勿自动重试。'), this.timeoutMs);
    this.pending.set(id, { sender, target, request, timer, confirm });
    try { target.send(JSON.stringify({ ...request, id })); }
    catch { this.finish(id, '节点连接中断，已发修改结果待核实。'); }
  }
  receive(target: SocketLike, frame: SessionOperationResultFrame): void {
    const entry = this.pending.get(frame.id);
    if (!entry || entry.target !== target || ['starId', 'machineId', 'providerId', 'nativeId'].some((key) => frame[key as 'starId'] !== entry.request[key as 'starId'])) return;
    this.pending.delete(frame.id); clearTimeout(entry.timer);
    try { entry.sender.send(JSON.stringify({ ...entry.confirm(frame), id: entry.request.id })); }
    catch { /* A disconnected caller must verify the result instead of replaying. */ }
  }
  private reply(socket: SocketLike, request: SessionOperationFrame, kind: 'rejected' | 'uncertain', message: string): void {
    const { id, starId, machineId, providerId, nativeId } = request;
    try { socket.send(JSON.stringify({ id, starId, machineId, providerId, nativeId, op: 'session-operation-result', result: { kind, message } })); }
    catch { /* Caller disconnected. */ }
  }
  private finish(id: string, message: string): void {
    const entry = this.pending.get(id); if (!entry) return;
    this.pending.delete(id); clearTimeout(entry.timer);
    this.cancel(entry.target, id);
    this.reply(entry.sender, entry.request, entry.request.request.kind === 'apply' ? 'uncertain' : 'rejected', message);
  }
  disconnect(socket: SocketLike): void {
    for (const [id, entry] of this.pending) {
      if (entry.sender === socket) { clearTimeout(entry.timer); this.pending.delete(id); this.cancel(entry.target, id); }
      else if (entry.target === socket) this.finish(id, '所选节点连接已中断；已发修改结果待核实。');
    }
  }
  private cancel(target: SocketLike, id: string): void {
    try { target.send(JSON.stringify({ op: 'session-operation-cancel', id })); } catch { /* Disconnected target. */ }
  }
  stop(): void { for (const id of this.pending.keys()) this.finish(id, '服务已停止；已发修改结果待核实。'); }
}
