import process from 'node:process';

/** True when a process with this pid exists (signal 0 probe). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we may not signal it.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
