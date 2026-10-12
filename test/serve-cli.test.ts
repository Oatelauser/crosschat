import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseServeArgs } from '../src/cli.js';
import { matchServeProcesses, runServe, selectConnectEntry, type ServeDeps } from '../src/commands/serve.js';
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

  it('parses --stop with optional broker|node value; other values become B2 selectors', () => {
    expect(parseServeArgs(['--stop'])).toEqual({ stopTarget: 'both' });
    expect(parseServeArgs(['--stop', 'broker'])).toEqual({ stopTarget: 'broker' });
    expect(parseServeArgs(['--stop', 'node'])).toEqual({ stopTarget: 'node' });
    // B2：--stop <选择器>——只停该选择器的节点守护
    expect(parseServeArgs(['--stop', 'wat'])).toEqual({ stopSelector: 'wat' });
    expect(parseServeArgs(['--stop=work'])).toEqual({ stopSelector: 'work' });
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
    expect(lines[0]).toContain('自动探测 broker 地址：192.168.1.7:7260');
    expect(lines[0]).toContain('人工核对改写 node.json 的 host 与 port');
    expect(lines.some((l) => l.includes('· broker 是云主机/NAT 内网机 → host 填对外公网 IP'))).toBe(true);
    expect(lines.some((l) => l.includes('放置路径（目标机器）：~/.crosschat/tcp/node.json'))).toBe(true);
    expect(lines.some((l) => l.includes('本命令须在 broker 机上执行'))).toBe(true);
    expect(lines.at(-1)).toBe('钥匙已进入终端回滚缓冲，分发完建议清屏');
    const jsonBlocks = lines.filter((l) => l.startsWith('{'));
    expect(jsonBlocks).toHaveLength(2);
    const parsed = JSON.parse(jsonBlocks[0]!) as { broker: { host: string; port: number; alias: string; starId?: string }; key: string };
    // B0：gen-key 输出带 starId（与注册表同值）
    expect(parsed.broker).toEqual({ host: '192.168.1.7', port: 7260, alias: 'h', starId: expect.any(String) });
    expect(parsed.broker.starId).toMatch(/^[0-9a-f]{12}$/);
    expect((JSON.parse(readFileSync(registryFileOf(dir), 'utf8')) as { starId?: string }).starId).toBe(parsed.broker.starId);
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

describe('B2 --connect 选择器解析（selectConnectEntry）', () => {
  const cfg = (entries: Array<{ host: string; port: number; alias?: string; starId?: string; key: string }>) => ({ entries });

  it('alias exact match wins; empty selector falls back to entries[0]', () => {
    const config = cfg([
      { host: 'h1', port: 1, alias: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, alias: 'br2', starId: 'dddd00001111', key: 'k2' },
    ]);
    expect(selectConnectEntry('br2', config).entry.host).toBe('h2');
    expect(selectConnectEntry('br1', config).entry.host).toBe('h1');
    const bare = selectConnectEntry('', config);
    expect(bare.entry.host).toBe('h1');
    expect(bare.selector).toBe('');
  });

  it('unique starId prefix selects that entry and carries the raw selector', () => {
    const config = cfg([
      { host: 'h1', port: 1, alias: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, alias: 'br2', starId: 'dddd00001111', key: 'k2' },
    ]);
    const hit = selectConnectEntry('dddd', config);
    expect(hit.entry.host).toBe('h2');
    expect(hit.selector).toBe('dddd');
  });

  it('ambiguous starId prefix teaches lengthening', () => {
    const config = cfg([
      { host: 'h1', port: 1, alias: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, alias: 'br2', starId: 'aaaabbbbdddd', key: 'k2' },
    ]);
    expectUsage(() => selectConnectEntry('aaaa', config), '加长前缀使其唯一');
  });

  it('no hit with multiple entries lists them and gives an example', () => {
    const config = cfg([
      { host: 'h1', port: 1, alias: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, key: 'k2' },
    ]);
    expectUsage(() => selectConnectEntry('nope', config), '不匹配任何条目');
    try {
      selectConnectEntry('nope', config);
    } catch (err) {
      const msg = (err as MultichatError).message;
      expect(msg).toContain('br1(starId aaaabbbbcccc)');
      expect(msg).toContain('(无别名)(starId 未登记)');
      expect(msg).toContain('示例：--connect br1');
    }
  });

  it('no hit on a single aliased entry keeps the legacy mismatch error; alias-less single entry tolerates', () => {
    const aliased = cfg([{ host: 'h', port: 1, alias: 'real-alias', key: 'k' }]);
    expectUsage(() => selectConnectEntry('other', aliased), '与 node.json 的 broker 别名 real-alias 不符');
    const bare = cfg([{ host: 'h', port: 1, key: 'k' }]);
    expect(selectConnectEntry('anything', bare).entry.host).toBe('h');
  });
});

describe('B2 --stop 选择器与停机顺序（注入进程扫描/杀进程）', () => {
  const raw = (pid: number, cmdline: string) => ({ pid, exe: 'node.exe', cmdline });

  function stopDeps(procs: ReturnType<typeof raw>[], kills: number[], portPids?: number[]): { deps: ServeDeps; lines: string[] } {
    const lines: string[] = [];
    return {
      lines,
      deps: {
        baseDir: mkdtempSync(join(root, 'stop-')),
        stdout: (line) => lines.push(line),
        env: {},
        version: 'test',
        machineId: () => 'MID',
        hostname: () => 'h',
        networkInterfaces: () => ({}),
        now: () => Date.now(),
        onSignal: () => {},
        listServeProcesses: () => procs,
        killPid: (pid) => {
          kills.push(pid);
          return true;
        },
        ...(portPids === undefined ? {} : { pidsOnPort: () => new Set(portPids) }),
      },
    };
  }

  it('--stop <选择器> kills only the daemon whose --connect value matches', async () => {
    const kills: number[] = [];
    const { deps, lines } = stopDeps([
      raw(10, 'node dist/cli.js serve --connect work'),
      raw(11, 'node dist/cli.js serve --connect home'),
      raw(12, 'node dist/cli.js serve --connect'),
    ], kills);
    expect(await runServe({ stopSelector: 'work' }, deps)).toBe(0);
    expect(kills).toEqual([10]);
    expect(lines.some((l) => l.includes('pid 10 已终止') && l.includes('--connect work'))).toBe(true);
  });

  it('--stop <选择器> with no matching daemon reports 未找到 and exits 1', async () => {
    const kills: number[] = [];
    const { deps, lines } = stopDeps([
      raw(12, 'node dist/cli.js serve --connect'),
      raw(13, 'node dist/cli.js serve'),
    ], kills);
    expect(await runServe({ stopSelector: 'work' }, deps)).toBe(1);
    expect(lines.at(-1)).toBe('stop node: 未找到 work');
    expect(kills).toEqual([]);
  });

  it('bare --stop stops every node daemon before the broker', async () => {
    const kills: number[] = [];
    const { deps } = stopDeps([
      raw(5, 'node dist/cli.js serve --detach'),
      raw(10, 'node dist/cli.js serve --connect work'),
      raw(11, 'node dist/cli.js serve --connect=home'),
    ], kills, [5]);
    expect(await runServe({ stopTarget: 'both' }, deps)).toBe(0);
    expect(kills).toEqual([10, 11, 5]); // 节点在前，broker 最后
  });
});
});
