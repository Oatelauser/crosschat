import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => fixture.home,
}));

import { realStarJoinDeps, StarJoiner } from '../src/commands/session-star.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat launcher logs-'));
beforeEach(() => { fixture.home = mkdtempSync(join(root, 'home-')); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

function launcher() {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    ...realStarJoinDeps(),
    stdout: (line: string) => { out.push(line); },
    stderr: (line: string) => { err.push(line); },
    listClaudeSessions: () => ({ sessions: [] }),
    listCodexThreads: async () => [],
  };
  return { out, err, joiner: new StarJoiner({ deps, side: 'claude', connects: ['cloudstar'] }) };
}

describe('启动器实际错误日志', () => {
  it('首次未配置时创建日志目录，并把终端错误写入所指的完整日志路径', async () => {
    const { out, err, joiner } = launcher();
    try {
      await joiner.begin();
      const file = join(fixture.home, '.crosschat', 'tcp', 'launcher.log');
      expect(out).toEqual([]);
      expect(err).toHaveLength(1);
      expect(err[0]).toContain(file);
      expect(existsSync(file)).toBe(true);
      const saved = readFileSync(file, 'utf8');
      expect(saved).toContain('入星失败');
      expect(saved).toContain('node.json');
    } finally {
      await joiner.stop();
    }
  });

  it('日志路径不可写时仍显示原始错误，并明确说明日志写入失败及完整路径', async () => {
    const file = join(fixture.home, '.crosschat', 'tcp', 'launcher.log');
    mkdirSync(file, { recursive: true });
    const { out, err, joiner } = launcher();
    try {
      await joiner.begin();
      expect(out).toEqual([]);
      expect(err).toHaveLength(1);
      expect(err[0]).toContain('node.json');
      expect(err[0]).toContain('日志写入失败');
      expect(err[0]).toContain(file);
    } finally {
      await joiner.stop();
    }
  });
});
