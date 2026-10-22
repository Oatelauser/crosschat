export interface WatchdogEvidence { pid: number; heartbeatAt: number }

/** Read the current writer's lock metadata without retaining its ownership token. */
export function parseWatchdogEvidence(text: string): WatchdogEvidence {
  const fields = text.trim().split(/\s+/);
  const pid = Number(fields[0]); const heartbeatAt = Number(fields[1]);
  if (fields.length !== 3 || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(heartbeatAt) || heartbeatAt < 0) {
    throw new Error('Invalid watchdog evidence.');
  }
  return { pid, heartbeatAt };
}
