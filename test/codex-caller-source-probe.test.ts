import { describe, expect, it } from 'vitest';
import {
  PROBE_LIMITS,
  classifyEntry,
  collectReport,
  parseProcessTable,
  pathShape,
  readProcessTable,
  redactEnv,
  traceAncestry,
} from '../scripts/codex-caller-source-probe.mjs';
import { COMMAND_RUNNER, DESKTOP_EXE, NPM_EXE, cliChain, desktopChain, tableText, wrappedCliChain } from './helpers/codex-caller-source-probe.mjs';

const trace = (text, startPid = 100) => traceAncestry(startPid, parseProcessTable(text));

describe('codex caller source probe', () => {
  it('reports only CODEX_/CROSSCHAT_ variables and never their raw values', () => {
    const env = {
      CODEX_THREAD_ID: '019a-secret-thread',
      CROSSCHAT_CODEX_WINDOW_TOKEN: 'a'.repeat(64),
      PATH: '/usr/bin',
      HOME: '/home/u',
    };
    const out = redactEnv(env);
    expect(out.map((entry) => entry.name)).toEqual(['CODEX_THREAD_ID', 'CROSSCHAT_CODEX_WINDOW_TOKEN']);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('019a-secret-thread');
    expect(serialized).not.toContain('a'.repeat(64));
    // Codex's default shell_environment_policy strips *TOKEN* before a shell sees it.
    expect(out.find((entry) => entry.name === 'CROSSCHAT_CODEX_WINDOW_TOKEN')).toMatchObject({ defaultExcluded: true, length: 64 });
    expect(out.find((entry) => entry.name === 'CODEX_THREAD_ID')).toMatchObject({ defaultExcluded: false });
  });

  it('drops malformed process rows instead of inventing parents', () => {
    const table = parseProcessTable(['garbage', '0\t1\t1\tnode.exe\t', '12\tnope\t1\tnode.exe\t', '13\t1\t5\tbash.exe\t/bin/bash', ''].join('\n'));
    expect([...table.keys()]).toEqual([13]);
    expect(table.get(13)).toMatchObject({ ppid: 1, name: 'bash.exe', shape: 'shell' });
  });

  it('stops at a missing parent rather than guessing the entry', () => {
    expect(trace(cliChain())).toMatchObject({ stopReason: 'root' });
    expect(trace(cliChain()).chain.map((row) => row.pid)).toEqual([100, 200, 300, 400, 500, 600]);
    const truncated = tableText([
      [100, 200, 5000, 'node.exe', ''],
      [200, 999, 4900, 'bash.exe', ''],
    ]);
    expect(trace(truncated)).toMatchObject({ stopReason: 'missing-parent' });
  });

  it('rejects a parent created after its child, so pid reuse cannot fake an entry', () => {
    const text = tableText([
      [100, 200, 5000, 'node.exe', 'C:/Program Files/nodejs/node.exe'],
      [200, 0, 9000, 'bash.exe', 'C:/Program Files/Git/bin/bash.exe'],
    ]);
    expect(trace(text)).toMatchObject({ stopReason: 'creation-order' });
  });

  it('bounds the walk by depth and by cycles', () => {
    const rows = [[100, 200, 5000, 'node.exe', '']];
    for (let pid = 200; pid < 200 + PROBE_LIMITS.maxDepth + 5; pid += 1) rows.push([pid, pid + 1, 5000 - pid, 'x.exe', '']);
    expect(trace(tableText(rows)).stopReason).toBe('depth-limit');
    expect(trace(tableText([[100, 100, 5000, 'node.exe', '']])).stopReason).toBe('cycle');
  });

  it('classifies a CLI shell and a Desktop shell apart, and refuses to guess otherwise', () => {
    expect(classifyEntry(trace(cliChain()).chain)).toMatchObject({ entry: 'cli', basis: 'npm-executor-under-node-launcher' });
    expect(classifyEntry(trace(desktopChain()).chain)).toMatchObject({ entry: 'desktop', basis: 'desktop-bundle-under-app' });
    // Same-daemon / detached executor: no parent left to attribute the shell to.
    expect(classifyEntry(trace(tableText([[100, 200, 5000, 'node.exe', ''], [200, 300, 4900, 'bash.exe', ''], [300, 0, 4800, 'codex.exe', NPM_EXE]])).chain)).toMatchObject({
      entry: 'unknown',
      basis: 'npm-executor-without-node-parent',
    });
    expect(classifyEntry(trace(cliChain()).chain.slice(0, 2))).toMatchObject({ entry: 'unknown', basis: 'no-codex-ancestor' });
  });

  it('sees through the bundled command runner between executor and shell', () => {
    expect(pathShape(COMMAND_RUNNER)).toBe('command-runner');
    const { chain } = trace(wrappedCliChain());
    expect(classifyEntry(chain)).toMatchObject({ entry: 'cli', parent: { shape: 'node' } });
  });

  it('reports an unreadable table instead of a verdict, and never emits absolute paths', async () => {
    const timeout = Object.assign(new Error('killed'), { killed: true });
    await expect(readProcessTable({ run: () => Promise.reject(timeout), platform: 'win32' })).resolves.toMatchObject({
      ok: false,
      reason: 'table-timeout',
    });
    await expect(readProcessTable({ platform: 'darwin' })).resolves.toMatchObject({ ok: false, reason: 'platform-unsupported' });

    const report = collectReport({ env: { CODEX_THREAD_ID: 'tid' }, startPid: 100, table: parseProcessTable(cliChain()) });
    expect(report.verdict.entry).toBe('cli');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('AppData');
    expect(serialized).not.toContain('C:/');
    expect(serialized).not.toContain('tid');
  });

  it('finishes a real process-table read even when the timeout is impossible to meet', async () => {
    const started = Date.now();
    const result = await readProcessTable({ timeoutMs: 1 });
    expect(Date.now() - started).toBeLessThan(PROBE_LIMITS.tableTimeoutMs);
    if (process.platform === 'win32') expect(result).toMatchObject({ ok: false, reason: 'table-timeout' });
  });

  it('classifies this machine without claiming a Codex entry it cannot see', () => {
    const shape = pathShape(process.execPath);
    expect(shape).toBe('node');
    expect(pathShape(DESKTOP_EXE)).toBe('desktop-bundle');
    expect(pathShape(NPM_EXE)).toBe('npm-native');
  });
});
