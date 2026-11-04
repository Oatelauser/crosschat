/** Stable routing facts; display names and native owner generations are not identities. */
export interface EndpointConstraint { providerId: string; endpointType?: string }
export interface ToolType extends EndpointConstraint { endpointType: string; id: string; label: string }

export const TOOL_TYPES: readonly ToolType[] = [
  { id: 'claude', label: 'Claude Code', providerId: 'claude', endpointType: 'cli' },
  { id: 'codex-cli', label: 'Codex CLI', providerId: 'codex', endpointType: 'cli' },
  { id: 'codex-desktop', label: 'Codex Desktop', providerId: 'codex', endpointType: 'desktop' },
  { id: 'opencode', label: 'OpenCode（共享服务）', providerId: 'opencode', endpointType: 'shared' },
  { id: 'dsh', label: 'Harness Host', providerId: 'dsh', endpointType: 'host' },
  { id: 'dsh-desktop', label: 'Harness Desktop Host', providerId: 'dsh', endpointType: 'desktop' },
];

export function parseToolType(value: string): ToolType | undefined {
  return TOOL_TYPES.find((entry) => entry.id === (value === 'dsh-host' ? 'dsh' : value));
}

/** A strict copyable address must not reuse a legacy family-only qualifier. */
export function toolAddressPrefix(providerId: string, endpointType?: string): string | undefined {
  const type = toolTypeFor(providerId, endpointType);
  return type === 'dsh' ? 'dsh-host' : type;
}

export function toolTypeFor(providerId: string, endpointType?: string): string | undefined {
  return TOOL_TYPES.find((entry) => entry.providerId === providerId && entry.endpointType === endpointType)?.id;
}

export function isEndpointType(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}

/** Unknown Providers may register their own facts; known families must use a verified type. */
export function isEndpointTypeFor(providerId: string, value: unknown): value is string {
  return isEndpointType(value) && (!TOOL_TYPES.some((entry) => entry.providerId === providerId)
    || toolTypeFor(providerId, value) !== undefined);
}

export function nativeTargetKey(target: EndpointConstraint & { nativeId: string }): string {
  return JSON.stringify([target.providerId, target.endpointType ?? '', target.nativeId]);
}

export function endpointConstraintMatches(target: EndpointConstraint, selected: EndpointConstraint): boolean {
  return target.providerId === selected.providerId && (selected.endpointType === undefined || target.endpointType === selected.endpointType);
}
