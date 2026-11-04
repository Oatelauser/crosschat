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
import {
  COMMAND_RUNNER,
  DESKTOP_EXE,
  NODE_EXE,
  NPM_EXE,
  cliChain,
  desktopChain,
  missingMetadataChain,
  portableChain,
  tableText,
  wrappedCliChain,
} from './helpers/codex-caller-source-probe.mjs';

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
    // This only records that the name matches the pattern Codex's opt-in filter
    // removes; the filter is off unless ignore_default_excludes is set to false.
    expect(out.find((entry) => entry.name === 'CROSSCHAT_CODEX_WINDOW_TOKEN')).toMatchObject({
      matchesDefaultExcludePattern: true,
      length: 64,
    });
    expect(out.find((entry) => entry.name === 'CODEX_THREAD_ID')).toMatchObject({ matchesDefaultExcludePattern: false });
  });

  it('drops malformed process rows instead of inventing parents', () => {
    const table = parseProcessTable(['garbage', '0\t1\t1\tnode.exe\t', '12\tnope\t1\tnode.exe\t', '13\t1\t5\tbash.exe\t/bin/bash', ''].join('\n'));
    expect([...table.keys()]).toEqual([13]);
    expect(table.get(13)).toMatchObject({ ppid: 1, name: 'bash.exe', shape: 'shell' });
  });

  it('drops unusable creation times instead of treating them as real', () => {
    const table = parseProcessTable(
      tableText([
        [10, 0, 'Infinity', 'a.exe', ''],
        [11, 0, 'NaN', 'b.exe', ''],
        [12, 0, '134377278198597070', 'c.exe', ''],
      ]),
    );
    expect(table.get(10).createdAt).toBe(0);
    expect(table.get(11).createdAt).toBe(0);
    expect(table.get(12).createdAt).toBe(134377278198597070);
  });

  it('never skips a nearer unrecognized codex executor for a farther known one', () => {
    const { chain } = trace(portableChain());
    expect(classifyEntry(chain)).toMatchObject({
      entry: 'unknown',
      basis: 'unrecognized-codex-executor',
      candidate: { pid: 300, name: 'codex.exe' },
    });
  });

  it('refuses to name an entry when the instance metadata is incomplete', () => {
    const { chain } = trace(missingMetadataChain());
    expect(classifyEntry(chain)).toMatchObject({
      entry: 'unknown',
      basis: 'incomplete-instance-metadata',
      executor: { pid: 300, shape: 'desktop-bundle' },
    });
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

  it('reports why a table is unavailable instead of emitting a verdict', async () => {
    const timeout = Object.assign(new Error('killed'), { killed: true });
    await expect(readProcessTable({ run: () => Promise.reject(timeout), platform: 'win32' })).resolves.toMatchObject({
      ok: false,
      reason: 'table-timeout',
    });
    const tooLarge = Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    await expect(readProcessTable({ run: () => Promise.reject(tooLarge), platform: 'win32' })).resolves.toMatchObject({
      ok: false,
      reason: 'table-too-large',
    });
    await expect(readProcessTable({ run: () => Promise.reject(new Error('denied')), platform: 'win32' })).resolves.toMatchObject({
      ok: false,
      reason: 'table-unreadable',
    });
    // Windows-only research probe: other platforms are unsupported, not scanned.
    await expect(readProcessTable({ platform: 'linux' })).resolves.toMatchObject({ ok: false, reason: 'platform-unsupported' });
    await expect(readProcessTable({ platform: 'darwin' })).resolves.toMatchObject({ ok: false, reason: 'platform-unsupported' });
  });

  it('passes the caller timeout to the process-table command', async () => {
    const seen: { command?: string; timeoutMs?: number } = {};
    const run = (command: string, _args: string[], timeoutMs: number) => {
      seen.command = command;
      seen.timeoutMs = timeoutMs;
      return Promise.resolve('');
    };
    await readProcessTable({ run, timeoutMs: 250, platform: 'win32' });
    expect(seen).toEqual({ command: 'powershell.exe', timeoutMs: 250 });
  });

  it('reports an unreadable table instead of a verdict, and never emits absolute paths', async () => {
    const report = collectReport({ env: { CODEX_THREAD_ID: 'tid' }, startPid: 100, table: parseProcessTable(cliChain()) });
    expect(report.verdict.entry).toBe('cli');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('AppData');
    expect(serialized).not.toContain('C:/');
    expect(serialized).not.toContain('tid');
  });

  it('classifies the documented install layouts from paths alone', () => {
    expect(pathShape(DESKTOP_EXE)).toBe('desktop-bundle');
    expect(pathShape(NPM_EXE)).toBe('npm-native');
    expect(pathShape(NODE_EXE)).toBe('node');
    expect(pathShape('D:/portable/codex.exe')).toBe('other');
  });
});
