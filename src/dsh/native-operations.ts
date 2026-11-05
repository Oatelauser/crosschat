import { createHash } from 'node:crypto';
import type { NativeOperationProvider, OperationAvailability } from '../application/session-operations.js';
import { MultichatError } from '../errors.js';
import { findDshTarget } from './client.js';
import type { DshOptions } from './client.js';
import { DSH_INSTANCE_ID } from './registry.js';
import { withDshOperation } from './service.js';

const unavailable = (): OperationAvailability => ({ state: 'unavailable', reason: '当前 Harness 原生桥、owner 或精确目标不可核实。',
  nextStep: '核对所选 Harness profile 与桥连接后刷新；恢复后重新核验，不自动提交旧操作。' });
const needsVerification = (): OperationAvailability => ({ state: 'needs-verification', reason: '此 Harness 记录尚未提供一致的原生类型、实例、版本及 profile 依据。',
  nextStep: '刷新原生来源并重新选择精确会话；不根据 live roots 或工具名称猜测端点。' });

/** Private read-only facts bind confirmation to the actual authenticated bridge, not display metadata alone. */
export function createDshAdoptionInspector(options: DshOptions = {}): NonNullable<NativeOperationProvider['inspectAdoption']> {
  return async (session, signal) => {
    const { ref, attributes } = session;
    const { instanceId, runtimeVersion, profile } = attributes;
    if (ref.providerId !== 'dsh' || !['host', 'desktop'].includes(ref.endpointType ?? '') || typeof instanceId !== 'string'
      || !DSH_INSTANCE_ID.test(instanceId) || typeof runtimeVersion !== 'string' || typeof profile !== 'string'
      || profile.trim() === '' || profile.length > 256 || ref.endpointType !== (profile === 'desktop' ? 'desktop' : 'host')) {
      return { availability: needsVerification() };
    }
    try {
      return await withDshOperation({ ...options, endpointType: ref.endpointType, signal }, async (operation) => {
        const target = await findDshTarget(ref.nativeId, operation, ref.endpointType);
        if (!target) return { availability: unavailable() };
        const owner = target.connection.registration;
        if (owner.instanceId !== instanceId || owner.runtimeVersion !== runtimeVersion || owner.profile !== profile) {
          return { availability: needsVerification() };
        }
        operation.check();
        const contextKey = createHash('sha256').update(JSON.stringify([ref.providerId, ref.nativeId, ref.endpointType,
          owner.url, owner.instanceId, owner.pid, owner.runtimeVersion, owner.protocol, owner.profile, owner.createdAt,
          owner.callerIdentity?.profileDir ?? null])).digest('hex');
        return { availability: { state: 'executable' }, contextKey };
      });
    } catch (error) {
      if (error instanceof MultichatError && ['DSH_UNSUPPORTED_VERSION', 'DSH_UNSUPPORTED_PROTOCOL'].includes(error.code)) {
        return { availability: { state: 'unsupported', reason: '当前 Harness 原生版本或桥协议不在已支持的接入范围。',
          nextStep: '核对原生版本及随包桥；来源恢复后会重新核验，不会更换 owner 或安装软件。' } };
      }
      return { availability: unavailable() };
    }
  };
}
