/**
 * 022 本进程虚拟连接对（broker 自挂聚合器）：一对互背的 SocketLike——A 端
 * 给 NodeClient、B 端给 Broker.admitLocal，send 即对侧 message 事件，零
 * 回环 TCP/WS（方向 3：省回环 WS 与第二个常驻进程）。行为约定对齐 ws 客户端
 * 两侧的最小面：message 先到先缓冲（监听挂上后回放）、close 双向广播、ping
 * 立即回 pong（broker 心跳永不会误杀）。
 */
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { WebSocket } from 'ws';
import type { SocketLike } from './protocol.js';

export class VirtualSocket extends EventEmitter implements SocketLike {
  readyState: number = WebSocket.OPEN;
  private peer?: VirtualSocket;
  /** 对侧先到的帧（本侧还没挂 message 监听）——挂上后按序回放。 */
  private early: string[] = [];
  private listening = false;

  static pair(): [VirtualSocket, VirtualSocket] {
    const a = new VirtualSocket();
    const b = new VirtualSocket();
    a.peer = b;
    b.peer = a;
    // open 在下一轮宏任务发射：两侧监听都在本同步块内挂好（工厂返回→注册），
    // 时序与真 ws 一致（open 永远晚于首组监听注册）。
    setImmediate(() => {
      a.emit('open');
      b.emit('open');
    });
    return [a, b];
  }

  send(data: string, cb?: () => void): void {
    this.peer?.ingest(data);
    cb?.();
  }

  /** 对侧发来的帧：无监听先缓冲（NodeClient 构造与 info 帧之间存在窗口）。 */
  private ingest(data: string): void {
    if (!this.listening) {
      this.early.push(data);
      return;
    }
    this.emit('message', data);
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    this.flushEarly(event);
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    super.once(event, listener);
    this.flushEarly(event);
    return this;
  }

  private flushEarly(event: string): void {
    if (event !== 'message') return;
    this.listening = true;
    if (this.early.length === 0) return;
    const pending = this.early;
    this.early = [];
    for (const frame of pending) this.emit('message', frame);
  }

  ping(): void {
    // broker 心跳探测：虚拟连接恒活——同步回 pong
    this.emit('pong');
  }

  terminate(): void {
    this.close();
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close', 1000, 'virtual close');
    this.peer?.peerClosed();
  }

  private peerClosed(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close', 1000, 'virtual close');
  }
}
