import { join } from 'node:path';
import { queryBroker } from './broker.js';
import type { StarSummary } from './broker.js';
import { cancellable, checkAbort, isRecord, queryError } from './reading.js';
import type { QueryError, TextOptions } from './reading.js';
import type { CollectionResult } from './services.js';

export interface StarSession {
  sessionId: string;
  name?: string;
  tool?: string;
}

export interface StarMachine {
  mid8: string;
  online: boolean;
  name?: string;
  /** Absent on old endpoints; absence does not mean an empty member set. */
  sessions?: StarSession[];
  offlineSessions?: StarSession[];
}

export interface StarView {
  star: StarSummary;
  machines: StarMachine[];
  onlineNodes: number | null;
  health: 'reachable' | 'unavailable' | 'unknown';
}

export interface StarQueryOptions extends TextOptions {
  tcpDir: string;
  /**
   * Optional authoritative roster capability. The context adapter owns network
   * timeouts/connections and must release them on signal cancellation.
   */
  readRoster?(star: StarSummary, signal?: AbortSignal): Promise<unknown>;
}

function sessions(value: unknown): StarSession[] {
  if (!Array.isArray(value)) throw new Error('Invalid session list');
  return value.map((session: unknown) => {
    if (!isRecord(session) || typeof session.sessionId !== 'string' || session.sessionId === ''
      || (session.name !== undefined && typeof session.name !== 'string')
      || (session.tool !== undefined && typeof session.tool !== 'string')) {
      throw new Error('Invalid session');
    }
    return {
      sessionId: session.sessionId,
      ...(session.name === undefined ? {} : { name: session.name }),
      ...(session.tool === undefined ? {} : { tool: session.tool }),
    };
  });
}

/** Validate this boundary without changing the existing wire parser. */
function machines(value: unknown): StarMachine[] {
  if (!Array.isArray(value)) throw new Error('Invalid roster');
  return value.map((machine: unknown) => {
    if (!isRecord(machine) || typeof machine.mid8 !== 'string' || machine.mid8 === ''
      || typeof machine.online !== 'boolean'
      || (machine.name !== undefined && typeof machine.name !== 'string')) {
      throw new Error('Invalid machine');
    }
    return {
      mid8: machine.mid8, online: machine.online,
      ...(machine.name === undefined ? {} : { name: machine.name }),
      ...(machine.sessions === undefined ? {} : { sessions: sessions(machine.sessions) }),
      ...(machine.offlineSessions === undefined ? {} : { offlineSessions: sessions(machine.offlineSessions) }),
    };
  });
}

function rosterIssue(source: string, kind: 'unavailable' | 'malformed', message: string): QueryError {
  return {
    source, kind, message,
    nextStep: kind === 'malformed' ? '检查该星读取端返回的机器与会话字段' : '检查该星的读取能力、连接或读取端版本',
  };
}

/**
 * Compose static, secret-free broker metadata with an optional live authority.
 * No default network IO. One roster call at a time; a failed star does not erase
 * other stars. Cancellable races discard uncooperative readers' late results.
 */
export async function queryStars(options: StarQueryOptions): Promise<CollectionResult<StarView>> {
  const observedAt = (options.now ?? Date.now)();
  const items: StarView[] = [];
  const errors: QueryError[] = [];
  const broker = await queryBroker({ ...options, now: () => observedAt });
  if (broker.value === null) {
    return { items, completeness: broker.state === 'cancelled' ? 'cancelled' : 'unavailable', observedAt, errors: broker.errors };
  }

  let source = join(options.tcpDir, 'broker.json');
  try {
    checkAbort(options.signal);
    for (const [index, star] of broker.value.stars.entries()) {
      checkAbort(options.signal);
      source = `${join(options.tcpDir, 'broker.json')}#stars/${encodeURIComponent(star.starId ?? String(index))}/roster`;
      const view: StarView = { star, machines: [], onlineNodes: null, health: 'unknown' };
      items.push(view);
      if (options.readRoster === undefined) {
        errors.push(rosterIssue(source, 'unavailable', '未提供此星的在线机器与会话读取能力'));
        continue;
      }

      let raw: unknown;
      try {
        raw = await cancellable(options.readRoster(star, options.signal), options.signal);
        checkAbort(options.signal);
      } catch (error) {
        checkAbort(options.signal);
        if (error instanceof Error && error.name === 'AbortError') throw error;
        view.health = 'unavailable';
        errors.push(rosterIssue(source, 'unavailable', '无法读取此星的在线机器与会话'));
        continue;
      }
      if (raw === undefined || raw === null) {
        view.health = 'unavailable';
        errors.push(rosterIssue(source, 'unavailable', '无法读取此星的在线机器与会话'));
        continue;
      }

      try { view.machines = machines(raw); }
      catch {
        view.health = 'unavailable';
        errors.push(rosterIssue(source, 'malformed', '此星返回的机器或会话字段格式无效'));
        continue;
      }
      view.health = 'reachable';
      view.onlineNodes = view.machines.filter((machine) => machine.online).length;
      if (view.machines.some((machine) => machine.sessions === undefined)) {
        errors.push(rosterIssue(source, 'unavailable', '此星读取端未提供完整会话成员字段（旧端或部分结果）'));
      }
    }
    checkAbort(options.signal);
  } catch (error) {
    return { items: [], completeness: 'cancelled', observedAt, errors: [queryError(source, error)] };
  }
  return { items, completeness: errors.length === 0 ? 'complete' : 'partial', observedAt, errors };
}
