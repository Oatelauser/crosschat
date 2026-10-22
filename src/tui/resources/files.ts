import { basename } from 'node:path';
import { cancellable } from '../../application/queries/reading.js';
import type { ManagedFile } from '../../application/queries/files.js';
import type { CollectionResult } from '../../application/queries/services.js';
import type { TuiPage, TuiReadRequest, TuiResource, TuiResourceAdapter } from '../model.js';

interface FilesOptions { read(request: { signal: AbortSignal }): Promise<CollectionResult<ManagedFile>> }
const categories: Readonly<Record<ManagedFile['category'], string>> = { configuration: '配置', status: '状态快照', log: '日志', inbox: '收件', parts: '断点', outbox: '滞留', mailbox: '镜像', conversations: '会话分片' };
function valid(request: TuiReadRequest): boolean {
  return request.context?.kind === 'local' && (request.route?.contextId === undefined || request.route.contextId === request.context.id);
}
function failure(message: string, completeness: TuiPage['completeness'] = 'unavailable'): TuiPage {
  return { rows: [], completeness, notice: message, detailViews: { info: { title: '文件读取信息', fields: [{ label: '原因与下一步', value: message }] } } };
}
export function createFilesResource(options: FilesOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const resource: TuiResource = { id: 'files', label: '文件', aliases: ['file'], description: '本机托管文件元数据，不读取正文', columns: [
    { id: 'name', label: '文件名', width: 36, priority: 100 }, { id: 'category', label: '类型', width: 14, priority: 80 },
    { id: 'bytes', label: '大小(字节)', width: 14, priority: 60 }, { id: 'modifiedAt', label: '修改时间', width: 24, priority: 40 },
  ], actions: [
    { id: 'maintenance', label: '维护清理列表', shortcut: 'm', ownerResourceId: 'files', selectionPolicy: 'none', mutation: false, kind: 'navigate', navigateTo: 'maintenance', returnPolicy: 'restore' },
    { id: 'info', label: '读取信息', shortcut: 'i', ownerResourceId: 'files', selectionPolicy: 'none', mutation: false, kind: 'detail', viewId: 'info', returnPolicy: 'restore' },
  ] };
  const adapter: TuiResourceAdapter = { async read(request) {
    if (!valid(request)) return failure('文件元数据只支持当前本机连接；返回 :ctx 重新选择。');
    if (request.signal.aborted) return failure('读取已取消。', 'cancelled');
    try {
      const result = await cancellable(options.read({ signal: request.signal }), request.signal);
      if (request.signal.aborted || result.completeness === 'cancelled') return failure('读取已取消。', 'cancelled');
      return { rows: result.items.map((item) => ({ id: item.file, cells: { name: basename(item.file), category: categories[item.category], bytes: String(item.bytes), modifiedAt: item.modifiedAt },
        searchText: `${item.file} ${item.category} ${categories[item.category]} ${item.bytes} ${item.modifiedAt}`, copyValue: item.file,
        detail: [{ label: '完整路径', value: item.file }, { label: '类型', value: `${categories[item.category]}<${item.category}>` }, { label: '大小（字节）', value: String(item.bytes) },
          { label: '修改时间', value: item.modifiedAt }, { label: '读取范围', value: '仅文件元数据；不读取文件正文、不触发投递或清理。批量清理由维护列表预览确认。' }],
      })), completeness: result.completeness, sampledAt: result.observedAt,
        notice: result.errors.length ? '部分文件来源无法读取；按 i 查看来源与下一步。' : '只读元数据；m 进入维护任务列表。',
        detailViews: { info: { title: '文件元数据读取信息', fields: [{ label: '完整性', value: result.completeness }, { label: '采样时间', value: new Date(result.observedAt).toISOString() },
          ...result.errors.map((error) => ({ label: `${error.source}<${error.kind}>`, value: `${error.message}\n下一步：${error.nextStep}` })),
        ] } } };
    } catch { return failure(request.signal.aborted ? '读取已取消。' : '文件元数据无法读取；检查本机目录访问权限后按 r 刷新。', request.signal.aborted ? 'cancelled' : 'unavailable'); }
  } };
  return { resource, adapter };
}
