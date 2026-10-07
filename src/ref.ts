import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { MultichatError } from './errors.js';

/**
 * Self-contained conversation reference (ticket 003): both endpoints' native
 * ids plus a nonce and turn counter — no server state is consulted to route a
 * reply. B2 (008): endpoints carry an optional machine field `m` (hostname;
 * absent = local machine), and encoding moved to the compact
 * `mc2_<base64url(binary)>` (~84 chars vs mc1_'s ~290) because every
 * envelope carries the ref verbatim and agents copy it per turn. mc1_
 * payloads decode forever: old envelopes, shards and send-logs never expire.
 */

/** human has no routable native id; claude/codex always carry one. */
export type RefEndpoint =
  | { p: 'human' }
  | { p: 'claude' | 'codex'; id: string; m?: string; mid?: string };

export interface ConversationRef {
  v: 1;
  /** Conversation initiator. */
  f: RefEndpoint;
  /** First recipient. */
  t: RefEndpoint;
  /** Random hex identifying the conversation; stable across turns. */
  n: string;
  /** Turn number of the message this ref was issued with (>= 1). */
  c: number;
}

export const REF_PREFIX = 'mc1_';
export const REF_PREFIX_V2 = 'mc2_';

function invalid(why: string, skewHint = false): MultichatError {
  const hint = skewHint ? ' 若本条来自对端机器，可能是对端 crosschat 版本较新——升级本机 crosschat 后重试回复。' : '';
  return new MultichatError('INVALID_CONVERSATION_REF', `Malformed conversation reference (${why}).${hint}`);
}

export function newConversationRef(f: RefEndpoint, t: RefEndpoint): ConversationRef {
  return { v: 1, f, t, n: randomBytes(8).toString('hex'), c: 1 };
}

/** Ref for the next message in the same conversation: same endpoints/nonce, c+1. */
export function nextTurnRef(ref: ConversationRef): ConversationRef {
  return { ...ref, c: ref.c + 1 };
}

// ---- mc2 binary layout (008 B2 design §6 + B10 mid) ------------------------
// flags   LEB128 varint: bits 0-1 f type | bits 2-3 t type | bit 4 f id raw |
//         bit 5 t id raw | bit 6 f.m present | bit 7 t.m present | bit 8
//         f.mid present | bit 9 t.mid present  (claude=0 codex=1 human=2)
// then    f.id (16B UUID | varint-len utf8) · t.id (same)
//         f.m (varint-len utf8)? · t.m (varint-len utf8)?
//         f.mid (varint-len utf8)? · t.mid (varint-len utf8)?
//         n (varint-len hex bytes) · c (varint)
// Lengths are LEB128 varints so nothing has a hidden ceiling; a dashed
// lowercase uuid packs to 16 raw bytes (the overwhelmingly common case),
// anything else falls back to the string path and round-trips verbatim.
// Layout changes are free until mc2 ships in a npm release (v1.3.3 window).

const TYPE_CODES = { claude: 0, codex: 1, human: 2 } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function writeVarint(value: number, out: number[]): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function packId(endpoint: RefEndpoint): { bytes: Buffer; raw: boolean } {
  if (endpoint.p === 'human') return { bytes: Buffer.alloc(0), raw: false };
  if (UUID_RE.test(endpoint.id)) {
    return { bytes: Buffer.from(endpoint.id.replace(/-/g, ''), 'hex'), raw: false };
  }
  const body = Buffer.from(endpoint.id, 'utf8');
  const len: number[] = [];
  writeVarint(body.length, len);
  return { bytes: Buffer.concat([Buffer.from(len), body]), raw: true };
}

function unpackUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function packStr(value: string): Buffer {
  const body = Buffer.from(value, 'utf8');
  const len: number[] = [];
  writeVarint(body.length, len);
  return Buffer.concat([Buffer.from(len), body]);
}

function packHex(value: string): Buffer {
  let body: Buffer;
  try {
    body = Buffer.from(value, 'hex');
  } catch {
    throw invalid('nonce is not hex');
  }
  const len: number[] = [];
  writeVarint(body.length, len);
  return Buffer.concat([Buffer.from(len), body]);
}

export function encodeRef(ref: ConversationRef): string {
  const mOf = (ep: RefEndpoint): string | undefined => (ep.p === 'human' ? undefined : ep.m);
  const midOf = (ep: RefEndpoint): string | undefined => (ep.p === 'human' ? undefined : ep.mid);
  const fId = packId(ref.f);
  const tId = packId(ref.t);
  const fm = mOf(ref.f);
  const tm = mOf(ref.t);
  const fmid = midOf(ref.f);
  const tmid = midOf(ref.t);
  const flags =
    TYPE_CODES[ref.f.p] |
    (TYPE_CODES[ref.t.p] << 2) |
    (fId.raw ? 0x10 : 0) |
    (tId.raw ? 0x20 : 0) |
    (fm !== undefined ? 0x40 : 0) |
    (tm !== undefined ? 0x80 : 0) |
    (fmid !== undefined ? 0x100 : 0) |
    (tmid !== undefined ? 0x200 : 0);
  const flagBytes: number[] = [];
  writeVarint(flags, flagBytes);
  const parts: Buffer[] = [Buffer.from(flagBytes), fId.bytes, tId.bytes];
  if (fm !== undefined) parts.push(packStr(fm));
  if (tm !== undefined) parts.push(packStr(tm));
  if (fmid !== undefined) parts.push(packStr(fmid));
  if (tmid !== undefined) parts.push(packStr(tmid));
  parts.push(packHex(ref.n)); // raw bytes; a mc1-era nonce round-trips byte-exact
  const turn: number[] = [];
  writeVarint(ref.c, turn);
  parts.push(Buffer.from(turn));
  return REF_PREFIX_V2 + Buffer.concat(parts).toString('base64url');
}

/** Strict structural validation; anything malformed is INVALID_CONVERSATION_REF. */
export function decodeRef(encoded: string): ConversationRef {
  if (encoded.startsWith(REF_PREFIX_V2)) {
    return decodeV2(encoded.slice(REF_PREFIX_V2.length));
  }
  if (encoded.startsWith(REF_PREFIX)) {
    return decodeV1(encoded.slice(REF_PREFIX.length));
  }
  throw invalid('missing mc1_/mc2_ prefix');
}

/** Cursor over the mc2 payload: every read is bounds-checked (truncation = skew or corruption). */
class Cursor {
  private at = 0;
  constructor(private readonly buf: Buffer) {}
  byte(): number {
    if (this.at >= this.buf.length) throw invalid('truncated payload', true);
    return this.buf[this.at++]!;
  }
  take(count: number): Buffer {
    if (this.at + count > this.buf.length) throw invalid('truncated payload', true);
    const out = this.buf.subarray(this.at, this.at + count);
    this.at += count;
    return out;
  }
  varint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return value;
      shift += 7;
      if (shift > 35) throw invalid('varint overflow', true);
    }
  }
  field(): Buffer {
    return this.take(this.varint());
  }
  done(): boolean {
    return this.at === this.buf.length;
  }
}

function decodeV2(payload: string): ConversationRef {
  let buf: Buffer;
  try {
    buf = Buffer.from(payload, 'base64url');
  } catch {
    throw invalid('bad base64url payload', true);
  }
  if (buf.length === 0) throw invalid('empty payload', true);
  const cur = new Cursor(buf);
  const flags = cur.varint();
  // Field order must mirror encodeRef exactly: f.id, t.id, f.m, t.m, f.mid, t.mid, n, c.
  const readId = (typeBits: number, rawBit: number): { p: 'claude' | 'codex'; id: string } | { p: 'human' } => {
    if (typeBits === TYPE_CODES.human) return { p: 'human' };
    if (typeBits !== TYPE_CODES.claude && typeBits !== TYPE_CODES.codex) {
      throw invalid(`unknown endpoint type ${typeBits}`, true);
    }
    const p = typeBits === TYPE_CODES.claude ? 'claude' : 'codex';
    const id = (flags & rawBit) === 0 ? unpackUuid(cur.take(16)) : cur.field().toString('utf8');
    if (id === '') throw invalid('empty endpoint id', true);
    return { p, id };
  };
  const f0 = readId(flags & 0x03, 0x10);
  const t0 = readId((flags >> 2) & 0x03, 0x20);
  const fm = (flags & 0x40) === 0 ? undefined : cur.field().toString('utf8');
  const tm = (flags & 0x80) === 0 ? undefined : cur.field().toString('utf8');
  const fmid = (flags & 0x100) === 0 ? undefined : cur.field().toString('utf8');
  const tmid = (flags & 0x200) === 0 ? undefined : cur.field().toString('utf8');
  const f: RefEndpoint = fm === undefined && fmid === undefined ? f0 : { ...f0, ...(fm === undefined ? {} : { m: fm }), ...(fmid === undefined ? {} : { mid: fmid }) } as RefEndpoint;
  const t: RefEndpoint = tm === undefined && tmid === undefined ? t0 : { ...t0, ...(tm === undefined ? {} : { m: tm }), ...(tmid === undefined ? {} : { mid: tmid }) } as RefEndpoint;
  const nBytes = cur.field();
  const n = nBytes.toString('hex');
  if (n === '') throw invalid('missing nonce', true);
  const c = cur.varint();
  if (!Number.isInteger(c) || c < 1) throw invalid('bad turn counter', true);
  if (!cur.done()) throw invalid('trailing bytes', true);
  return { v: 1, f, t, n, c };
}

function decodeV1(payload: string): ConversationRef {
  let json: string;
  try {
    json = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    throw invalid('bad base64url payload');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw invalid('payload is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('payload is not an object');
  const value = raw as Record<string, unknown>;
  if (value.v !== 1) throw invalid('unsupported version');
  const n = value.n;
  if (typeof n !== 'string' || n === '') throw invalid('missing nonce');
  const c = value.c;
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 1) throw invalid('bad turn counter');
  return { v: 1, f: validateEndpoint(value.f, 'f'), t: validateEndpoint(value.t, 't'), n, c };
}

function validateEndpoint(value: unknown, where: 'f' | 't'): RefEndpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${where}: not an object`);
  }
  const ep = value as Record<string, unknown>;
  if (ep.p === 'human') {
    if (ep.id !== undefined && ep.id !== null) throw invalid(`${where}: human endpoint must not carry an id`);
    return { p: 'human' };
  }
  if ((ep.p === 'claude' || ep.p === 'codex') && typeof ep.id === 'string' && ep.id !== '') {
    // m is optional and mc1 JSON never carries it, but tolerate it if present.
    return ep.m === undefined || typeof ep.m !== 'string'
      ? { p: ep.p, id: ep.id }
      : { p: ep.p, id: ep.id, m: ep.m };
  }
  throw invalid(`${where}: unknown side or missing id`);
}
