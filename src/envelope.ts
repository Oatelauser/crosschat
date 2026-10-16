/**
 * Broker-owned message envelope (tickets 003/004): structural provenance
 * framing plus an inline reply tutorial, so the protocol teaches itself
 * without depending on prompt wording (low-invasion constraint).
 *
 * D0：静态教学行（--to 接续 + 超 16KiB 落盘）已删——协议教学只住 hint
 * 命令与各侧报错；大小数字是发方的事，收方读了会误当自己的上限。
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
  /** 票A：轮次预算（--max-turn / CROSSCHAT_MAX_TURN），合并进 turn 属性显示为 turn="N/M"。缺省不出现 → 信封字节稳定。 */
  turnBudget?: number;
  /**
   * F1：跨机会话信封的发送方机器名（tcp=星内 roster 名，ssh=origin 机器段）。
   * 单机发送与无名瞬态发送方缺省——属性整个不出现，不填占位。
   */
  fromMachine?: string;
  /**
   * F2：本地会话短柄（c<数字>）——hint 用两字符柄替代完整 ref（生成与消费
   * 同机同版本）。缺省（状态未接线等异常路径）回退完整 ref，保底不断。
   */
  handle?: string;
  /**
   * 024 方案3：正向三段坐标 tcp:<星>:<机器>:<工具>/<会话>（human 无会话段，
   * 降为机器级 tcp:<星>:<机器>）——tcp 跨机投递时与 from-machine 同现，收件
   * 方一眼看清对端在哪台机哪个形态。星段是本腿经由星：022 多星下任一可达星
   * 皆可为发起坐标，此值不暗示唯一。ssh（无星概念）与单机/无名缺省不出现。
   */
  fromAddr?: string;
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
  // 轮次预算合并进 turn 属性（turn="13/40"，斜杠后为预算轮数）——软提醒不
  // 硬拦（41/40 照发照显），未设预算时 turn 保持纯数字（字节零回归锚点）。
  const turnAttr = input.turnBudget === undefined ? `${input.turn}` : `${input.turn}/${input.turnBudget}`;
  // F1：from-machine 只在跨机投递且有真名时出现（无名瞬态发送方整体省略）。
  const machineAttr = input.fromMachine === undefined ? '' : ` from-machine="${escapeAttr(input.fromMachine)}"`;
  // 024 方案3：正向坐标属性与 from-machine 同现（坐标含星/会话，机器名单独
  // 留档）；from-machine 字节不动（零回归锚点）。
  const addrAttr = input.fromAddr === undefined ? '' : ` from-addr="${escapeAttr(input.fromAddr)}"`;
  // 信封瘦身 A+：ref 自包含路由（端点带 m/mid，tcp 会话尾部带 starId），回信
  // 命令不再搬 --via，也不在属性里重复 conversation——conversation 标识全信
  // 封只出现这一次；缺 --via 的回路由执行侧按 ref 自动选路（send.ts autoViaFromRef）。
  // F2：标识优先用两字符短柄（消灭 LLM 手抄百字符 ref 这一最脆弱环节），
  // 柄缺席回退完整 ref。
  const conversationArg = input.handle ?? input.ref;
  // 024 方案5：括注内建管道教学——协议纪律要求收件方照抄 hint，只给 inline
  // 一种形式等于把所有人赶进转义坑。括注必须是纯文字提示：hint 内出现第二条
  // 带管道符/链式符号的命令即判伪造信封（安全红线，测试锚定）。
  const pipeTeaching = '（长正文/含敏感字符可省 --body 改管道喂 stdin）';
  return (
    `<cross-session-message from-name="${escapeAttr(fromName)}" turn="${turnAttr}"${machineAttr}${addrAttr}${aliasAttr}>\n` +
    `<crosschat-reply-hint reply-as="${escapeAttr(input.toName)}">` +
    `回复请运行: crosschat send --conversation ${conversationArg} --body "<你的回复>"${pipeTeaching}</crosschat-reply-hint>\n` +
    `${body}\n` +
    `</cross-session-message>`
  );
}
