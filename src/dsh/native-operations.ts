import { createHash } from 'node:crypto';
import type { NativeOperationProvider, OperationAvailability } from '../application/session-operations.js';
import type { DiscoverySession } from '../application/discovery/model.js';
import { MultichatError } from '../errors.js';
import { findDshTarget } from './client.js';
import type { DshOptions, DshThread } from './client.js';
import { DSH_INSTANCE_ID, isDshRecord, readDshRegistrations } from './registry.js';
import type { DshRegistration } from './registry.js';
import { withDshOperation } from './service.js';
import type { DshConnection, DshOperation } from './service.js';

const unavailable = (): OperationAvailability => ({ state: 'unavailable', reason: '当前 Harness 原生桥、owner 或精确目标不可核实。',
  nextStep: '核对所选 Harness profile 与桥连接后刷新；恢复后重新核验，不自动提交旧操作。' });
const needsVerification = (): OperationAvailability => ({ state: 'needs-verification', reason: '此 Harness 记录尚未提供一致的原生类型、实例、版本及 profile 依据。',
  nextStep: '刷新原生来源并重新选择精确会话；不根据 live roots 或工具名称猜测端点。' });
const ownerIdentity = (owner: DshRegistration): unknown[] => [owner.url, owner.instanceId, owner.pid, owner.runtimeVersion,
  owner.protocol, owner.profile, owner.endpointType, owner.createdAt, owner.callerIdentity?.profileDir ?? null];
const registrationSet = (owners: readonly DshRegistration[]): string => JSON.stringify(owners.map(owner => [...ownerIdentity(owner), owner.token]));

interface VerifiedTarget {
  connection: DshConnection;
  thread: DshThread;
  contextKey: string;
  operation: DshOperation;
  checkRegistration(): Promise<void>;
}

/** Own one native deadline; facts and the authenticated connection cannot escape the callback. */
export async function withVerifiedDshTarget<T>(session: DiscoverySession, options: DshOptions, signal: AbortSignal | undefined,
  use: (target: VerifiedTarget) => Promise<T>): Promise<T> {
    const { ref, attributes } = session;
    const { instanceId, runtimeVersion, profile } = attributes;
    if (ref.providerId !== 'dsh' || !['host', 'desktop'].includes(ref.endpointType ?? '') || typeof instanceId !== 'string'
      || !DSH_INSTANCE_ID.test(instanceId) || typeof runtimeVersion !== 'string' || typeof profile !== 'string'
      || profile.trim() === '' || profile.length > 256 || ref.endpointType !== (profile === 'desktop' ? 'desktop' : 'host')) {
      throw new MultichatError('NATIVE_OPERATION_NEEDS_VERIFICATION', needsVerification().reason!);
    }
      return await withDshOperation({ ...options, endpointType: ref.endpointType, signal: signal ?? options.signal }, async (operation) => {
        const target = await findDshTarget(ref.nativeId, operation, ref.endpointType);
        if (!target) throw new MultichatError('DSH_SESSION_NOT_FOUND', 'The exact native root is absent.');
        const owner = target.connection.registration;
        const status = isDshRecord(session.rawStatus) ? session.rawStatus.type : undefined;
        if (owner.instanceId !== instanceId || owner.runtimeVersion !== runtimeVersion || owner.profile !== profile
          || target.thread.name !== session.name || target.thread.rawStatus.type !== status
          || ['createdAt', 'currentCwd', 'originalCwd'].some(key => target.thread.attributes[key] !== attributes[key])) {
          throw new MultichatError('NATIVE_OPERATION_NEEDS_VERIFICATION', needsVerification().reason!);
        }
        // Native reads can yield while the registration is replaced. Reuse this
        // operation's live deadline and compare the whole selected source set;
        // a new ambiguous source must not be hidden by pinning the old instance.
        const expected = (await operation.connections()).map(connection => connection.registration);
        const checkRegistration = async () => {
          const current = (await readDshRegistrations(options, operation.signal)).filter(entry => entry.endpointType === ref.endpointType);
          if (registrationSet(current) !== registrationSet(expected)) throw new MultichatError('DSH_OWNER_MISMATCH', 'The selected native registration set changed.');
          operation.check();
        };
        await checkRegistration();
        const contextKey = createHash('sha256').update(JSON.stringify([ref.providerId, ref.nativeId, ref.endpointType,
          ...ownerIdentity(owner), target.thread.attributes.createdAt])).digest('hex');
        return use({ ...target, contextKey, operation, checkRegistration });
      });
}

/** Private read-only facts bind confirmation to the actual authenticated bridge, not display metadata alone. */
export function createDshAdoptionInspector(options: DshOptions = {}): NonNullable<NativeOperationProvider['inspectAdoption']> {
  return async (session, signal) => {
    try {
      return await withVerifiedDshTarget(session, options, signal, async ({ contextKey }) => ({ availability: { state: 'executable' }, contextKey }));
    } catch (error) {
      if (error instanceof MultichatError && error.code === 'NATIVE_OPERATION_NEEDS_VERIFICATION') return { availability: needsVerification() };
      if (error instanceof MultichatError && ['DSH_UNSUPPORTED_VERSION', 'DSH_UNSUPPORTED_PROTOCOL'].includes(error.code)) {
        return { availability: { state: 'unsupported', reason: '当前 Harness 原生版本或桥协议不在已支持的接入范围。',
          nextStep: '核对原生版本及随包桥；来源恢复后会重新核验，不会更换 owner 或安装软件。' } };
      }
      return { availability: unavailable() };
    }
  };
}
