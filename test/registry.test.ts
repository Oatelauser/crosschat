import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  findByExactName,
  listClaudeSessions,
  type ClaudeSessionEntry,
} from '../src/claude/registry.js';

// A pid that has already exited (spawnSync runs to completion).
const deadPid = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }).pid ?? -1;

const tmp = mkdtempSync(join(tmpdir(), 'crosschat-registry-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeEntry(file: string, body: string): void {
  writeFileSync(join(tmp, file), body, 'utf8');
}

writeEntry(
  '1001.json',
  JSON.stringify({
    pid: process.pid, // must be a live process to survive the filter
    sessionId: 's-alive',
    kind: 'interactive',
    name: 'alpha',
    status: 'idle',
    cwd: 'D:\\work',
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'a'.repeat(32),
  }),
);
writeEntry(
  '1002.json',
  JSON.stringify({
    pid: deadPid,
    sessionId: 's-dead',
    kind: 'bg',
    name: 'ghost',
    status: 'idle',
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'b'.repeat(32),
  }),
);
writeEntry(
  '1003.json',
  JSON.stringify({
    pid: 1003,
    sessionId: 's-daemon',
    kind: 'daemon',
    name: 'daemon',
    status: 'busy',
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'c'.repeat(32),
  }),
);
writeEntry('1004.json', '{not json');
writeEntry('1005.json', JSON.stringify({ pid: 1005, kind: 'interactive' }));
writeEntry('1006.key', '{"peerToken":"x"}'); // key files are not registry entries

describe('listClaudeSessions', () => {
  it('keeps only routable kinds with live processes and counts malformed entries', () => {
    const scan = listClaudeSessions(tmp);
    expect(scan.malformed).toBe(2);
    expect(scan.sessions).toHaveLength(1);
    expect(scan.sessions[0]).toMatchObject({
      pid: process.pid,
      kind: 'interactive',
      name: 'alpha',
      messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'a'.repeat(32),
    });
  });

  it('returns an empty scan for a missing directory', () => {
    const scan = listClaudeSessions(join(tmp, 'does-not-exist'));
    expect(scan).toEqual({ sessions: [], malformed: 0 });
  });
});

describe('findByExactName', () => {
  const sessions: ClaudeSessionEntry[] = [
    {
      pid: 11,
      sessionId: 's1',
      kind: 'interactive',
      status: 'idle',
      messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-1',
      name: 'alpha',
    },
    {
      pid: 22,
      sessionId: 's2',
      kind: 'bg',
      status: 'busy',
      messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-2',
      name: 'beta',
    },
  ];

  it('finds the unique exact match', () => {
    expect(findByExactName('beta', sessions)?.pid).toBe(22);
  });

  it('returns undefined for no match', () => {
    expect(findByExactName('gamma', sessions)).toBeUndefined();
  });

  it('throws NAME_COLLISION listing candidates on duplicates', () => {
    const clash = [
      ...sessions,
      { ...sessions[1], pid: 33, sessionId: 's3', name: 'beta' },
    ];
    try {
      findByExactName('beta', clash);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('NAME_COLLISION');
      expect((err as Error).message).toContain('pid 22');
      expect((err as Error).message).toContain('pid 33');
    }
  });
});
