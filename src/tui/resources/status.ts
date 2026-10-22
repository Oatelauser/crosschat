export type ProviderStatusLabels = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface StatusRegistry {
  format(providerId: string, rawStatus: unknown): string;
}

const defaultLabels: ProviderStatusLabels = {
  codex: {
    idle: '空闲', busy: '忙碌', active: '忙碌', unknown: '未知',
    not_loaded: '未加载', notLoaded: '未加载',
    waiting_approval: '等待批准', waiting_input: '等待输入',
    system_error: '系统错误', systemError: '系统错误',
  },
  claude: { idle: '空闲', busy: '忙碌', working: '运行中', unknown: '未知' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Provider registrations are snapshots; native state values remain independent of translated labels. */
export function createStatusRegistry(additional: ProviderStatusLabels = {}): StatusRegistry {
  const providers = new Map<string, Map<string, string>>();
  for (const source of [defaultLabels, additional]) {
    for (const [providerId, labels] of Object.entries(source)) {
      const table = providers.get(providerId) ?? new Map<string, string>();
      for (const [raw, label] of Object.entries(labels)) table.set(raw, label);
      providers.set(providerId, table);
    }
  }
  return {
    format(providerId, rawStatus) {
      if (rawStatus === null || rawStatus === undefined) return '未提供<—>';
      const raw = typeof rawStatus === 'string' ? rawStatus
        : isRecord(rawStatus) && typeof rawStatus.type === 'string' ? rawStatus.type
          : typeof rawStatus === 'number' || typeof rawStatus === 'boolean' ? String(rawStatus) : '无状态类型';
      let lookup = raw;
      if (providerId === 'codex' && raw === 'active' && isRecord(rawStatus) && Array.isArray(rawStatus.activeFlags)) {
        if (rawStatus.activeFlags.includes('waitingOnApproval')) lookup = 'waiting_approval';
        else if (rawStatus.activeFlags.includes('waitingOnUserInput')) lookup = 'waiting_input';
      }
      return `${providers.get(providerId)?.get(lookup) ?? '未识别'}<${raw}>`;
    },
  };
}
