import { createHash } from 'node:crypto';
import type { DiscoveryEndpoint, DiscoverySession } from './discovery/model.js';
import { parseDiscoveryResponse } from './discovery/boundary.js';
import { createNativeOperationProviders } from './native-operation-providers.js';
import type { MembershipProvider, MembershipResult } from './session-membership/types.js';
import { sessionKey } from './sessions/model.js';
import type { SessionRef } from './sessions/model.js';
import { untilAborted } from './sessions/reading.js';
import { MultichatError } from '../errors.js';

export type SessionOperation = 'adopt' | 'rename';
export interface OperationAvailability {
  state: 'executable' | 'unsupported' | 'unavailable' | 'needs-verification';
  reason?: string;
  nextStep?: string;
}
export interface SessionOperationDescription {
  ref: SessionRef;
  observedAt: number;
  revision: string;
  actions: Record<SessionOperation, OperationAvailability>;
}
export interface SessionOperationRequest {
  ref: SessionRef;
  operation: SessionOperation;
  name?: string;
  expectedRevision: string;
  signal?: AbortSignal;
}
export interface NativeOperationProvider extends MembershipProvider {
  /** Probe the actual endpoint/owner/version, never just the tool's display name. */
  rename?: {
    /** Stable concrete endpoint/owner/version; ordinary title timestamps are not identity. */
    contextKey(session: DiscoverySession, signal?: AbortSignal): string | Promise<string>;
    probe(session: DiscoverySession, signal?: AbortSignal): Promise<OperationAvailability>;
    apply(session: DiscoverySession, name: string, signal: AbortSignal | undefined, expectedContext: string): Promise<void>;
  };
}
export interface NativeSessionOperations {
  describe(ref: SessionRef, signal?: AbortSignal): Promise<SessionOperationDescription>;
  apply(request: SessionOperationRequest): Promise<MembershipResult>;
}
interface Options {
  discovery: DiscoveryEndpoint;
  providers?: readonly NativeOperationProvider[];
  adopt(session: DiscoverySession, tool: string, signal?: AbortSignal): Promise<void>;
  renamed?(session: DiscoverySession, signal?: AbortSignal): Promise<void>;
  timeoutMs?: number;
  now?(): number;
}
const unsupported = (reason: string): OperationAvailability => ({ state: 'unsupported', reason, nextStep: '使用原生工具管理会话，或接入已验证的适配器后刷新。' });
const unavailable = (): OperationAvailability => ({ state: 'unavailable', reason: '当前原生会话来源不可核实。', nextStep: '核对节点及原生工具连接后刷新；恢复后会重新核验。' });
const revisionOf = (item: DiscoverySession): string => createHash('sha256').update(JSON.stringify([item.ref, item.name, item.rawStatus, item.capabilities, item.attributes])).digest('hex');

/** Fresh bounded probes avoid stale capability caches. Reads never repair configuration or replay writes. */
export function createNativeSessionOperations(options: Options): NativeSessionOperations {
  const providers = options.providers ?? createNativeOperationProviders();
  const now = options.now ?? Date.now;
  async function bounded<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, options.timeoutMs ?? 3_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try { return await untilAborted(work(controller.signal), controller.signal); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  }
  async function read(ref: SessionRef, signal?: AbortSignal): Promise<DiscoverySession> {
    const response = parseDiscoveryResponse(await bounded(signal, (owned) => options.discovery.execute({ op: 'detail', providerId: ref.providerId,
      nativeId: ref.nativeId, referenceKind: ref.referenceKind }, { contextId: ref.contextId, signal: owned })));
    if (response.op !== 'detail' || response.detail.completeness !== 'complete' || response.detail.errors.length > 0
      || !response.detail.item || sessionKey(response.detail.item.ref) !== sessionKey(ref)) throw new Error('Native target unavailable');
    return response.detail.item;
  }
  async function prepare(ref: SessionRef, signal?: AbortSignal): Promise<{ description: SessionOperationDescription; item?: DiscoverySession; provider?: NativeOperationProvider; context?: string }> {
    const matching = providers.filter((entry) => entry.providerId === ref.providerId);
    const provider: NativeOperationProvider | undefined = matching.length === 1 ? matching[0] : undefined;
    const description: SessionOperationDescription = { ref: { ...ref }, observedAt: now(), revision: '',
      actions: { adopt: unsupported('此来源没有已注册的入星适配器。'), rename: unsupported('此来源没有已注册的原生改名适配器。') } };
    if (!provider || (ref.referenceKind !== undefined && ref.referenceKind !== 'native')) return { description };
    try {
      const item = await read(ref, signal);
      const adoption = provider.canAdopt(item);
      description.revision = revisionOf(item);
      description.actions.adopt = adoption.allowed ? { state: 'executable' } : { state: 'unavailable', reason: adoption.reason, nextStep: adoption.nextStep };
      let context: string | undefined;
      try {
        context = provider.rename ? await bounded(signal, async (owned) => provider.rename!.contextKey(item, owned)) : undefined;
        if (provider.rename && !context) throw new Error('Unverified native operation context');
        if (context) description.revision = createHash('sha256').update(description.revision).update(context).digest('hex');
        description.actions.rename = provider.rename ? await bounded(signal, (owned) => provider.rename!.probe(item, owned))
          : { state: 'needs-verification', reason: '尚未验证此端点的原生改名接口及活会话同步。', nextStep: '先在原生工具中改名；刷新后星内名称会跟随原生名称。' };
      } catch { description.actions.rename = unavailable(); }
      return { description, item, provider, context };
    } catch { description.actions = { adopt: unavailable(), rename: unavailable() }; return { description }; }
  }
  return {
    describe: async (ref, signal) => (await prepare(ref, signal)).description,
    apply: async (request) => {
      const { description, item, provider, context } = await prepare(request.ref, request.signal);
      const availability = description.actions[request.operation];
      if (!item || !provider || availability.state !== 'executable') return { kind: 'rejected', message: availability.reason ?? '当前能力尚未核实。' };
      if (!request.expectedRevision || description.revision !== request.expectedRevision) return { kind: 'rejected', message: '会话、端点或能力已变化，请刷新后重新确认。' };
      if (request.signal?.aborted) return { kind: 'rejected', message: '操作已取消，未发送修改请求。' };
      if (request.operation === 'rename' && (!request.name?.trim() || request.name.length > 256 || request.name.includes(':')
        || [...request.name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) return { kind: 'rejected', message: '名称须为 1–256 个字符，且不能包含冒号或控制字符。' };
      try {
        if (request.operation === 'adopt') {
          await bounded(request.signal, (owned) => options.adopt(item, provider.tool, owned));
          return { kind: 'applied', message: '节点已声明此精确原生会话；以星册确认结果为准。' };
        }
        await bounded(request.signal, (owned) => provider.rename!.apply(item, request.name!, owned, context!));
        const updated = await read(request.ref, request.signal);
        const updatedContext = await bounded(request.signal, async (owned) => provider.rename!.contextKey(updated, owned));
        if (updated.name !== request.name || updatedContext !== context
          || (await bounded(request.signal, (owned) => provider.rename!.probe(updated, owned))).state !== 'executable') return { kind: 'uncertain', message: '原生改名已发出，但当前 owner 的名称同步尚未确认，请刷新核实。' };
        if (options.renamed) await bounded(request.signal, (owned) => options.renamed!(updated, owned));
        return { kind: 'applied', message: '已通过原生接口改名，并重新核实当前来源名称。' };
      } catch (error) {
        if (error instanceof MultichatError && error.code === 'NATIVE_OPERATION_REJECTED') return { kind: 'rejected', message: error.message };
        return { kind: 'uncertain', message: '修改请求已发出，结果待核实；请刷新，不要自动重试。' };
      }
    },
  };
}
