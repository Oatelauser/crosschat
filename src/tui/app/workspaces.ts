import type { TuiContext, TuiResource, TuiRoute, TuiRow, TuiWorkspaceId } from '../model.js';

/** Navigation metadata is independent of the execution context and Provider adapters. */
export const workspaceResources: Readonly<Record<TuiWorkspaceId, readonly string[]>> = {
  local: ['sessions', 'status', 'doctor', 'services', 'deliveries', 'outbox', 'logs', 'files', 'maintenance'],
  ssh: ['sessions', 'doctor'],
  tcp: ['stars', 'machines', 'members', 'sessions', 'keys', 'tcp-targets', 'services', 'logs', 'connect'],
};
export function resourceWorkspaces(resource: Pick<TuiResource, 'id' | 'workspaceIds'>): readonly TuiWorkspaceId[] {
  return resource.workspaceIds ?? (Object.keys(workspaceResources) as TuiWorkspaceId[]).filter((workspace) => workspaceResources[workspace].includes(resource.id));
}
export function workspaceFor(resource: TuiResource | undefined, context: TuiContext | undefined, current?: TuiWorkspaceId): TuiWorkspaceId | undefined {
  if (!resource || resource.id === 'ctx') return undefined;
  if (resource.id === 'local' || resource.id === 'tcp' || resource.id === 'ssh') return resource.id;
  const allowed = resourceWorkspaces(resource);
  if (current && allowed.includes(current)) return current;
  if (context && ['local', 'ssh', 'tcp'].includes(context.kind) && allowed.includes(context.kind as TuiWorkspaceId)) return context.kind as TuiWorkspaceId;
  return allowed[0] ?? current;
}
export function localWorkspaceRows(resources: readonly TuiResource[]): readonly TuiRow[] {
  return resources.filter((resource) => workspaceResources.local.includes(resource.id)).map((resource) => ({
    id: resource.id, cells: { name: resource.label, command: `:${resource.id}`, description: resource.description },
    detail: [{ label: '资源', value: resource.id }, { label: '说明', value: resource.description }],
    navigate: { resourceId: resource.id, contextId: 'local' },
  }));
}
export function enterContextRoute(context: TuiContext): TuiRoute {
  if (context.kind === 'local') return { resourceId: 'local', contextId: context.id };
  if (context.kind === 'tcp') return { resourceId: 'stars', contextId: context.id };
  if (context.kind === 'ssh') return { resourceId: context.defaultResourceId ?? 'sessions', contextId: context.id };
  return { resourceId: context.defaultResourceId ?? 'sessions', contextId: context.id };
}
