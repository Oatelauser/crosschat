/** Preserve existing audit text and frequency while attaching immutable star identity. */
export function formatAdminAudit(action: string, subject: string, source: string, starIds?: readonly string[]): string {
  return `audit admin-op ${action} ${subject} 来源=${source}${starIds?.length ? ` starIds=${JSON.stringify([...new Set(starIds)])}` : ''}`;
}

export function isAdminAudit(line: string): boolean { return /(?:^|\s)audit admin-op\s/.test(line); }
export function auditStarIds(line: string): readonly string[] | undefined {
  if (!isAdminAudit(line)) return undefined;
  const marker = line.lastIndexOf(' starIds=');
  if (marker < 0) return undefined;
  try {
    const value: unknown = JSON.parse(line.slice(marker + ' starIds='.length));
    return Array.isArray(value) && value.length > 0 && value.length <= 1000 && value.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 1024) ? value : undefined;
  } catch { return undefined; }
}
