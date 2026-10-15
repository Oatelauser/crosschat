import { MultichatError } from './errors.js';
import type { ClaudeSessionEntry } from './claude/registry.js';
import type { CodexThreadSummary } from './codex/client.js';

/**
 * `--to <name>` resolution (ticket 003): exact match on the claude registry
 * first, then codex thread names. Any ambiguity (duplicates on one side, or
 * the same name on both sides) is NAME_COLLISION with candidates; no match is
 * NAME_NOT_FOUND listing every currently available name.
 *
 * Names always win over ids: only when exact-name matching misses on both
 * sides do we try codex thread id addressing (optional `codex/` prefix + id8
 * or full lowercase uuid) so unnamed `codex exec` threads stay reachable.
 *
 * D0 判定序：全名精确（字节不变）→ 前缀匹配（大小写不敏感、只前缀不包含，
 * 跨两侧已命名对象）→ 唯一命中投递 / 多命中列候选教完整名 / 零命中照旧走
 * id 寻址与 NAME_NOT_FOUND。
 */

export type ResolvedTarget =
  | { side: 'claude'; session: ClaudeSessionEntry }
  | { side: 'codex'; thread: CodexThreadSummary };

export function resolveTargetByName(
  name: string,
  sessions: readonly ClaudeSessionEntry[],
  threads: readonly CodexThreadSummary[],
): ResolvedTarget {
  const claudeMatches = sessions.filter((session) => session.name === name && session.sessionId !== '');
  if (claudeMatches.length > 1) {
    const candidates = claudeMatches.map((session) => `pid ${session.pid} (${session.sessionId})`).join(', ');
    throw new MultichatError(
      'NAME_COLLISION',
      `Multiple Claude sessions are named ${JSON.stringify(name)}: ${candidates}.`,
    );
  }
  const codexMatches = threads.filter((thread) => thread.name === name);
  if (codexMatches.length > 1) {
    const candidates = codexMatches.map((thread) => thread.id.slice(0, 8)).join(', ');
    throw new MultichatError(
      'NAME_COLLISION',
      `Multiple Codex threads are named ${JSON.stringify(name)}: ${candidates}.`,
    );
  }
  if (claudeMatches.length === 1 && codexMatches.length === 1) {
    throw new MultichatError(
      'NAME_COLLISION',
      `${JSON.stringify(name)} exists on both sides: claude pid ${claudeMatches[0].pid} and codex thread ${codexMatches[0].id.slice(0, 8)}.`,
    );
  }
  if (claudeMatches.length === 1) return { side: 'claude', session: claudeMatches[0] };
  if (codexMatches.length === 1) return { side: 'codex', thread: codexMatches[0] };
  // D0 前缀解析：精确未中才进场（空串前缀会命中一切，跳过）。命中对象跨
  // 两侧合并计数——唯一才投递，多候选按 NAME_COLLISION 列名单式报错。
  const lower = name.toLowerCase();
  if (lower !== '') {
    const claudePrefix = sessions.filter(
      (session) => session.name !== undefined && session.sessionId !== '' && session.name.toLowerCase().startsWith(lower),
    );
    const codexPrefix = threads.filter((thread) => thread.name !== null && thread.name.toLowerCase().startsWith(lower));
    const hits = claudePrefix.length + codexPrefix.length;
    if (hits === 1) {
      return claudePrefix.length === 1
        ? { side: 'claude', session: claudePrefix[0] }
        : { side: 'codex', thread: codexPrefix[0] };
    }
    if (hits > 1) {
      const candidates = [...claudePrefix.map((s) => s.name!), ...codexPrefix.map((t) => t.name!)]
        .map((n) => JSON.stringify(n))
        .join(', ');
      throw new MultichatError(
        'NAME_COLLISION',
        `Multiple agents match prefix ${JSON.stringify(name)}: ${candidates}. 用完整名重试。`,
      );
    }
  }
  const idMatch = /^(?:codex\/)?([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$/.exec(name);
  if (idMatch !== null) {
    const id = idMatch[1];
    if (id.length === 36) {
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread !== undefined) return { side: 'codex', thread };
    } else {
      const prefixed = threads.filter((candidate) => candidate.id.startsWith(id));
      if (prefixed.length === 1) return { side: 'codex', thread: prefixed[0] };
      if (prefixed.length > 1) {
        throw new MultichatError(
          'NAME_COLLISION',
          `Multiple Codex threads match id prefix ${JSON.stringify(name)}: ${prefixed.map((thread) => thread.id).join(', ')}. Use the full id to address one.`,
        );
      }
    }
  }
  throw new MultichatError(
    'NAME_NOT_FOUND',
    `No agent named ${JSON.stringify(name)}. ${describeAvailableNames(sessions, threads)}`,
  );
}

/**
 * 018 会话级星成员的 id 定位（跨机直达投递用）：claude 注册表按 sessionId、
 * codex 按线程 id 各查一次——成员键是会话 ID，名字只是句柄，id 命中即投递，
 * 绝无同名歧义。零命中=成员已死/不在本机（聚合器活性核验漏网或刚除名）。
 */
export function resolveTargetById(
  sessionId: string,
  sessions: readonly ClaudeSessionEntry[],
  threads: readonly CodexThreadSummary[],
): ResolvedTarget {
  const claude = sessions.find((session) => session.sessionId === sessionId);
  if (claude !== undefined) return { side: 'claude', session: claude };
  const codex = threads.find((thread) => thread.id === sessionId);
  if (codex !== undefined) return { side: 'codex', thread: codex };
  throw new MultichatError(
    'TARGET_NOT_FOUND',
    `会话 ${sessionId.slice(0, 8)} 不在本机（claude 进程退出或 codex 线程不存在）——成员可能刚被聚合器除名，稍后重试或改用名字投递`,
  );
}

function describeAvailableNames(
  sessions: readonly ClaudeSessionEntry[],
  threads: readonly CodexThreadSummary[],
): string {
  const claudeNames = sessions.flatMap((session) =>
    session.name !== undefined && session.sessionId !== '' ? [session.name] : [],
  );
  const namedThreads = threads.flatMap((thread) => (thread.name !== null ? [thread.name] : []));
  const unnamed = threads.length - namedThreads.length;
  const claudeList = claudeNames.map((name) => JSON.stringify(name)).join(', ') || '(no named sessions)';
  const codexList = namedThreads.map((name) => JSON.stringify(name)).join(', ') || '(no named threads)';
  return `Available names — claude: ${claudeList}; codex: ${codexList}${unnamed > 0 ? ` (+${unnamed} unnamed)` : ''}.${unnamed > 0 ? ' Unnamed codex threads can be addressed by id8 or full id (see crosschat status).' : ''}`;
}
