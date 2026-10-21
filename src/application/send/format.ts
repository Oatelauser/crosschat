import type { SendResult } from './types.js';

/** Existing CLI and wire formatting; never used to recover application data. */
export function formatSendResult(result: SendResult, json = false): string {
  const { receipt, route, handle } = result;
  if (json) return JSON.stringify(result.warning === undefined ? receipt : { ...receipt, warning: result.warning });
  const to = route?.displayTo ?? receipt.to;
  let output: string;
  if (receipt.status === 'parked') {
    const location = route === undefined ? '' : `（位于 ${route.machine}）`;
    output = [
      `已寄存给 ${to}（对方忙，未送达）。队列共 ${receipt.queue ?? 1} 条，看门狗每 0.5–5 分钟自动重试，无需手动 status。`,
      `人工随时可读滞留内容: ${receipt.mailbox ?? ''}${location}`,
      handle === undefined ? `reply-ref: ${receipt.replyRef}` : `续话: ${handle}`,
    ].join('\n');
  } else {
    const tail = handle === undefined ? `\nreply-ref: ${receipt.replyRef}` : ` · 续话 ${handle}`;
    const turn = route?.kind === 'tcp' ? receipt.turn ?? '?' : receipt.turn;
    // Preserve the old SSH formatter's status-only handling of older remote receipts.
    const queued = route === undefined ? result.status === 'queued' : receipt.status === 'queued';
    output = queued
      ? `queued to ${to} (turn ${turn}; 对方正忙，已入队，本轮结束即处理)${tail}`
      : `delivered to ${to} (turn ${turn})${tail}`;
    if (route === undefined) {
      if (queued) output += '\n已入对方服务端队列，本轮结束即处理；终态可查 crosschat status --conversations';
      else if (result.confirmation === 'unconfirmed') output += '\n回执: 暂未在对方会话记录中确认（可能仍在落盘）；稍后查 send-log.jsonl 或重跑 status';
    }
  }
  if (result.automaticFile !== undefined) output += `\n正文超限已自动转文件通道：${result.automaticFile}`;
  if (result.warning !== undefined) output += `\n${result.warning}`;
  return output;
}
