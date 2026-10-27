import { defaultMembershipProviders } from './session-membership/providers.js';
import type { NativeOperationProvider } from './session-operations.js';
import { createCodexRenameAdapter } from '../codex/rename.js';
import type { CodexRenameOptions } from '../codex/rename.js';
import { MultichatError } from '../errors.js';

/** Tool-specific native capabilities live here; common TUI code stays provider-independent. */
export function createNativeOperationProviders(options: { codex?: CodexRenameOptions } = {}): readonly NativeOperationProvider[] {
  return defaultMembershipProviders.map((provider) => provider.providerId === 'codex'
    ? { ...provider, rename: createCodexRenameAdapter(options.codex) }
    : provider.providerId === 'claude' ? { ...provider, rename: {
      contextKey: (item) => JSON.stringify(['claude-messaging', item.attributes.pid ?? null, item.attributes.startedAt ?? null]),
      // Official SDK 0.3.310 changes the persisted title, but the live 2.1.310
      // registry/window kept its previous name in the isolated native validation.
      probe: async () => ({ state: 'needs-verification' as const,
        reason: 'Claude 官方 SDK 能改持久标题，但尚不能确认活会话窗口与通信名称同步。', nextStep: '在 Claude 中使用 /rename；原生登记更新后星内名称跟随。' }),
      apply: async () => { throw new MultichatError('NATIVE_OPERATION_REJECTED', 'Claude 活会话改名同步尚未核实，未发送修改。'); },
    } } : provider);
}
