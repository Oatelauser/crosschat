import { createHash } from 'node:crypto';
import type { NativeOperationProvider, OperationAvailability } from '../application/session-operations.js';
import type { DiscoverySession } from '../application/discovery/model.js';
import { MultichatError } from '../errors.js';
import { dshSessionPath } from './client.js';
import type { DshOptions, DshThread } from './client.js';
import { DSH_INSTANCE_ID, isDshRecord } from './registry.js';
import { withVerifiedDshTarget } from './native-operations.js';
import type { DshConnection } from './service.js';

const rejected = (message: string) => new MultichatError('NATIVE_OPERATION_REJECTED', message);
const unqualified = (): OperationAvailability => ({ state: 'needs-verification', reason: '此 Harness 端点的原生改名及活界面同步尚未核实。', nextStep: '使用原生界面改名后刷新；不更换 owner 或恢复替代会话。' });
const eligible = (item: DiscoverySession) => item.ref.endpointType === 'host' && item.attributes.profile === 'web'
  && item.attributes.runtimeVersion === '0.2.1-rc.5';
const contextKey = (owner: string, target: string) => createHash('sha256').update(JSON.stringify([owner, target])).digest('hex');

async function titleFacts(connection: DshConnection, thread: DshThread): Promise<{ targetRevision: string; availability: OperationAvailability }> {
  const value = await connection.request(dshSessionPath(thread.id) + '/title');
  if (!isDshRecord(value) || value.instanceId !== connection.registration.instanceId || value.sessionId !== thread.id
    || value.createdAt !== thread.attributes.createdAt || typeof value.targetRevision !== 'string' || !DSH_INSTANCE_ID.test(value.targetRevision)
    || !isDshRecord(value.availability) || value.availability.state !== 'executable' && value.availability.state !== 'unsupported'
      && value.availability.state !== 'unavailable' && value.availability.state !== 'needs-verification') {
    throw rejected('Harness 原生标题能力未返回当前精确目标的有效证明。');
  }
  const state = value.availability.state;
  return { targetRevision: value.targetRevision, availability: state === 'executable' ? { state } : { ...unqualified(), state } };
}

/** Only the qualified Web release enables writes; other endpoints retain independent adoption. */
export function createDshRenameAdapter(options: DshOptions = {}): NonNullable<NativeOperationProvider['rename']> {
  return {
    contextKey: async (item, signal) => {
      if (!eligible(item)) return contextKey('unqualified-dsh-title', JSON.stringify([item.ref, item.attributes]));
      return withVerifiedDshTarget(item, options, signal, async (target) => {
        const facts = await titleFacts(target.connection, target.thread); await target.checkRegistration();
        return contextKey(target.contextKey, facts.targetRevision);
      });
    },
    probe: async (item, signal) => {
      if (!eligible(item)) return unqualified();
      try {
        return await withVerifiedDshTarget(item, options, signal, async (target) => {
          const facts = await titleFacts(target.connection, target.thread); await target.checkRegistration(); return facts.availability;
        });
      } catch { return { state: 'unavailable', reason: '当前 Harness 原生标题能力不可核实。', nextStep: '核对当前 profile 和桥版本后刷新；不会自动重新提交改名。' }; }
    },
    apply: async (item, name, signal, expectedContext) => {
      let sent = false;
      try {
        if (!eligible(item)) throw rejected('此 Harness 端点尚未核实原生改名，未发送修改。');
        await withVerifiedDshTarget(item, options, signal, async (target) => {
          const facts = await titleFacts(target.connection, target.thread);
          if (facts.availability.state !== 'executable' || contextKey(target.contextKey, facts.targetRevision) !== expectedContext) throw rejected('原生标题目标或能力已变化，请刷新后重新确认。');
          await target.checkRegistration(); target.operation.check();
          sent = true;
          const response = await target.connection.request(dshSessionPath(item.ref.nativeId) + '/title', {
            name, instanceId: target.connection.registration.instanceId, createdAt: target.thread.attributes.createdAt, targetRevision: facts.targetRevision,
          });
          if (!isDshRecord(response) || response.accepted !== true || response.instanceId !== target.connection.registration.instanceId
            || response.sessionId !== item.ref.nativeId || response.targetRevision !== facts.targetRevision || typeof response.name !== 'string') {
            throw new Error('Harness native title receipt is unconfirmed');
          }
        });
      } catch (error) {
        if (!sent || error instanceof MultichatError && ['DSH_INPUT_REJECTED', 'DSH_SESSION_NOT_FOUND', 'DSH_TARGET_CHANGED'].includes(error.code)) {
          throw rejected('原生标题目标或输入已变化，未受理改名；请刷新后重新确认。');
        }
        throw error;
      }
    },
  };
}
