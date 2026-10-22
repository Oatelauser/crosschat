/** Safe maintenance DTOs. Plans never contain file bodies or executable commands. */
export const MAINTENANCE_OPERATIONS = [
  { id: 'cleanup', label: '按保留规则清理', description: '原有收件、断点与会话分片保留规则', guidance: '预览后清理超过5天的收件/断点、超容量收件和30天未更新的JSON会话分片；不清理outbox、mailbox或日志。' },
  { id: 'cleanup-force', label: '强制清理收件与断点', description: '删除全部收件、断点和JSON会话分片', guidance: '预览后删除全部inbox、parts及JSON会话分片；不删除临时分片、outbox、mailbox或日志。传输中的文件也可能被删，请先停止传输。' },
  { id: 'install-skills', label: '安装 / 更新技能', description: '覆盖安装包内的crosschat技能至两个现有目标', guidance: '将本安装包的skills/crosschat覆盖复制到当前本机用户的.claude和.codex技能目录；保留旧命令的先后顺序，前项失败则停止。' },
  { id: 'uninstall-data', label: '卸载本机数据与技能', description: '删除原卸载命令的数据/技能范围，不卸载npm包', guidance: '删除当前用户.crosschat、旧版状态目录和Claude/Codex的crosschat技能；新鲜服务状态阻止卸载。npm包不会自动删除，需另行执行npm uninstall -g @oatelauser/crosschat。' },
] as const;
export type MaintenanceOperationId = typeof MAINTENANCE_OPERATIONS[number]['id'];
export interface MaintenanceOperation { id: MaintenanceOperationId; label: string; description: string; guidance: string }
export interface MaintenanceTarget { path: string; label: string; kind: 'file' | 'directory'; bytes?: number; modifiedAt?: number }
export interface MaintenancePreview {
  operationId: MaintenanceOperationId;
  label: string;
  observedAt: number;
  fingerprint: string;
  enabled: boolean;
  reason?: string;
  targets: MaintenanceTarget[];
  effects: string[];
}
export interface MaintenanceItem { path: string; outcome: 'deleted' | 'installed' | 'skipped' | 'failed'; message?: string }
export interface MaintenanceResult {
  operationId: MaintenanceOperationId;
  status: 'complete' | 'partial' | 'blocked' | 'changed';
  startedAt: number;
  finishedAt: number;
  npm: 'not-run';
  message: string;
  items: MaintenanceItem[];
}
export interface LocalMaintenance {
  list(): readonly MaintenanceOperation[];
  preview(request: { operationId: MaintenanceOperationId; signal?: AbortSignal }): Promise<MaintenancePreview>;
  execute(request: { operationId: MaintenanceOperationId; expectedFingerprint: string; signal?: AbortSignal }): Promise<MaintenanceResult>;
}
export function isMaintenanceOperationId(value: unknown): value is MaintenanceOperationId {
  return typeof value === 'string' && MAINTENANCE_OPERATIONS.some((item) => item.id === value);
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 65_536;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function invalid(): never { throw new Error('维护任务返回的数据无效；请重新预览，不能据此判断执行完成。'); }
function envelope(value: unknown): Record<string, unknown> {
  if (!record(value) || Buffer.byteLength(JSON.stringify(value)) > 16 * 1024 * 1024) invalid();
  return value;
}
/** IPC values are unknown until all displayed fields have been validated. */
export function parseMaintenancePreview(input: unknown): MaintenancePreview {
  const value = envelope(input);
  if (!isMaintenanceOperationId(value.operationId) || !text(value.label) || !finite(value.observedAt)
    || !text(value.fingerprint) || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.enabled !== 'boolean'
    || (value.reason !== undefined && !text(value.reason)) || !Array.isArray(value.targets) || value.targets.length > 100_000
    || !Array.isArray(value.effects) || !value.effects.every(text)) invalid();
  const targets = value.targets.map((item): MaintenanceTarget => {
    if (!record(item) || !text(item.path) || !text(item.label) || (item.kind !== 'file' && item.kind !== 'directory')
      || (item.bytes !== undefined && (!finite(item.bytes) || item.bytes < 0)) || (item.modifiedAt !== undefined && !finite(item.modifiedAt))) invalid();
    return { path: item.path, label: item.label, kind: item.kind, ...(item.bytes === undefined ? {} : { bytes: item.bytes }), ...(item.modifiedAt === undefined ? {} : { modifiedAt: item.modifiedAt }) };
  });
  return { operationId: value.operationId, label: value.label, observedAt: value.observedAt, fingerprint: value.fingerprint,
    enabled: value.enabled, ...(value.reason === undefined ? {} : { reason: value.reason }), targets, effects: [...value.effects] };
}
export function parseMaintenanceResult(input: unknown): MaintenanceResult {
  const value = envelope(input);
  if (!isMaintenanceOperationId(value.operationId) || !finite(value.startedAt) || !finite(value.finishedAt)
    || !['complete', 'partial', 'blocked', 'changed'].includes(String(value.status)) || value.npm !== 'not-run' || !text(value.message)
    || !Array.isArray(value.items) || value.items.length > 100_000) invalid();
  const items = value.items.map((item): MaintenanceItem => {
    if (!record(item) || !text(item.path) || !['deleted', 'installed', 'skipped', 'failed'].includes(String(item.outcome))
      || (item.message !== undefined && !text(item.message))) invalid();
    // The closed discriminant was validated above.
    const outcome = item.outcome as MaintenanceItem['outcome'];
    return { path: item.path, outcome, ...(item.message === undefined ? {} : { message: item.message }) };
  });
  const status = value.status as MaintenanceResult['status'];
  if (status === 'complete' && items.some((item) => item.outcome === 'failed')) invalid();
  return { operationId: value.operationId, status, startedAt: value.startedAt, finishedAt: value.finishedAt, npm: 'not-run', message: value.message, items };
}
