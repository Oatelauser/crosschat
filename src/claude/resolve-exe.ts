import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from '../errors.js';

/**
 * Resolves the real claude executable on Windows: the npm global APPDATA
 * layout first (same binary the live tests spawn), then `where.exe` hits.
 * Extracted from test/live/claude-live.test.ts so the product shares it.
 */

export interface ResolveExeDeps {
  env: Record<string, string | undefined>;
  /** Runs `where <name>`; a failed launch reports status null. */
  where(name: string): { status: number | null; stdout: string };
  exists(path: string): boolean;
}

export function defaultResolveExeDeps(): ResolveExeDeps {
  return {
    env: process.env,
    where: (name) => spawnSync('where.exe', [name], { encoding: 'utf8' }),
    exists: existsSync,
  };
}

export function resolveClaudeExe(deps: ResolveExeDeps = defaultResolveExeDeps()): string {
  const candidates: string[] = [];
  if (deps.env.APPDATA) {
    candidates.push(
      join(
        deps.env.APPDATA,
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'node_modules',
        '@anthropic-ai',
        'claude-code-win32-x64',
        'claude.exe',
      ),
    );
  }
  const where = deps.where('claude');
  if (where.status === 0) {
    for (const line of where.stdout.split(/\r?\n/)) {
      if (line.trim().toLowerCase().endsWith('.exe')) candidates.push(line.trim());
    }
  }
  const found = candidates.find((candidate) => deps.exists(candidate));
  if (found === undefined) {
    throw new MultichatError(
      'CLAUDE_EXE_NOT_FOUND',
      `claude executable not found; tried: ${candidates.join(', ')}`,
    );
  }
  return found;
}
