import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseServeArgs } from '../src/cli.js';
import { guardSameStarDaemon, matchServeProcesses, runServe, selectConnectEntry, type ServeArgs, type ServeDeps } from '../src/commands/serve.js';
import { loadBrokerFile, registryFileOf, writeBrokerFile } from '../src/serve/registry.js';
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

  it('parses --remove values, --list/--detach/--list-nodes/--list-members flags; 034 admin-key/via value flags', () => {
    expect(parseServeArgs(['--remove', 'node-2'])).toEqual({ remove: 'node-2' });
    expect(parseServeArgs(['--list', '--detach'])).toEqual({ list: true, detach: true });
    expect(parseServeArgs(['--list-nodes'])).toEqual({ listNodes: true });
    expect(parseServeArgs(['--list-members'])).toEqual({ listMembers: true });
    expect(parseServeArgs(['--gen-admin-key', 'ops'])).toEqual({ genAdminKeyArg: 'ops' });
    expect(parseServeArgs(['--remove-admin-key=wsl'])).toEqual({ removeAdminKeyArg: 'wsl' });
    expect(parseServeArgs(['--via', 'tcp:d32b'])).toEqual({ viaArg: 'tcp:d32b' });
    expectUsage(() => parseServeArgs(['--gen-admin-key']), 'requires a value');
  });

  // 034：--port 无命令——解析直接拒（教学指 broker.json 手编），help 也不再提供
  it('rejects --port outright (port is a hand-edited broker.json field)', () => {
    expectUsage(() => parseServeArgs(['--port', '7000']), '已移除');
    expectUsage(() => parseServeArgs(['--port=7000']), 'broker.json');
    expectUsage(() => parseServeArgs(['--port']), '已移除');
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

  it('parses --connect with an optional star name, --name with a value, and rejects unknown options', () => {
    expect(parseServeArgs(['--name', 'cloud'])).toEqual({ nameArg: 'cloud' });
    expect(parseServeArgs(['--name=cloud'])).toEqual({ nameArg: 'cloud' });
    expectUsage(() => parseServeArgs(['--name']), 'requires a value');
    // 033：星生命周期旗标（值型；--remove-star 与 --remove 是不同旗标）
    expect(parseServeArgs(['--remove-star', 'alpha'])).toEqual({ removeStarArg: 'alpha' });
    expect(parseServeArgs(['--remove-star=alpha'])).toEqual({ removeStarArg: 'alpha' });
    expect(parseServeArgs(['--show-name', 'win-box'])).toEqual({ showNameArg: 'win-box' });
    expectUsage(() => parseServeArgs(['--remove-star']), 'requires a value');
    expectUsage(() => parseServeArgs(['--show-name']), 'requires a value');
    expect(parseServeArgs(['--connect'])).toEqual({ connect: '' });
    expect(parseServeArgs(['--connect', 'box'])).toEqual({ connect: 'box' });
    expect(parseServeArgs(['--connect=box'])).toEqual({ connect: 'box' });
    expectUsage(() => parseServeArgs(['--wat']), 'unknown option');
  });

  it('rejects non-flag tokens and missing values', () => {
    expectUsage(() => parseServeArgs(['serve', 'extra']), 'unexpected argument');
  });
});

describe('runServe --gen-key / --list / --remove', () => {
  const ifaces = (ip: string): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
    eth0: [{ address: ip, netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: `${ip}/24` }],
  });

  /** 033：serve 永不造星——管理命令用例先播种一颗星（显式命名，免懒 bootstrap）。 */
  function seedStar(dir: string, name = 'main'): void {
    writeBrokerFile(registryFileOf(dir), { stars: [{ starId: 'aaaabbbbcccc', name, nodes: [], roster: [] }] });
  }

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
    seedStar(dir);
    const rc = await runServe({ genKeyArg: '2', starArg: 'main' }, deps);
    expect(rc).toBe(0);
    expect(lines[0]).toContain('自动探测 broker 地址：192.168.1.7:7260');
    expect(lines[0]).toContain('人工核对改写 node.json 的 host 与 port');
    expect(lines.some((l) => l.includes('· broker 是云主机/NAT 内网机 → host 填对外公网 IP'))).toBe(true);
    expect(lines.some((l) => l.includes('放置路径（目标机器）：~/.crosschat/tcp/node.json'))).toBe(true);
    expect(lines.some((l) => l.includes('本命令须在 broker 机上执行'))).toBe(true);
    expect(lines.at(-1)).toBe('钥匙已进入终端回滚缓冲，分发完建议清屏');
    const jsonBlocks = lines.filter((l) => l.startsWith('{'));
    expect(jsonBlocks).toHaveLength(2);
    const parsed = JSON.parse(jsonBlocks[0]!) as { brokers: { host: string; port: number; name: string; starId: string; key: string }[]; showName: string };
    // B0：gen-key 输出带 starId（与注册表同值）；B-fix：只产出数组形状（单星=一项）；
    // E0：条目 name=星名（033 起首星显式命名——seedStar 的 'main'）
    expect(parsed.brokers).toHaveLength(1);
    expect(parsed.brokers[0]).toEqual({ host: '192.168.1.7', port: 7260, name: 'main', starId: expect.any(String), key: expect.any(String) });
    expect(parsed.showName).toBe('改成「贴这份配置的机器」的名字');
    expect(parsed.brokers[0]!.starId).toMatch(/^[0-9a-f]{12}$/);
    expect(parsed.brokers[0]!.key).toMatch(/^[0-9a-f]{64}$/);
    // 032：注册表单形状——starId 与钥匙条目同在 stars[0]
    expect(loadBrokerFile(registryFileOf(dir)).stars[0]!.starId).toBe(parsed.brokers[0]!.starId);
    expect(loadBrokerFile(registryFileOf(dir)).stars[0]!.nodes.map((n) => n.label)).toEqual(['node-1', 'node-2']);
  });

  // 034：--port 旗标已删（端口=broker.json 手编字段）——旧行为用例随葬，
  // 解析面拒绝用例见 parseServeArgs 组。

  it('lists registered nodes with label/machine/mid/added-at', async () => {
    const { deps, lines, dir } = makeDeps();
    seedStar(dir);
    await runServe({ genKeyArg: '1', starArg: 'main' }, deps);
    lines.length = 0;
    const rc = await runServe({ list: true }, deps);
    expect(rc).toBe(0);
    expect(lines[0]).toContain('label');
    expect(lines[1]).toContain('node-1');
  });

  it('removes a label and reports misses with exit 1', async () => {
    const { deps, lines, dir } = makeDeps();
    seedStar(dir);
    await runServe({ genKeyArg: '1', starArg: 'main' }, deps);
    lines.length = 0;
    expect(await runServe({ remove: 'node-1', starArg: 'main' }, deps)).toBe(0);
    expect(lines.at(-1)).toContain('已从星 main 移除 node-1'); // 032：消息带星域限定
    expect(await runServe({ remove: 'node-1', starArg: 'main' }, deps)).toBe(1);
    expect(lines.at(-1)).toContain('未找到 node-1');
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
  const cfg = (entries: Array<{ host: string; port: number; name?: string; starId?: string; key: string }>) => ({ entries });

  it('star-name exact match wins; empty selector falls back to entries[0]', () => {
    const config = cfg([
      { host: 'h1', port: 1, name: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, name: 'br2', starId: 'dddd00001111', key: 'k2' },
    ]);
    expect(selectConnectEntry('br2', config).entry.host).toBe('h2');
    expect(selectConnectEntry('br1', config).entry.host).toBe('h1');
    const bare = selectConnectEntry('', config);
    expect(bare.entry.host).toBe('h1');
    expect(bare.selector).toBe('');
  });

  it('unique starId prefix selects that entry and carries the raw selector', () => {
    const config = cfg([
      { host: 'h1', port: 1, name: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, name: 'br2', starId: 'dddd00001111', key: 'k2' },
    ]);
    const hit = selectConnectEntry('dddd', config);
    expect(hit.entry.host).toBe('h2');
    expect(hit.selector).toBe('dddd');
  });

  it('ambiguous starId prefix teaches lengthening', () => {
    const config = cfg([
      { host: 'h1', port: 1, name: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, name: 'br2', starId: 'aaaabbbbdddd', key: 'k2' },
    ]);
    expectUsage(() => selectConnectEntry('aaaa', config), '加长前缀使其唯一');
  });

  it('no hit with multiple entries lists them in cloud(6b76e1) form and gives an example', () => {
    const config = cfg([
      { host: 'h1', port: 1, name: 'br1', starId: 'aaaabbbbcccc', key: 'k1' },
      { host: 'h2', port: 2, key: 'k2' },
    ]);
    expectUsage(() => selectConnectEntry('nope', config), '不匹配任何条目');
    try {
      selectConnectEntry('nope', config);
    } catch (err) {
      const msg = (err as MultichatError).message;
      expect(msg).toContain('br1(aaaabb)');
      expect(msg).toContain('(无名)(starId 未登记)');
      expect(msg).toContain('示例：--connect br1');
    }
  });

  it('no hit on a single named entry keeps the legacy mismatch error; name-less single entry tolerates', () => {
    const aliased = cfg([{ host: 'h', port: 1, name: 'real-alias', key: 'k' }]);
    expectUsage(() => selectConnectEntry('other', aliased), '与 node.json 条目的星名 real-alias 不符');
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

  // 026 空停善后：守护已异常死亡（零进程命中）但状态文件停在 online/running——复位 stopped，其余字段保留
  it('bare --stop with zero hits resets ghost status files (online/running → stopped, fields kept)', async () => {
    const kills: number[] = [];
    const { deps, lines } = stopDeps([], kills);
    const tcp = join(deps.baseDir, 'tcp');
    mkdirSync(tcp, { recursive: true });
    const nodeJson = JSON.stringify({ state: 'online', brokerAlias: 'cloud', since: '2026-10-16T00:00:00.000Z', lastUpdated: new Date().toISOString(), version: '1.6.2' });
    writeFileSync(join(tcp, 'status-node.json'), nodeJson);
    writeFileSync(join(tcp, 'status-broker.json'), JSON.stringify({ state: 'running', port: 7260, lastUpdated: new Date().toISOString(), version: '1.6.2' }));
    expect(await runServe({ stopTarget: 'both' }, deps)).toBe(0);
    expect(kills).toEqual([]);
    const node = JSON.parse(readFileSync(join(tcp, 'status-node.json'), 'utf8')) as Record<string, unknown>;
    const broker = JSON.parse(readFileSync(join(tcp, 'status-broker.json'), 'utf8')) as Record<string, unknown>;
    expect(node.state).toBe('stopped');
    expect(node.version).toBe('1.6.2'); // 其余字段保留
    expect(broker.state).toBe('stopped');
    expect(lines.some((l) => l.includes('stop node: 幽灵状态文件复位 stopped：status-node.json'))).toBe(true);
    expect(lines.some((l) => l.includes('stop broker: 幽灵状态文件复位 stopped：status-broker.json'))).toBe(true);
  });
});
});

describe('E0 serve --name（星名持久化与互斥）', () => {
  // makeDeps 在本 describe 外不可见——等价构造（hostname 'h' → 缺省星名 'h'）
  const ifaces = (): NodeJS.Dict<NetworkInterfaceInfo[]> => ({});
  function nameDeps(): { deps: ServeDeps; dir: string } {
    const dir = mkdtempSync(join(root, 'e0name-'));
    return {
      dir,
      deps: {
        baseDir: dir,
        stdout: () => {},
        env: {},
        version: 'test',
        machineId: () => 'MID',
        hostname: () => 'h',
        networkInterfaces: ifaces,
        now: () => Date.now(),
        onSignal: () => {},
      },
    };
  }

  it('persists an explicit --name (with --port semantics: given once, remembered)', async () => {
    const { deps, dir } = nameDeps();
    writeBrokerFile(registryFileOf(dir), { stars: [{ starId: 'aaaabbbbcccc', name: 'orig', nodes: [], roster: [] }] }); // 033：先有星才有改名
    await runServe({ nameArg: 'cloud', genKeyArg: '1', starArg: 'aaaabbbbcccc' }, deps);
    // 032 单形状：星名在 stars[0].name
    expect(loadBrokerFile(registryFileOf(dir)).stars[0]!.name).toBe('cloud');
    // 再给即更新
    await runServe({ nameArg: 'home', genKeyArg: '1', starArg: 'aaaabbbbcccc' }, deps);
    expect(loadBrokerFile(registryFileOf(dir)).stars[0]!.name).toBe('home');
  });

  it('rejects a colon / overlong / empty name with USAGE naming the rule', async () => {
    for (const bad of ['cl:oud', 'a'.repeat(33), '']) {
      const { deps, dir } = nameDeps();
      writeBrokerFile(registryFileOf(dir), { stars: [{ starId: 'aaaabbbbcccc', name: 'orig', nodes: [], roster: [] }] });
      const err: unknown = await runServe({ nameArg: bad, genKeyArg: '1', starArg: 'aaaabbbbcccc' }, deps).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(MultichatError);
      expect((err as MultichatError).code).toBe('USAGE');
      expect((err as MultichatError).message).toContain('禁冒号');
    }
  });

  it('rejects --name together with --connect (node mode has no star name)', async () => {
    const { deps } = nameDeps();
    for (const connect of ['cloud', '']) {
      const err: unknown = await runServe({ nameArg: 'cloud', connect }, deps).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(MultichatError);
      expect((err as MultichatError).code).toBe('USAGE');
      expect((err as MultichatError).message).toContain('--name 是 broker 星名设置，节点模式不支持');
    }
  });

  it('gen-key stamps the star name into every entry and keeps showName as the placeholder', async () => {
    const lines: string[] = [];
    const base = nameDeps();
    const deps = { ...base.deps, stdout: (l: string) => lines.push(l) };
    writeBrokerFile(registryFileOf(base.dir), { stars: [{ starId: 'aaaabbbbcccc', name: 'orig', nodes: [], roster: [] }] }); // 033：先有星（改名+发钥同命令）
    await runServe({ nameArg: 'cloud', genKeyArg: '1', starArg: 'aaaabbbbcccc' }, deps);
    const block = lines.find((l) => l.startsWith('{'))!;
    const parsed = JSON.parse(block) as { brokers: { name: string }[]; showName: string };
    expect(parsed.brokers[0]!.name).toBe('cloud');
    expect(parsed.showName).toBe('改成「贴这份配置的机器」的名字');
  });
});

describe('013 双开防护：--connect 同星守护互顶拒绝', () => {
  const raw = (pid: number, cmdline: string) => ({ pid, exe: 'node.exe', cmdline });

  /** 双星 node.json（wsl-star=条目0 默认腿，cloud=条目1）+ 可注入进程清单的 deps。 */
  function guardDeps(procs: ReturnType<typeof raw>[]): { deps: ServeDeps; lines: string[] } {
    const dir = mkdtempSync(join(root, 'guard-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      JSON.stringify({
        brokers: [
          { host: 'h1', port: 1, name: 'wsl-star', starId: '5aed24ff9900', key: 'k1' },
          { host: 'h2', port: 2, name: 'cloud', starId: '6bff0099aa00', key: 'k2' },
        ],
        showName: 't',
      }),
    );
    const lines: string[] = [];
    return {
      lines,
      deps: {
        baseDir: dir,
        stdout: (line) => lines.push(line),
        env: {},
        version: 'test',
        machineId: () => 'MID',
        hostname: () => 'h',
        networkInterfaces: () => ({}),
        now: () => Date.now(),
        onSignal: () => {},
        listServeProcesses: () => procs,
      },
    };
  }

  async function refuse(args: ServeArgs, deps: ServeDeps): Promise<MultichatError> {
    const err: unknown = await runServe(args, deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultichatError);
    return err as MultichatError;
  }

  it('refuses a same-spelling daemon (foreground) and teaches the live spelling with pid', async () => {
    const { deps } = guardDeps([raw(10, 'node dist/cli.js serve --connect wsl-star')]);
    const err = await refuse({ connect: 'wsl-star' }, deps);
    expect(err.code).toBe('USAGE');
    expect(err.message).toContain('本机已有 wsl-star(5aed24) 的节点守护在跑');
    expect(err.message).toContain('pid 10');
    expect(err.message).toContain('--connect wsl-star');
    expect(err.message).toContain('先执行: crosschat serve --stop wsl-star');
  });

  it('catches cross-spelling collisions and teaches the live daemon spelling, not mine', async () => {
    // 我用 starId 前缀、活守护用星名——同条目即同星；教学必须用对方的 wsl-star
    const byName = guardDeps([raw(11, 'node dist/cli.js serve --connect wsl-star')]);
    const err1 = await refuse({ connect: '5aed24' }, byName.deps);
    expect(err1.message).toContain('--stop wsl-star');
    // 反向：我用星名、活守护用 =starId 前缀——教学用对方的 5aed24
    const byPrefix = guardDeps([raw(12, 'node dist/cli.js serve --connect=5aed24')]);
    const err2 = await refuse({ connect: 'wsl-star' }, byPrefix.deps);
    expect(err2.message).toContain('--stop 5aed24');
  });

  it('bare collides with bare (both default to entries[0]) and teaches --stop node', async () => {
    const { deps } = guardDeps([raw(13, 'node dist/cli.js serve --connect')]);
    const err = await refuse({ connect: '' }, deps);
    expect(err.message).toContain('wsl-star(5aed24)');
    expect(err.message).toContain('pid 13');
    expect(err.message).toContain('裸默认腿');
    expect(err.message).toContain('crosschat serve --stop node');
  });

  it('a bare live daemon also collides with the explicit name resolving to entries[0]', async () => {
    const { deps } = guardDeps([raw(14, 'node dist/cli.js serve --connect')]);
    const err = await refuse({ connect: 'wsl-star' }, deps);
    expect(err.message).toContain('--stop node'); // 对方是裸守护，只能教停全部节点
  });

  it('refuses the --detach form before spawning the child', async () => {
    const { deps, lines } = guardDeps([raw(15, 'node dist/cli.js serve --connect wsl-star')]);
    const err = await refuse({ connect: 'wsl-star', detach: true }, deps);
    expect(err.message).toContain('--stop wsl-star');
    expect(lines).toEqual([]); // 未走到 runDetach 的后台播报
  });

  it('passes different stars, unrelated procs and unresolvable cmdlines silently', () => {
    // 不同星：wsl-star 活着，我连 cloud
    expect(() => guardSameStarDaemon('cloud', guardDeps([raw(20, 'node dist/cli.js serve --connect wsl-star')]).deps)).not.toThrow();
    // 无节点守护：broker 与无 --connect 的进程不参与判定；--connect=zzzz 解析不出星（异常形状）放行
    expect(() =>
      guardSameStarDaemon(
        'wsl-star',
        guardDeps([raw(21, 'node dist/cli.js serve --detach'), raw(22, 'node dist/cli.js serve --connect=zzzz')]).deps,
      ),
    ).not.toThrow();
    // 我的选择器本身解析不了：护栏放行（教学报错留给 runForegroundNode）
    expect(() => guardSameStarDaemon('nope', guardDeps([]).deps)).not.toThrow();
    // 扫描本身抛错 → 放行（探测不到=现状行为）
    const broken = guardDeps([]);
    broken.deps.listServeProcesses = () => {
      throw new Error('scan failed');
    };
    expect(() => guardSameStarDaemon('wsl-star', broken.deps)).not.toThrow();
  });
});

describe('030 killPid 确认死亡（linux SIGTERM 兜住 → SIGKILL 兜底）', () => {
  it('SIGTERM 被忽略的进程仍被确认杀灭；已死 pid 视为成功', async () => {
    const { spawn } = await import('node:child_process');
    const { killPid } = await import('../src/commands/serve.js');
    // 孙进程形态：真 stop 场景里守护不是 stop 命令的亲子女——同步探活窗口内亲子女
    // 无法收割（linux 僵尸假活），故经中间进程隔一层血亲（孤儿由 init 收尸）
    const INNER = "process.on('SIGTERM',()=>{});setInterval(()=>{},1e9);";
    const outerScript =
      `const {spawn}=require('node:child_process');` +
      `const c=spawn(process.execPath,['-e',${JSON.stringify(INNER)}],{stdio:'ignore',detached:true});` +
      `c.unref();console.log(c.pid);process.exit(0);`;
    const outer = spawn(process.execPath, ['-e', outerScript], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    outer.stdout.on('data', (d) => (out += d));
    await new Promise((resolve) => outer.on('exit', resolve));
    const victim = parseInt(out.trim(), 10);
    expect(Number.isInteger(victim)).toBe(true);
    expect(killPid(victim, 3_000)).toBe(true); // 确认死亡，非仅信号已发（linux 走 SIGKILL 升级路）
    const deadline = Date.now() + 2_000;
    let gone = false;
    while (Date.now() < deadline) {
      try {
        process.kill(victim, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        gone = true;
        break;
      }
    }
    expect(gone).toBe(true);
    expect(killPid(victim, 1_000)).toBe(true); // 尸体 pid：目标态已达成
  }, 20_000);
});
