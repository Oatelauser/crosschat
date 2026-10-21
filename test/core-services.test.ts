import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDetachedService, stopServices, waitForServiceReady } from '../src/application/services/local.js';
import { matchServeProcesses } from '../src/application/services/processes.js';
import { registryFileOf, writeBrokerFile } from '../src/serve/registry.js';

const roots: string[] = [];
function fixture(): string {
  const baseDir = mkdtempSync(join(tmpdir(), 'crosschat-core-services-'));
  roots.push(baseDir);
  writeBrokerFile(registryFileOf(baseDir), { port: 7260, stars: [] });
  return baseDir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('service launch and readiness', () => {
  it('reports a successful spawn only as starting and requires a matching live ready status', async () => {
    const baseDir = fixture();
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ pid: 1234, unref }));
    const started = startDetachedService({ extraArgs: [], logName: 'broker.log', port: 7260 }, {
      baseDir, entryPath: process.execPath, env: { FIXTURE: 'yes' }, spawn, now: () => 100,
    });
    expect(started).toMatchObject({ state: 'starting', pid: 1234, target: 'broker' });
    expect(unref).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ detached: true, env: { FIXTURE: 'yes', CROSSCHAT_SERVE_DETACHED: '1' } });
    if (started.state !== 'starting') throw new Error('expected starting fixture');
    let clock = 100;
    const snapshots = [
      { state: 'running', pid: 9999, lastUpdated: new Date(100).toISOString() },
      { state: 'running', pid: 1234, lastUpdated: new Date(110).toISOString() },
    ];
    expect(await waitForServiceReady(started, {
      readStatus: () => snapshots.shift(), isProcessAlive: () => true,
      now: () => clock, wait: async (ms) => { clock += ms; },
    }, { timeoutMs: 50, pollMs: 10 })).toMatchObject({ state: 'ready', pid: 1234 });
    expect(clock).toBe(110);
  });

  it('returns failed when launch fails or a child never proves readiness', async () => {
    const baseDir = fixture();
    expect(startDetachedService({ extraArgs: [], logName: 'broker.log' }, {
      baseDir, entryPath: process.execPath, env: {}, spawn: () => { throw new Error('spawn failed'); },
    })).toMatchObject({ state: 'failed' });
    const started = startDetachedService({ extraArgs: ['--connect', 'cloud'], logName: 'node-cloud.log' }, {
      baseDir, entryPath: process.execPath, env: {}, spawn: () => ({ pid: 1234, unref() {} }), now: () => 100,
    });
    if (started.state !== 'starting') throw new Error('expected starting fixture');
    let clock = 100;
    expect(await waitForServiceReady(started, {
      readStatus: () => ({ state: 'connecting', pid: 1234, lastUpdated: new Date(clock).toISOString() }),
      isProcessAlive: () => true, now: () => clock, wait: async (ms) => { clock += ms; },
    }, { timeoutMs: 30, pollMs: 10 })).toMatchObject({ state: 'failed', reason: 'readiness-timeout' });
  });
});

describe('service stop application', () => {
  it('retains executable/script identity filtering and stops nodes before confirmed brokers', () => {
    const baseDir = fixture();
    const candidates = matchServeProcesses([
      { pid: 11, exe: 'node.exe', cmdline: 'node D:/fixture/dist/cli.js serve --connect cloud' },
      { pid: 12, exe: 'node.exe', cmdline: 'node D:/fixture/dist/cli.js serve' },
      { pid: 13, exe: 'powershell.exe', cmdline: 'node D:/fixture/dist/cli.js serve' },
      { pid: 14, exe: 'node.exe', cmdline: 'node D:/other/program.js serve' },
    ], 999);
    expect(candidates.map((candidate) => candidate.pid)).toEqual([11, 12]);
    const killed: number[] = [];
    expect(stopServices({ target: 'both' }, {
      baseDir, listServeProcesses: () => candidates,
      killPid: (pid) => { killed.push(pid); return true; }, pidsOnPort: () => new Set([12]),
    })).toMatchObject({ state: 'ready' });
    expect(killed).toEqual([11, 12]);
  });

  it('does not kill a matching broker without port confirmation or claim it stopped', () => {
    const baseDir = fixture();
    const killPid = vi.fn(() => true);
    const result = stopServices({ target: 'broker' }, {
      baseDir, listServeProcesses: () => [{ pid: 12, cmdline: 'node D:/fixture/dist/cli.js serve' }],
      killPid, pidsOnPort: () => new Set(),
    });
    expect(killPid).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: 'failed', events: [{ kind: 'unconfirmed', pid: 12, port: 7260 }] });
  });

  it('resets ghost status only when no corresponding process was found, preserving other fields', () => {
    const baseDir = fixture();
    mkdirSync(join(baseDir, 'tcp'), { recursive: true });
    const file = join(baseDir, 'tcp', 'status-node-cloud.json');
    writeFileSync(file, JSON.stringify({ state: 'online', pid: 1234, brokerAlias: 'cloud', extra: 'retain' }));
    const result = stopServices({ target: 'node' }, {
      baseDir, listServeProcesses: () => [], killPid: () => { throw new Error('must not kill'); },
    });
    expect(result).toMatchObject({ state: 'ready' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ state: 'stopped', pid: 1234, brokerAlias: 'cloud', extra: 'retain' });
  });
});
