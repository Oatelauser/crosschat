/**
 * Broker-owned message envelope (tickets 003/004): structural provenance
 * framing plus an inline reply tutorial, so the protocol teaches itself
 * without depending on prompt wording (low-invasion constraint).
 *
 * 票A 第六单政策：上限教学行永远静态"超 16KiB"——信封的读者是收方，数字
 * 是发方的，动态值教错人（收方会误当自己的上限）；宁可少报不会错（提额
 * 世界里大内容要么直接发成功、要么报错报出本机准确值）。准确数字只住各侧
 * 自己的报错里，信封只教方向不教数字。
 */

/** Claude trims very long from-names; keep ours within 64 codepoints. */
export const FROM_NAME_MAX_CODEPOINTS = 64;

/**
 * Tags the envelope protocol owns. Occurrences in the body are rewritten with
 * a `<\` prefix (embassy-style) so a body cannot forge envelope framing.
 * `multichat-*` stays reserved so bodies quoting envelopes from legacy
 * sessions (pre-rename) are neutralized just the same.
 */
const RESERVED_TAG_PATTERN = /<(?=\/?(?:cross-session-message|multichat-[a-z0-9-]*|crosschat-[a-z0-9-]*)(?:[>\s/]|$))/giu;

export interface EnvelopeInput {
  /** Sender display name (claude session name, codex/<id8>, or "human"). */
  fromName: string;
  /** Recipient display name, shown as reply-as. */
  toName: string;
  /** Turn number of this message (>= 1). */
  turn: number;
  /** Encoded conversation ref the recipient uses to reply. */
  ref: string;
  body: string;
  /**
   * Federation (008 B2): machine the reply must travel to — the sender
   * endpoint's `m` when it differs from this machine's hostname. Absent =
   * same machine, and the reply-hint stays byte-identical to the
   * single-machine form (no --to, D5: the ref already names both ends).
   */
  viaHost?: string;
  /** 票A：轮次预算（--max-turn / CROSSCHAT_MAX_TURN），合并进 turn 属性显示为 turn="N/M"。缺省不出现 → 信封字节稳定。 */
  turnBudget?: number;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function neutralizeReservedTags(body: string): string {
  return body.replace(RESERVED_TAG_PATTERN, '<\\');
}

export function composeEnvelope(input: EnvelopeInput): string {
  const codepoints = [...input.fromName];
  const shortened = codepoints.length > FROM_NAME_MAX_CODEPOINTS;
  const fromName = shortened ? codepoints.slice(0, FROM_NAME_MAX_CODEPOINTS).join('') : input.fromName;
  const aliasAttr = shortened ? ` from-alias="${escapeAttr(input.fromName)}"` : '';
  const body = neutralizeReservedTags(input.body);
  const via = input.viaHost === undefined ? '' : ` --via ssh:${input.viaHost}`;
  // 轮次预算合并进 turn 属性（turn="13/40"，斜杠后为预算轮数）——软提醒不
  // 硬拦（41/40 照发照显），未设预算时 turn 保持纯数字（字节零回归锚点）。
  const turnAttr = input.turnBudget === undefined ? `${input.turn}` : `${input.turn}/${input.turnBudget}`;
  return (
    `<cross-session-message from-name="${escapeAttr(fromName)}" turn="${turnAttr}"${aliasAttr}>\n` +
    `<crosschat-reply-hint conversation="${input.ref}" reply-as="${escapeAttr(input.toName)}">` +
    `回复请运行: crosschat send${via} --conversation ${input.ref} --body "<你的回复>"</crosschat-reply-hint>\n` +
    `新话题或对话已推进时: crosschat send --to <名字> --body "..."（--to 自动接续该端对最近对话）；超 16KiB 请写文件后只发路径\n` +
    `${body}\n` +
    `</cross-session-message>`
  );
}
