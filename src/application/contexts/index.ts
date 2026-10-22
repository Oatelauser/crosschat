/** Read-only entry configuration; a configured context is not an authenticated connection. */
import { createHash } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { parseNodeConfig } from '../../serve/node-config.js';
import { abortError, queryError, readParsed } from '../queries/reading.js';
import type { QueryError, TextOptions } from '../queries/reading.js';

export { loadTuiPreferences, saveTuiPreferences } from './preferences.js';
export type { TuiPreferences, TuiPreferencesOptions, SaveTuiPreferencesOptions } from './preferences.js';

export interface TuiConnection {
  id: string;
  /** Open for future context adapters; the entry UI must not infer permissions from this value. */
  kind: string;
  name: string;
  target: string;
  identityHint: string;
  attributes: Readonly<Record<string, unknown>>;
}

export interface ListTuiContextsOptions extends TextOptions {
  home?: string;
  hostname?: () => string;
}

export interface TuiContextsResult {
  items: TuiConnection[];
  errors: QueryError[];
  observedAt: number;
}

/** Tokenize Host arguments only, without evaluating any other SSH directive. */
function hostTokens(raw: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quoted = false;
  let escaped = false;
  for (const char of raw) {
    if (escaped) {
      token += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === '#') {
      break;
    } else if (!quoted && /\s/.test(char)) {
      if (token !== '') tokens.push(token);
      token = '';
    } else {
      token += char;
    }
  }
  if (quoted || escaped) throw new Error('Invalid Host arguments');
  if (token !== '') tokens.push(token);
  return tokens;
}

function sshContexts(raw: string, source: string): TuiConnection[] {
  if (raw.includes('\0')) throw new Error('Invalid SSH configuration');
  const aliases = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*Host(?:\s*=\s*|\s+|$)(.*)$/i.exec(line);
    if (match === null) continue;
    const tokens = hostTokens(match[1]!);
    if (tokens.length === 0) throw new Error('Missing Host arguments');
    for (const alias of tokens) {
      if (!alias.startsWith('!') && !/[*?\s]/.test(alias) && !alias.includes('[') && !alias.includes(']')) aliases.add(alias);
    }
  }
  return [...aliases].map((alias) => ({
    id: `ssh:${encodeURIComponent(alias)}`,
    kind: 'ssh',
    name: alias,
    target: alias,
    identityHint: 'SSH 配置别名；身份尚未核实',
    attributes: { source, coverage: 'host-aliases-only' },
  }));
}

function tcpContexts(raw: string, source: string): TuiConnection[] {
  const config = parseNodeConfig(raw, source);
  const contexts = new Map<string, TuiConnection>();
  for (const entry of config.entries) {
    const host = entry.host.includes(':') && !entry.host.startsWith('[') ? `[${entry.host}]` : entry.host;
    const endpoint = `${host}:${entry.port}`;
    const starId = entry.starId === '' ? undefined : entry.starId;
    // Different unknown-star credentials may name different identities at the same broker.
    // Keep the digest opaque and never put the credential or its presence in attributes.
    const id = starId === undefined
      ? `tcp:endpoint:${encodeURIComponent(endpoint)}:${createHash('sha256').update(entry.key).digest('hex')}`
      : `tcp:star:${encodeURIComponent(starId)}:${encodeURIComponent(endpoint)}`;
    if (contexts.has(id)) continue;
    contexts.set(id, {
      id,
      kind: 'tcp',
      name: entry.name || endpoint,
      target: endpoint,
      identityHint: 'TCP 配置；身份尚未核实',
      attributes: { source, host: entry.host, port: entry.port, ...(starId === undefined ? {} : { starId }) },
    });
  }
  return [...contexts.values()];
}

export async function listTuiContexts(options: ListTuiContextsOptions = {}): Promise<TuiContextsResult> {
  const home = options.home ?? homedir();
  const observedAt = (options.now ?? Date.now)();
  const local: TuiConnection = {
    id: 'local', kind: 'local', name: '本机', target: (options.hostname ?? hostname)(),
    identityHint: '当前本机环境', attributes: {},
  };
  const ssh = join(home, '.ssh', 'config');
  const node = join(home, '.crosschat', 'tcp', 'node.json');
  const results = await Promise.all([
    readParsed(ssh, (raw) => sshContexts(raw, ssh), options),
    readParsed(node, (raw) => tcpContexts(raw, node), options),
  ]);
  if (options.signal?.aborted) {
    return { items: [local], errors: [ssh, node].map((source) => queryError(source, abortError())), observedAt };
  }
  return {
    items: [local, ...results.flatMap((result) => result.value ?? [])],
    errors: results.flatMap((result) => result.errors).filter((error) => error.kind !== 'missing'),
    observedAt,
  };
}
