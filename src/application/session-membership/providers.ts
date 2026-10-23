import type { MembershipProvider } from './types.js';
import { isRecord } from '../sessions/reading.js';

/** Claude discovery already verifies a live messaging process and native session ID. */
export const defaultMembershipProviders: readonly MembershipProvider[] = [
  { providerId: 'claude', tool: 'claude', canAdopt: () => ({ allowed: true }) },
  { providerId: 'codex', tool: 'codex', canAdopt: (session) => {
    const raw = session.rawStatus;
    const state = isRecord(raw) ? raw.type : raw;
    const loaded = ['idle', 'active', 'busy', 'waiting_approval', 'systemError', 'system_error'].includes(String(state));
    return loaded ? { allowed: true } : { allowed: false,
      reason: '此 Codex 记录尚未加载或原生状态不明，无法核实可收编的本机会话', nextStep: '先在原生 Codex 中打开该会话，再刷新核验' };
  } },
  // V2 get() proves the native session exists; durable inbox delivery can wake
  // an inactive drain without acquiring a separate loaded-thread owner.
  { providerId: 'opencode', tool: 'opencode', canAdopt: (session) => session.capabilities.delivery
    ? { allowed: true }
    : { allowed: false, reason: '此 OpenCode 来源未声明原生投递能力，不能收编', nextStep: '核对 OpenCode V2 服务后刷新会话来源' } },
];
