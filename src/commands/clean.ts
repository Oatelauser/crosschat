/** Existing `crosschat clean` presentation over the shared maintenance plan. */
import { cleanupClosingLine, cleanupItemLine, cleanupOpeningLine, executeCleanup, planCleanup } from '../application/cleanup/index.js';
import type { CleanupArgs, CleanupDeps } from '../application/cleanup/index.js';

export { SHARD_STALE_MS } from '../application/cleanup/index.js';
export type CleanArgs = CleanupArgs;

export interface CleanDeps extends CleanupDeps {
  stdout(line: string): void;
}

/** unix 下建议无传输时执行——写入中的文件可能被删（手册有注）。 */
export function runClean(args: CleanArgs, deps: CleanDeps): number {
  const plan = planCleanup(args, deps);
  const opening = cleanupOpeningLine(plan);
  if (opening !== undefined) deps.stdout(opening);
  const result = executeCleanup(plan, { onItem: (item) => deps.stdout(cleanupItemLine(plan, item)) });
  const closing = cleanupClosingLine(plan, result);
  if (closing !== undefined) deps.stdout(closing);
  return 0;
}
