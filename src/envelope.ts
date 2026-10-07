/**
 * Broker-owned message envelope (tickets 003/004): structural provenance
 * framing plus an inline reply tutorial, so the protocol teaches itself
 * without depending on prompt wording (low-invasion constraint).
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
  return (
    `<cross-session-message from-name="${escapeAttr(fromName)}" turn="${input.turn}"${aliasAttr}>\n` +
    `<crosschat-reply-hint conversation="${input.ref}" reply-as="${escapeAttr(input.toName)}">` +
    `回复请运行: crosschat send${via} --conversation ${input.ref} --body "<你的回复>"</crosschat-reply-hint>\n` +
    `新话题或对话已推进时: crosschat send --to <名字> --body "..."（--to 自动接续该端对最近对话）；超 16KiB 请写文件后只发路径\n` +
    `${body}\n` +
    `</cross-session-message>`
  );
}
