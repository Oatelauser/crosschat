import { readdirSync } from 'node:fs';

/** Same freshness threshold as the existing status command. */
export const TCP_STATUS_FRESH_MS = 90_000;

/** Default node first, then named connections. Never creates a directory. */
export function listNodeStatusFiles(tcpDir: string, readdir: (dir: string) => string[] = readdirSync): string[] {
  let names: string[];
  try {
    names = readdir(tcpDir);
  } catch {
    return [];
  }
  return names
    .filter((file) => /^status-node(-.*)?\.json$/.test(file))
    .sort((a, b) => (a === 'status-node.json' ? -1 : b === 'status-node.json' ? 1 : a.localeCompare(b)));
}

export function nodeStatusSelector(file: string): string {
  return file === 'status-node.json' ? '' : file.replace(/^status-node-/, '').replace(/\.json$/, '');
}
