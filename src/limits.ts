/**
 * 单条正文上限与轮次预算的解析（票A）：纯函数小模块，send.ts 只调用。
 * 两个旋钮完全对称——参数（--max-body-kb / --max-turn）> 环境变量
 * （CROSSCHAT_MAX_BODY_KIB / CROSSCHAT_MAX_TURN）> 不设置；非法来源
 * （非正整数 / NaN / ≤0）静默降级到下一层，容错风格同 federation.ts 的
 * CROSSCHAT_SSH_TIMEOUT_MS（配置是给操作者的旋钮，不是给攻击者的面）。
 * 启动器（crosschat claude / codex）的旋钮剥离与校验也住这里（第五单）。
 */

import { MultichatError } from './errors.js';

/** 兜底默认（ticket 004 现状值）：16KiB——默认路径输出字节不变的锚点。 */
export const DEFAULT_MAX_BODY_BYTES = 16_384;

/** 来源值的绝对上界（16384 KiB = 16MiB）：再大的配置也按此封顶（确定行为）。 */
export const MAX_BODY_KIB_CEILING = 16_384;

/** 目标端点封顶（传输天花板）：claude 投递管道 64KiB；codex 1MiB。 */
export const CLAUDE_ENDPOINT_MAX_BODY_BYTES = 65_536;
export const CODEX_ENDPOINT_MAX_BODY_BYTES = 1_048_576;

/** 正整数解析：非数字 / NaN / 非整数 / ≤0 → undefined。send 侧静默降级；wrapper 侧直接报错（一次性人工输入）。 */
export function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** 配置层上限（字节）：--max-body-kb > CROSSCHAT_MAX_BODY_KIB > 16384；超 16MiB 按封顶处理。 */
export function resolveConfiguredMaxBodyBytes(
  maxBodyKb: string | undefined,
  env: Record<string, string | undefined>,
): number {
  const kb = parsePositiveInt(maxBodyKb) ?? parsePositiveInt(env.CROSSCHAT_MAX_BODY_KIB);
  if (kb === undefined) return DEFAULT_MAX_BODY_BYTES;
  return Math.min(kb, MAX_BODY_KIB_CEILING) * 1_024;
}

/** 轮次预算：--max-turn > CROSSCHAT_MAX_TURN > 不设置（undefined）。 */
export function resolveMaxTurn(
  maxTurn: string | undefined,
  env: Record<string, string | undefined>,
): number | undefined {
  return parsePositiveInt(maxTurn) ?? parsePositiveInt(env.CROSSCHAT_MAX_TURN);
}

/** 哪个硬顶挡下了这次发送（决定报错教学说"可提额"还是"提额无效"）。 */
export type BodyHardCap = 'claude' | 'codex' | 'ssh-precheck' | 'absolute';

/**
 * MESSAGE_TOO_LARGE 教学文案（票A）：本地变体保留分形态尾巴（单机落盘 /
 * ssh scp 旁路 / 其他形态未定义——这些教学路径已被线上文档引用，原文不
 * 动），追加提额途径；到端点/绝对硬顶时明说封顶多少、提额无效。
 * remote = 远端来件（--origin 在场，008 D5）：读报错的是发送方，单机教学
 * 对它是误导——换远端变体，绝口不提"可提额 --max-body-kb"（发送方本机
 * 提额管不到接收方，指这条路 = 无效循环）。remote 与 hardCap 可组合：
 * 无 hardCap → 接收方操作者可调 CROSSCHAT_MAX_BODY_KIB 或走 scp；
 * 有 hardCap → 端点硬顶连接收方提额也过不了，scp 是唯一出路（此时同样
 * 不提 CROSSCHAT_MAX_BODY_KIB，指了也是死路）。
 */
export function bodyTooLargeMessage(
  size: number,
  limitBytes: number,
  via: string | undefined,
  hardCap?: BodyHardCap,
  remote = false,
): string {
  // scp 旁路三步教学（远端变体的普适出路）：发送方落盘 → scp 到接收方
  // 本机 /tmp → --via 发对端本地路径。
  const scpDetour =
    '大内容走 scp 旁路：发送方先落盘，scp <文件> <接收方>:/tmp/<文件名>，' +
    '再 crosschat send --via ssh:<接收方> … --body "见 /tmp/<文件名>"（scp 与 --via 共用同一份 ssh 配置）。';
  if (remote) {
    if (hardCap === 'claude' || hardCap === 'codex') {
      const fact = hardCap === 'claude' ? 'claude 端点硬顶 64KiB' : 'codex 端点硬顶 1MiB';
      return `Body is ${size} bytes; ${fact}——提额无效（这是一条 --via 跨机来件）。${scpDetour}`;
    }
    return (
      `Body is ${size} bytes; the limit is ${limitBytes} on this machine (a --via remote send). ` +
      `发送方本机提额无效——上限属接收方（本机）配置。${scpDetour}` +
      '确需直发大内容：由接收方（本机）操作者调 CROSSCHAT_MAX_BODY_KIB。'
    );
  }
  const tail =
    via === undefined
      ? 'Write the content to a file and send the path instead.'
      : via.startsWith('ssh:')
        ? `跨机大内容（ssh 形态）：先 scp <文件> ${via.slice(4)}:/tmp/<文件名>，再 crosschat send --via ${via} … --body "见 /tmp/<文件名>"（scp 与 --via 共用同一份 ssh 配置）`
        : '该传输形态的大内容通道未定义——ssh 形态支持 scp 旁路（见文档），或压缩/分段后重试。';
  const note =
    hardCap === 'claude'
      ? 'claude 端点硬顶 64KiB——提额无效，只能落盘发文件路径。'
      : hardCap === 'codex'
        ? 'codex 端点硬顶 1MiB——提额无效，只能落盘发文件路径。'
        : hardCap === 'ssh-precheck'
          ? 'ssh 形态本地按最宽端点（codex 1MiB）预检——提额无效；远端自行复检（claude 端点更严，64KiB）。'
          : hardCap === 'absolute'
            ? '已到绝对上界 16MiB——提额无效，只能落盘发文件路径。'
            : '可提额：--max-body-kb <KiB> 或 CROSSCHAT_MAX_BODY_KIB=<KiB>（claude 端点硬顶 64KiB、codex 端点 1MiB，到顶只能落盘）。';
  return `Body is ${size} bytes; the limit is ${limitBytes}. ${note}${tail}`;
}

/**
 * 启动器旋钮剥离（票A 第五单）：crosschat claude / crosschat codex 共用。
 * --max-body-kb / --max-turn 是 crosschat 的旋钮（不是 claude/codex 的参数），
 * 从转发 argv 里剥掉（space 与 = 两种形态、重复取后值，同 parseSendArgs），
 * 其余 token 原样留给真 CLI（含子命令，一个不解析）。
 */
const LAUNCHER_KNOBS = new Set(['--max-body-kb', '--max-turn']);

export interface LauncherKnobs {
  /** 剥离旋钮后的转发参数。 */
  passthrough: string[];
  maxBodyKb?: string;
  maxTurn?: string;
}

export function splitLauncherKnobs(argv: readonly string[]): LauncherKnobs {
  const passthrough: string[] = [];
  let maxBodyKb: string | undefined;
  let maxTurn: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : token;
    if (!LAUNCHER_KNOBS.has(name)) {
      passthrough.push(token);
      continue;
    }
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    const value = inline ?? argv[++i];
    if (value === undefined) {
      throw new MultichatError('USAGE', `crosschat: ${name} requires a value (正整数)`);
    }
    if (name === '--max-body-kb') maxBodyKb = value;
    else maxTurn = value;
  }
  return { passthrough, maxBodyKb, maxTurn };
}

/**
 * 启动器旋钮校验：与 send 侧的静默降级有意相反——send 的参数面对 agent 的
 * 自纠循环，非法值降级到下一层才不打断它；启动器是人在终端前的一次性交互
 * 输入，报错立即可见、当场纠正，直接失败是更诚实的教学。
 */
export function validateLauncherKnob(
  command: string,
  name: '--max-body-kb' | '--max-turn',
  raw: string | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  const n = parsePositiveInt(raw);
  if (n === undefined) {
    const legal = name === '--max-body-kb' ? '--max-body-kb 64（正整数 KiB）' : '--max-turn 40（正整数轮数）';
    throw new MultichatError('USAGE', `${command}: ${name} 需要正整数（如 ${legal}）；收到: ${raw}`);
  }
  return n;
}
