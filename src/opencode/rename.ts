import { MultichatError } from '../errors.js';
import type { NativeOperationProvider, OperationAvailability } from '../application/session-operations.js';
import type { DiscoverySession } from '../application/discovery/model.js';
import { getOpenCodeThreadFromConnection, openCodeSessionPath } from './client.js';
import { connectOpenCode, isRecord } from './service.js';
import type { OpenCodeConnection, OpenCodeOptions } from './service.js';

export type OpenCodeRenameOptions = OpenCodeOptions;

const rejected = (message: string): MultichatError => new MultichatError('NATIVE_OPERATION_REJECTED', message);

function requireShared(item: DiscoverySession): void {
  if (item.ref.endpointType !== 'shared') throw rejected('此 OpenCode 会话不是共享 V2 服务端点，未发送改名。');
}

function serviceContext(connection: OpenCodeConnection): string {
  const identity = connection.serviceIdentity;
  if (identity === undefined) throw rejected('无法核实 OpenCode V2 服务 owner，未发送改名。');
  return JSON.stringify(['opencode-v2-shared', identity.registrationId ?? null, identity.pid, identity.version, identity.url]);
}

function requireSupportedVersion(connection: OpenCodeConnection): void {
  if (connection.serviceIdentity?.version !== '2.1.3') {
    throw rejected('OpenCode 原生改名仅在已核实的 2.1.3 版本上可用，当前版本需要重新核验。');
  }
}

function sameLocation(item: DiscoverySession, cwd: string, attributes: Readonly<Record<string, unknown>>): boolean {
  const location = item.attributes.location;
  const currentLocation = attributes.location;
  return typeof item.attributes.cwd === 'string' && item.attributes.cwd === cwd
    && isRecord(location) && isRecord(currentLocation)
    && typeof location.directory === 'string' && location.directory === currentLocation.directory;
}

function matches(item: DiscoverySession, current: { id: string; name: string | null; cwd: string; attributes: Readonly<Record<string, unknown>> }): boolean {
  return current.id === item.ref.nativeId && current.name === item.name && sameLocation(item, current.cwd, current.attributes);
}

function probeFailure(error: unknown): OperationAvailability {
  const code = error instanceof MultichatError ? error.code : undefined;
  const needsVerification = code === 'NATIVE_OPERATION_REJECTED' || code === 'OPENCODE_OWNER_MISMATCH'
    || code === 'OPENCODE_NOT_CONFIGURED'
    || code === 'OPENCODE_UNSUPPORTED_VERSION' || code === 'OPENCODE_SESSION_NOT_FOUND';
  return needsVerification
    ? { state: 'needs-verification', reason: error instanceof Error ? error.message : 'OpenCode 原生会话或服务 owner 已变化。', nextStep: '刷新 OpenCode 会话来源后重新核验。' }
    : { state: 'unavailable', reason: error instanceof Error ? error.message : 'OpenCode 原生服务暂不可用。', nextStep: '核对当前 OpenCode V2 服务后刷新；恢复后会重新核验。' };
}

/** OpenCode V2's public session title endpoint, guarded by the exact service identity and location. */
export function createOpenCodeRenameAdapter(options: OpenCodeRenameOptions = {}): NonNullable<NativeOperationProvider['rename']> {
  async function contextKey(item: DiscoverySession, signal?: AbortSignal): Promise<string> {
    requireShared(item);
    return serviceContext(await connectOpenCode({ ...options, signal }));
  }

  async function verify(connection: OpenCodeConnection, item: DiscoverySession): Promise<void> {
    const current = await getOpenCodeThreadFromConnection(connection, item.ref.nativeId);
    if (current === null || !matches(item, current)) throw rejected('OpenCode 原生会话、名称或工作区已变化；未发送改名，请刷新后重新确认。');
  }

  return {
    contextKey,
    async probe(item, signal): Promise<OperationAvailability> {
      if (item.ref.endpointType !== 'shared') return { state: 'unsupported', reason: 'OpenCode 原生改名仅支持共享 V2 服务端点。', nextStep: '在 OpenCode 中改名后刷新。' };
      try {
        const connection = await connectOpenCode({ ...options, signal });
        serviceContext(connection);
        requireSupportedVersion(connection);
        await verify(connection, item);
        return { state: 'executable' };
      } catch (error) {
        return probeFailure(error);
      }
    },
    async apply(item, name, signal, expectedContext): Promise<void> {
      requireShared(item);
      let writeSent = false;
      try {
        const connection = await connectOpenCode({ ...options, signal });
        if (serviceContext(connection) !== expectedContext) throw rejected('OpenCode 服务 owner 或版本已变化；未发送改名，请刷新后重新确认。');
        requireSupportedVersion(connection);
        await verify(connection, item);
        if (signal?.aborted) throw rejected('操作已取消，未发送改名。');
        writeSent = true;
        await connection.request(openCodeSessionPath(item.ref.nativeId), { title: name }, { method: 'PATCH', response: 'empty' });
      } catch (error) {
        if (error instanceof MultichatError && ['OPENCODE_INPUT_REJECTED', 'OPENCODE_SESSION_NOT_FOUND', 'OPENCODE_LOCATION_NOT_FOUND'].includes(error.code)) {
          throw rejected(`OpenCode 原生接口拒绝改名：${error.message}`);
        }
        if (!writeSent) {
          if (error instanceof MultichatError && error.code === 'NATIVE_OPERATION_REJECTED') throw error;
          throw rejected('OpenCode 原生目标或服务 owner 已变化，未发送改名；请刷新后重新确认。');
        }
        throw error;
      }
    },
  };
}
