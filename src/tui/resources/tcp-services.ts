import { createHash } from 'node:crypto';
import type { LocalService, LocalServiceRequest, LocalServices } from '../../application/services/managed.js';
import type { TcpApplication } from '../../application/tcp/model.js';
import { isRecord, untilAborted } from '../../application/sessions/reading.js';
import type { TuiAction, TuiActionAvailability, TuiActionRequest, TuiResource, TuiResourceAdapter } from '../model.js';

interface Binding { resource: TuiResource; adapter: TuiResourceAdapter }
interface PinnedTarget { starId: string; starRowId: string; serviceId: string; revision: string }
interface ServicePlan { request: Omit<LocalServiceRequest, 'signal'>; fingerprint: string; impact: readonly string[] }
const actions: readonly TuiAction[] = [
  { id: 'start-broker', label: '启动所属 broker', shortcut: 'B', ownerResourceId: 'stars', kind: 'form', mutation: true, selectionPolicy: 'required', returnPolicy: 'restore' },
  { id: 'stop-broker', label: '停止所属 broker', shortcut: 'Ctrl+B', ownerResourceId: 'stars', kind: 'form', mutation: true, selectionPolicy: 'required', returnPolicy: 'restore' },
];
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = (reason: string): TuiActionAvailability => ({ enabled: false, reason, nextStep: '在 broker 所在机器的 TCP 星列表或本机服务列表核对完整范围后重新操作。' });
const owns = (id: string): boolean => id === 'start-broker' || id === 'stop-broker';

/** List-owned broker controls reuse the service application; a selected star never narrows broker-wide impact. */
export function withTcpBrokerServices(binding: Binding, options: { services?: LocalServices; tcp: Pick<TcpApplication, 'readStar'> }): Binding {
  const resource = { ...binding.resource, actions: [...binding.resource.actions, ...actions] };
  let accepted: { key: string; plan: ServicePlan } | undefined;
  let generation = 0;
  const confirmationKey = (request: TuiActionRequest): string => hash([request.action.id, request.route, request.target?.id, request.target?.copyValues?.target, request.target?.copyValues?.broker, request.values]);
  function pinned(request: TuiActionRequest): PinnedTarget | undefined {
    if (!options.services || request.signal.aborted || request.context?.kind !== 'local' || request.context.id !== 'local' || request.route?.resourceId !== 'stars'
      || request.route.contextId !== 'local' || Object.keys(request.route.query ?? {}).length || request.action.ownerResourceId !== 'stars' || !owns(request.action.id) || Object.keys(request.values).length) return undefined;
    try {
      const star: unknown = JSON.parse(request.target?.copyValues?.target ?? '');
      const broker: unknown = JSON.parse(request.target?.copyValues?.broker ?? '');
      if (!isRecord(star) || star.rowId !== request.target?.id || star.targetId !== request.target?.id || typeof star.starId !== 'string' || !star.starId
        || !isRecord(broker) || broker.id !== 'service:broker' || typeof broker.revision !== 'string' || !broker.revision) return undefined;
      return { starId: star.starId, starRowId: request.target!.id, serviceId: broker.id, revision: broker.revision };
    } catch { return undefined; }
  }
  async function plan(request: TuiActionRequest): Promise<ServicePlan> {
    const selected = pinned(request);
    if (!selected || !options.services) throw new Error('本机 broker 目标或权限来源无效。');
    const [star, services] = await untilAborted(Promise.all([
      options.tcp.readStar({ contextId: 'local', starId: selected.starId, signal: request.signal }),
      options.services.read({ contextId: 'local', signal: request.signal }),
    ]), request.signal);
    if (request.signal.aborted || star.contextId !== 'local' || star.star?.starId !== selected.starId || star.star.id !== selected.starRowId || star.star.role !== 'broker-owner') throw new Error('所选完整星或本机 broker 权限已变化。');
    const matches = services.items.filter((item) => item.id === selected.serviceId && item.kind === 'broker' && item.revision === selected.revision);
    if (matches.length !== 1 || services.completeness === 'cancelled' || services.completeness === 'unavailable') throw new Error('所属 broker 服务配置或进程已变化，请刷新重新确认。');
    const service = matches[0];
    const operation = request.action.id === 'start-broker' ? 'start' : 'stop';
    const fixed = { contextId: 'local', id: service.id, revision: service.revision, operation } satisfies Omit<LocalServiceRequest, 'signal'>;
    const check = await untilAborted(options.services.check({ ...fixed, signal: request.signal }), request.signal);
    if (!check.allowed) throw new Error(check.reason ?? '所属 broker 当前不能执行此操作。');
    const affected = service.detail.filter((field) => field.label === '托管星').map((field) => `${field.label}：${field.value}`);
    const impact = [`原选中星：${star.star.name ?? '未命名'} (${selected.starId})。`, '操作对象是所属 broker 整个服务；停止会影响它托管的全部星及机器连接，原生会话保留。', ...affected, ...check.impact];
    return { request: fixed, impact, fingerprint: hash([fixed, impact]) };
  }
  return { resource, adapter: {
    ...binding.adapter,
    async read(request) {
      generation++; accepted = undefined;
      const page = await binding.adapter.read(request);
      const registered = [...(page.presentation?.actions ?? binding.resource.actions), ...actions];
      const local = request.context?.id === 'local' && request.context.kind === 'local';
      let broker: LocalService | undefined;
      if (local && options.services && page.rows.some((row) => row.actionAvailability?.['rename-star']?.enabled === true)) {
        try {
          const read = await untilAborted(options.services.read({ contextId: 'local', signal: request.signal }), request.signal);
          const matches = read.items.filter((item) => item.id === 'service:broker' && item.kind === 'broker');
          if (read.completeness !== 'cancelled' && read.completeness !== 'unavailable' && matches.length === 1) broker = matches[0];
        } catch { /* Availability stays explicitly unknown; no start/stop fallback. */ }
      }
      return { ...page, presentation: { ...page.presentation, actions: registered }, rows: page.rows.map((row) => ({ ...row,
        copyValues: { ...row.copyValues, ...(broker ? { broker: JSON.stringify({ id: broker.id, revision: broker.revision }) } : {}) },
        actionAvailability: { ...row.actionAvailability, ...Object.fromEntries(actions.map((action) => {
          if (!local) return [action.id, denied('远程 TCP 连接没有所属 broker 的本机服务管理权限。')];
          if (!broker || row.actionAvailability?.['rename-star']?.enabled !== true) return [action.id, denied('尚未取得所属 broker 的完整服务与本机管理身份。')];
          const check = action.id === 'start-broker' ? broker.start : broker.stop;
          return [action.id, { enabled: check.allowed, reason: check.reason, nextStep: check.nextStep, impact: check.impact }];
        })) },
      })) };
    },
    async checkAction(request) {
      const turn = ++generation; accepted = undefined;
      if (!owns(request.action.id)) return binding.adapter.checkAction?.(request) ?? denied('管理应用接口不可用。');
      try {
        const current = await plan(request);
        if (turn !== generation || request.signal.aborted) return denied('本次 broker 服务核验已取消或来源变化。');
        accepted = { key: confirmationKey(request), plan: current };
        return { enabled: true, impact: current.impact };
      } catch { return denied('所属 broker、服务进程或权限已变化；请刷新重新核验。'); }
    },
    async mutate(request) {
      if (!owns(request.action.id)) {
        if (!binding.adapter.mutate) throw new Error('管理应用接口不可用。');
        return binding.adapter.mutate(request);
      }
      const preview = accepted; accepted = undefined;
      if (!preview || preview.key !== confirmationKey(request) || request.signal.aborted) throw new Error('没有与原星和 broker 目标匹配的已核验确认。');
      const current = await plan(request);
      if (current.fingerprint !== preview.plan.fingerprint) throw new Error('broker 服务或影响清单已变化；请重新确认。');
      const result = await options.services!.execute({ ...current.request, signal: request.signal });
      if (result.state !== 'ready') throw new Error(result.message);
      return { selectedId: request.target?.id, message: result.message };
    },
  } };
}
