/** `crosschat uninstall`（票B B3）：清单组装 / --yes / serve 在跑拒删 / 不存在跳过 / 确认交互。 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runUninstall, type UninstallDeps } from '../src/commands/uninstall.js';
import { parseUninstallArgs } from '../src/cli.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-uninstall-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Fixture {
  deps: UninstallDeps;
  lines: string[];
  home: string;
  state: string;
  skills: string[];
  confirmed: { value?: boolean };
}

function fixture(confirmResult = true): Fixture {
  const home = mkdtempSync(join(root, 'home-'));
  const state = mkdtempSync(join(root, 'state-'));
  const skills = [mkdtempSync(join(root, 'sk-c-')), mkdtempSync(join(root, 'sk-x-'))];
  const lines: string[] = [];
  const confirmed: { value?: boolean } = {};
  return {
    home,
    state,
    skills,
    lines,
    confirmed,
    deps: {
      crosschatHome: home,
      stateRoot: state,
      legacyStateRoots: [],
      skillDirs: skills,
      now: () => Date.now(),
      stdout: (line) => lines.push(line),
      confirm: () => {
        confirmed.value = confirmResult;
        return Promise.resolve(confirmResult);
      },
    },
  };
}

function seedServeRunning(home: string, which: 'broker' | 'node'): void {
  const tcp = join(home, 'tcp');
  mkdirSync(tcp, { recursive: true });
  const file =
    which === 'broker'
      ? { state: 'running', lastUpdated: new Date().toISOString() }
      : { state: 'online', lastUpdated: new Date().toISOString() };
  writeFileSync(join(tcp, `status-${which}.json`), JSON.stringify(file));
}

describe('runUninstall', () => {
  it('--yes deletes the full list and prints the npm finisher', async () => {
    const f = fixture();
    mkdirSync(join(f.home, 'tcp'), { recursive: true });
    writeFileSync(join(f.home, 'tcp', 'node.json'), '{}');
    writeFileSync(join(f.state, 'send-log.jsonl'), '{}\n');
    writeFileSync(join(f.skills[0]!, 'SKILL.md'), 'x');
    expect(await runUninstall({ yes: true }, f.deps)).toBe(0);
    expect(f.lines[0]).toBe('将删除：');
    expect(f.lines.filter((l) => l.startsWith('  1. '))[0]).toContain(f.home);
    expect(f.lines).toContain(`已删除：${f.home}`);
    expect(f.lines).toContain(`已删除：${f.state}`);
    expect(f.lines).toContain(`已删除：${f.skills[0]!}`);
    expect(f.lines.at(-1)).toBe('收尾：npm uninstall -g @oatelauser/crosschat');
    expect(existsSync(f.home)).toBe(false);
    expect(existsSync(f.state)).toBe(false);
  });

  it('marks absent items as skipped', async () => {
    const f = fixture();
    const absent = {
      ...f.deps,
      crosschatHome: join(root, 'no-home'),
      stateRoot: join(root, 'no-state'),
      skillDirs: [join(root, 'no-sk-c'), join(root, 'no-sk-x')],
    };
    const rc = await runUninstall({ yes: true }, absent);
    expect(rc).toBe(0);
    expect(f.lines.filter((l) => l.startsWith('已删除：'))).toHaveLength(0);
    expect(f.lines.filter((l) => l.startsWith('跳过（不存在）：'))).toHaveLength(4);
  });

  it('refuses while a fresh broker status file says running, deleting nothing', async () => {
    const f = fixture();
    seedServeRunning(f.home, 'broker');
    expect(await runUninstall({ yes: true }, f.deps)).toBe(1);
    expect(f.lines[0]).toContain('拒绝删除');
    expect(f.lines[0]).toContain('serve --stop');
    expect(existsSync(f.home)).toBe(true);
  });

  it('refuses while a fresh node status file exists (node client alive)', async () => {
    const f = fixture();
    seedServeRunning(f.home, 'node');
    expect(await runUninstall({ yes: true }, f.deps)).toBe(1);
    expect(f.lines[0]).toContain('拒绝删除');
  });

  it('B2: refuses while any named daemon (status-node-<选择器>.json) is fresh', async () => {
    const f = fixture();
    const tcp = join(f.home, 'tcp');
    mkdirSync(tcp, { recursive: true });
    // 默认守护已死（无文件），命名守护活着
    writeFileSync(join(tcp, 'status-node-work.json'), JSON.stringify({ state: 'online', lastUpdated: new Date().toISOString() }));
    expect(await runUninstall({ yes: true }, f.deps)).toBe(1);
    expect(f.lines[0]).toContain('拒绝删除');
    expect(existsSync(f.home)).toBe(true);
  });

  it('stale status files do not block the uninstall', async () => {
    const f = fixture();
    const tcp = join(f.home, 'tcp');
    mkdirSync(tcp, { recursive: true });
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(join(tcp, 'status-broker.json'), JSON.stringify({ state: 'running', lastUpdated: stale }));
    expect(await runUninstall({ yes: true }, f.deps)).toBe(0);
  });

  it('without --yes asks for confirmation: decline cancels, accept deletes', async () => {
    const no = fixture(false);
    expect(await runUninstall({}, no.deps)).toBe(1);
    expect(no.lines.at(-1)).toBe('已取消，未删除任何内容');
    expect(existsSync(no.home)).toBe(true);
    const yes = fixture(true);
    expect(await runUninstall({}, yes.deps)).toBe(0);
    expect(yes.confirmed.value).toBe(true);
    expect(existsSync(yes.home)).toBe(false);
  });

  it('014: sweeps both courts — legacy state roots go too, deduped paths listed once', async () => {
    const f = fixture();
    const legacy = [mkdtempSync(join(root, 'legacy-')), join(root, 'legacy-absent')];
    writeFileSync(join(legacy[0]!, 'conversations.json'), '{}');
    mkdirSync(join(f.home, 'tcp'), { recursive: true });
    writeFileSync(join(f.home, 'tcp', 'node.json'), '{}'); // serve not running: no status files
    const lines: string[] = [];
    const rc = await runUninstall({ yes: true }, {
      ...f.deps,
      legacyStateRoots: legacy,
      stdout: (line) => lines.push(line),
    });
    expect(rc).toBe(0);
    expect(lines).toContain(`已删除：${legacy[0]!}`);
    expect(lines).toContain(`跳过（不存在）：${legacy[1]!}`);
    expect(existsSync(legacy[0]!)).toBe(false);
    // same path twice (014: stateRoot === crosschatHome) → listed and deleted once
    const same = fixture();
    mkdirSync(join(same.home, 'tcp'), { recursive: true });
    const dedupLines: string[] = [];
    expect(
      await runUninstall({ yes: true }, {
        ...same.deps,
        stateRoot: same.home,
        stdout: (line) => dedupLines.push(line),
      }),
    ).toBe(0);
    expect(dedupLines.filter((l) => l.includes(same.home)).length).toBe(2); // one listing + one deletion
    expect(existsSync(same.home)).toBe(false);
  });
});

describe('parseUninstallArgs', () => {
  it('accepts bare and --yes, rejects anything else', () => {
    expect(parseUninstallArgs([])).toEqual({});
    expect(parseUninstallArgs(['--yes'])).toEqual({ yes: true });
    expect(() => parseUninstallArgs(['--force'])).toThrowError(MultichatError);
  });
});
