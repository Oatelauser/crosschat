import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codexHomeDir,
  listWriterLocks,
  lookupRolloutMeta,
  lookupRolloutMetas,
} from '../src/codex/rollout-meta.js';
import { formatCreatedAt, formatCwdShort, runStatus } from '../src/commands/status.js';
import type { CodexThreadWithMeta } from '../src/codex/discovery.js';

const THREAD_ID = '01a05bb8-bf35-7980-bf4d-6b48e1380d77';

const REAL_FIRST_LINE = JSON.stringify({
  timestamp: '2026-09-01T06:47:21.438Z',
  type: 'session_meta',
  payload: {
    session_id: THREAD_ID,
    timestamp: '2026-09-01T06:47:09.365Z',
    cwd: 'D:\\workspace\\CC\\ai-front-spec',
    originator: 'codex-tui',
    source: 'terminal',
  },
});

const tempDirs: string[] = [];

function makeCodexHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'crosschat-rollout-'));
  tempDirs.push(home);
  return home;
}

function writeRollout(home: string, fileName: string, firstLine: string): void {
  const dir = join(home, 'sessions', '2026', '09', '01');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), `${firstLine}\n{"type":"event_item"}\n`);
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('lookupRolloutMeta', () => {
  it('finds the rollout file by thread id and parses session_meta', () => {
    const home = makeCodexHome();
    writeRollout(
      home,
      `rollout-2026-09-01T14-47-09-${THREAD_ID}.jsonl`,
      REAL_FIRST_LINE,
    );
    expect(lookupRolloutMeta(home, THREAD_ID)).toEqual({
      cwd: 'D:\\workspace\\CC\\ai-front-spec',
      originator: 'codex-tui',
      createdAt: '2026-09-01T06:47:09.365Z',
    });
  });

  it('returns undefined when nothing matches (including a missing sessions tree)', () => {
    const home = makeCodexHome();
    writeRollout(home, `rollout-2026-09-01T14-47-09-${THREAD_ID}.jsonl`, REAL_FIRST_LINE);
    expect(lookupRolloutMeta(home, '11111111-2222-3333-4444-555555555555')).toBeUndefined();
    const emptyHome = makeCodexHome();
    expect(lookupRolloutMeta(emptyHome, THREAD_ID)).toBeUndefined();
  });

  it('tolerates a malformed first line', () => {
    const home = makeCodexHome();
    writeRollout(home, `rollout-x-${THREAD_ID}.jsonl`, '{not json at all');
    expect(lookupRolloutMeta(home, THREAD_ID)).toBeUndefined();
  });

  it('tolerates missing payload fields (keeps whichever are present)', () => {
    const home = makeCodexHome();
    writeRollout(
      home,
      `rollout-x-${THREAD_ID}.jsonl`,
      JSON.stringify({ type: 'session_meta', payload: { cwd: '/home/u/proj' } }),
    );
    expect(lookupRolloutMeta(home, THREAD_ID)).toEqual({
      cwd: '/home/u/proj',
      originator: undefined,
      createdAt: undefined,
    });
  });

  it('reads a first line larger than one internal read buffer', () => {
    const home = makeCodexHome();
    const padded = JSON.stringify({
      type: 'session_meta',
      payload: { cwd: 'D:\\proj', originator: 'codex-tui', timestamp: '2026-09-01T00:00:00Z', pad: 'x'.repeat(200_000) },
    });
    writeRollout(home, `rollout-x-${THREAD_ID}.jsonl`, padded);
    expect(lookupRolloutMeta(home, THREAD_ID)?.cwd).toBe('D:\\proj');
  });

  it('batch lookup hits and misses in one walk', () => {
    const home = makeCodexHome();
    writeRollout(home, `rollout-x-${THREAD_ID}.jsonl`, REAL_FIRST_LINE);
    const other = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
    const metas = lookupRolloutMetas(home, [THREAD_ID, other]);
    expect(metas.size).toBe(1);
    expect(metas.get(THREAD_ID)?.originator).toBe('codex-tui');
  });
});

describe('listWriterLocks', () => {
  const writeLock = (home: string, fileName: string): void => {
    mkdirSync(join(home, 'thread-writer-locks'), { recursive: true });
    writeFileSync(join(home, 'thread-writer-locks', fileName), '');
  };

  it('collects per-thread locks and skips the coordination lock / non-lock files / subdirs', () => {
    const home = makeCodexHome();
    writeLock(home, `${THREAD_ID}.lock`);
    writeLock(home, '11111111-2222-3333-4444-555555555555.lock');
    writeLock(home, '.coordination.lock');
    writeLock(home, 'not-a-lock.txt');
    mkdirSync(join(home, 'thread-writer-locks', 'subdir.lock'));
    expect(listWriterLocks(home)).toEqual(
      new Set([THREAD_ID, '11111111-2222-3333-4444-555555555555']),
    );
  });

  it('returns an empty set when the directory is missing', () => {
    expect(listWriterLocks(makeCodexHome())).toEqual(new Set());
  });
});

describe('status formatting', () => {
  it('formatCwdShort keeps the last two path segments', () => {
    expect(formatCwdShort('D:\\workspace\\CC\\ai-front-spec')).toBe('CC\\ai-front-spec');
    expect(formatCwdShort('/home/u/proj')).toBe('u/proj');
    expect(formatCwdShort('solo')).toBe('solo');
    expect(formatCwdShort(undefined)).toBe('-');
  });

  it('formatCreatedAt renders MM-DD HH:mm locally or dashes', () => {
    const formatted = formatCreatedAt('2026-09-01T06:47:09.365Z');
    expect(formatted).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatCreatedAt('not-a-date')).toBe('-');
    expect(formatCreatedAt(undefined)).toBe('-');
  });

  it('runStatus renders dir/created/originator columns and falls back to dashes', async () => {
    const threads: CodexThreadWithMeta[] = [
      {
        id: THREAD_ID,
        name: null,
        status: 'idle',
        meta: { cwd: 'D:\\workspace\\CC\\ai-front-spec', originator: 'codex-tui', createdAt: '2026-09-01T06:47:09.365Z' },
      },
      { id: 'deadbeef-0000-0000-0000-000000000000', name: 'named', status: 'not_loaded' },
    ];
    const deps = {
      listClaudeSessions: () => ({
        sessions: [
          {
            pid: 4242,
            sessionId: 's1',
            kind: 'claude',
            name: 'mapper',
            status: 'idle',
            cwd: 'D:\\workspace\\CC\\multichat',
            messagingSocketPath: '',
          },
        ],
        malformed: 0,
      }),
      listCodexThreads: () => Promise.resolve(threads),
    };
    const text = await runStatus(deps, false);
    const lines = text.split('\n');
    const claudeLine = lines.find((line) => line.includes('mapper')) as string;
    expect(claudeLine).toContain('pid 4242');
    expect(claudeLine).toContain('CC\\multichat');
    const codexLines = lines.filter((line) => line.includes('01a05bb8') || line.includes('deadbeef'));
    expect(codexLines[0]).toContain('CC\\ai-front-spec');
    expect(codexLines[0]).toContain('codex-tui');
    expect(codexLines[0]).toContain('01a05bb8');
    expect(codexLines[0]).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
    expect(codexLines[1]).toContain('-');
    expect(codexLines[1]).toContain('named');

    const json = JSON.parse(await runStatus(deps, true)) as {
      claude: Array<{ cwd: string | null }>;
      codex: Array<{ cwd: string | null; createdAt: string | null; originator: string | null }>;
    };
    expect(json.claude[0]).toMatchObject({ name: 'mapper', cwd: 'D:\\workspace\\CC\\multichat' });
    expect(json.codex[0]).toMatchObject({
      cwd: 'D:\\workspace\\CC\\ai-front-spec',
      createdAt: '2026-09-01T06:47:09.365Z',
      originator: 'codex-tui',
    });
    expect(json.codex[1]).toEqual({ name: 'named', status: 'not_loaded', id: 'deadbeef', cwd: null, createdAt: null, originator: null });
  });

  it('runStatus marks TUI-held threads and appends unlisted locks (006)', async () => {
    const home = makeCodexHome();
    const unlisted = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    for (const id of [THREAD_ID, unlisted]) {
      mkdirSync(join(home, 'thread-writer-locks'), { recursive: true });
      writeFileSync(join(home, 'thread-writer-locks', `${id}.lock`), '');
    }
    const threads: CodexThreadWithMeta[] = [
      { id: THREAD_ID, name: 'held-one', status: 'idle' },
      { id: 'deadbeef-0000-0000-0000-000000000000', name: 'free-one', status: 'not_loaded' },
    ];
    const baseDeps = {
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: () => Promise.resolve(threads),
    };
    const text = await runStatus({ ...baseDeps, listWriterLocks: () => listWriterLocks(home) }, false);
    const heldLine = text.split('\n').find((line) => line.includes('held-one')) as string;
    expect(heldLine).toContain('TUI占用');
    const freeLine = text.split('\n').find((line) => line.includes('free-one')) as string;
    expect(freeLine).not.toContain('TUI占用');
    const unlistedLine = text.split('\n').find((line) => line.includes('aaaaaaaa')) as string;
    expect(unlistedLine).toContain('未列入');
    expect(unlistedLine).toContain('TUI占用');

    const json = JSON.parse(
      await runStatus({ ...baseDeps, listWriterLocks: () => listWriterLocks(home) }, true),
    ) as { codex: Array<Record<string, unknown>> };
    expect(json.codex[0]).toMatchObject({ id: '01a05bb8', held: true });
    expect(json.codex[1]).not.toHaveProperty('held');
    expect(json.codex[2]).toEqual({
      name: null, status: 'not_listed', id: 'aaaaaaaa', cwd: null, createdAt: null, originator: null, held: true,
    });

    // Zero regression: without the dep, neither marker nor JSON field appears.
    const bareText = await runStatus(baseDeps, false);
    expect(bareText).not.toContain('TUI占用');
    const bareJson = JSON.parse(await runStatus(baseDeps, true)) as { codex: Array<Record<string, unknown>> };
    for (const row of bareJson.codex) expect(row).not.toHaveProperty('held');
  });

  it('codexHomeDir prefers CODEX_HOME', () => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = 'Z:\\custom-codex';
    try {
      expect(codexHomeDir()).toBe('Z:\\custom-codex');
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });
});
