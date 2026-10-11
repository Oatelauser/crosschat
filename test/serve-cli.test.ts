import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseServeArgs } from '../src/cli.js';
import { matchServeProcesses, runServe, type ServeDeps } from '../src/commands/serve.js';
import { listNodes, registryFileOf } from '../src/serve/registry.js';
import { MultichatError } from '../src/errors.js';
import type { NetworkInterfaceInfo } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'crosschat-serve-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function expectUsage(fn: () => unknown, needle: string): void {
  try {
    fn();
    expect.unreachable('should have thrown USAGE');
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    const me = err as MultichatError;
    expect(me.code).toBe('USAGE');
    expect(me.message).toContain(needle);
  }
}

describe('parseServeArgs', () => {
  it('defaults --gen-key to 1 and parses value forms', () => {
    expect(parseServeArgs(['--gen-key'])).toEqual({ genKeyArg: '1' });
    expect(parseServeArgs(['--gen-key', '2'])).toEqual({ genKeyArg: '2' });
    expect(parseServeArgs(['--gen-key=3'])).toEqual({ genKeyArg: '3' });
  });

  it('parses --port/--remove values and --list/--detach flags', () => {
    expect(parseServeArgs(['--port', '7260'])).toEqual({ portArg: '7260' });
    expect(parseServeArgs(['--remove', 'node-2'])).toEqual({ remove: 'node-2' });
    expect(parseServeArgs(['--list', '--detach'])).toEqual({ list: true, detach: true });
    expect(parseServeArgs(['--port=7000', '--list'])).toEqual({ portArg: '7000', list: true });
  });

  it('parses --stop with optional broker|node value', () => {
    expect(parseServeArgs(['--stop'])).toEqual({ stopTarget: 'both' });
    expect(parseServeArgs(['--stop', 'broker'])).toEqual({ stopTarget: 'broker' });
    expect(parseServeArgs(['--stop', 'node'])).toEqual({ stopTarget: 'node' });
    expectUsage(() => parseServeArgs(['--stop', 'wat']), '--stop 只接受 broker|node');
  });

  it('does not swallow a following flag as --gen-key value', () => {
    expect(parseServeArgs(['--gen-key', '--list'])).toEqual({ genKeyArg: '1', list: true });
  });

  it('parses --connect with an optional alias and rejects unknown options', () => {
    expect(parseServeArgs(['--connect'])).toEqual({ connect: '' });
    expect(parseServeArgs(['--connect', 'box'])).toEqual({ connect: 'box' });
    expect(parseServeArgs(['--connect=box'])).toEqual({ connect: 'box' });
    expectUsage(() => parseServeArgs(['--wat']), 'unknown option');
  });

  it('rejects non-flag tokens and missing values', () => {
    expectUsage(() => parseServeArgs(['serve', 'extra']), 'unexpected argument');
    expectUsage(() => parseServeArgs(['--port']), 'requires a value');
  });
});

describe('runServe --gen-key / --list / --remove', () => {
  const ifaces = (ip: string): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
    eth0: [{ address: ip, netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: `${ip}/24` }],
  });

  function makeDeps(): { deps: ServeDeps; lines: string[]; dir: string } {
    const dir = mkdtempSync(join(root, 'case-'));
    const lines: string[] = [];
    return {
      dir,
      lines,
      deps: {
        baseDir: dir,
        stdout: (line) => lines.push(line),
        env: {},
        version: '1.4.0-test',
        machineId: () => 'MID',
        hostname: () => 'h',
        networkInterfaces: () => ifaces('192.168.1.7'),
        now: () => Date.now(),
        onSignal: () => {},
      },
    };
  }

  it('prints warning first, N node.json blocks, security hint last; registers keys', async () => {
    const { deps, lines, dir } = makeDeps();
    const rc = await runServe({ genKeyArg: '2' }, deps);
    expect(rc).toBe(0);
    expect(lines[0]).toContain('自动探测 broker 地址：192.168.1.7');
    expect(lines[0]).toContain('请人工核对，不保证正确');
    expect(lines.at(-1)).toBe('钥匙已进入终端回滚缓冲，分发完建议清屏');
    const jsonBlocks = lines.filter((l) => l.startsWith('{'));
    expect(jsonBlocks).toHaveLength(2);
    const parsed = JSON.parse(jsonBlocks[0]!) as { broker: { host: string; port: number; alias: string }; key: string };
    expect(parsed.broker).toEqual({ host: '192.168.1.7', port: 7260, alias: 'h' });
    expect(parsed.key).toMatch(/^[0-9a-f]{64}$/);
    expect(listNodes(registryFileOf(dir)).map((n) => n.label)).toEqual(['node-1', 'node-2']);
  });

  it('persists an explicit --port into the registry', async () => {
    const { deps, dir } = makeDeps();
    await runServe({ genKeyArg: '1', portArg: '9000' }, deps);
    expect(JSON.parse(readFileSync(registryFileOf(dir), 'utf8'))).toMatchObject({ port: 9000 });
  });

  it('rejects an out-of-range port with USAGE', async () => {
    const { deps } = makeDeps();
    const err: unknown = await runServe({ portArg: '70000' }, deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).message).toContain('1-65535');
  });

  it('lists registered nodes with label/machine/mid/added-at', async () => {
    const { deps, lines } = makeDeps();
    await runServe({ genKeyArg: '1' }, deps);
    lines.length = 0;
    const rc = await runServe({ list: true }, deps);
    expect(rc).toBe(0);
    expect(lines[0]).toContain('label');
    expect(lines[1]).toContain('node-1');
  });

  it('removes a label and reports misses with exit 1', async () => {
    const { deps, lines } = makeDeps();
    await runServe({ genKeyArg: '1' }, deps);
    lines.length = 0;
    expect(await runServe({ remove: 'node-1' }, deps)).toBe(0);
    expect(lines.at(-1)).toBe('已移除 node-1');
    expect(await runServe({ remove: 'node-1' }, deps)).toBe(1);
    expect(lines.at(-1)).toBe('未找到 node-1');
  });
});

describe('B3.1 bug3: matchServeProcesses identity gate (no host/shell kills)', () => {
  const raw = (pid: number, exe: string, cmdline: string) => ({ pid, exe, cmdline });

  it('skips wsl.exe/bash/powershell hosts whose cmdline embeds the nested serve text', () => {
    const procs = [
      raw(111, 'C:\\Windows\\System32\\wsl.exe', 'wsl -e bash -c exec node /mnt/d/ws/CC/multichat/dist/cli.js serve --connect yang'),
      raw(112, 'C:\\Windows\\System32\\bash.exe', 'bash -c node /mnt/d/ws/dist/cli.js serve --connect yang'),
      raw(113, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell node dist/cli.js serve'),
      raw(114, 'C:\\Windows\\System32\\conhost.exe', 'conhost --connect serve'),
    ];
    expect(matchServeProcesses(procs, 1)).toEqual([]);
  });

  it('kills only real node/crosschat processes carrying the dist/cli.js + serve signature', () => {
    const procs = [
      raw(211, 'C:\\Program Files\\nodejs\\node.exe', 'node D:\\workspace\\CC\\multichat\\dist\\cli.js serve --detach'),
      raw(212, 'node', 'node /usr/lib/node_modules/@oatelauser/crosschat/dist/cli.js serve --connect'),
      raw(213, 'crosschat', '/usr/local/bin/crosschat serve'),
      raw(214, 'node.exe', 'node D:\\other\\server.js serve --port 7260'),
      raw(1, 'node', 'node dist/cli.js serve'),
    ];
    const hits = matchServeProcesses(procs, 1);
    // 213 = crosschat 直跑但命令行无 dist/cli.js 脚本特征（包管理器改名场景）→ 跳过；
    // 214 = 无脚本特征；pid 1 = 自身。win 下 npm 实装经 node dist/cli.js（211 形态）。
    expect(hits.map((p) => p.pid)).toEqual([211, 212]);
  });
});
