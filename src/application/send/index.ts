import type { CodexThreadSummary } from '../../codex/client.js';
import type { SendArgs, SendDeps, SendResult } from './types.js';
import { Buffer } from 'node:buffer';
import { hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import { MultichatError } from '../../errors.js';
import { readNodeConfig } from '../../serve/node-config.js';
import { checkSendLogRate } from '../../rate-limit.js';
import { mailboxFileFor, outboxCount, park } from '../../outbox.js';
import {
  endpointOfIdentity,
  identityKey,
  identityMatchesEndpoint,
  resolveCallerIdentity,
  type CallerIdentity,
} from '../../identity.js';
import { resolveTargetById, resolveTargetByName } from '../../resolve.js';
import { composeEnvelope } from '../../envelope.js';
import {
  bodyTooLargeMessage,
  CLAUDE_ENDPOINT_MAX_BODY_BYTES,
  CODEX_ENDPOINT_MAX_BODY_BYTES,
  MAX_BODY_KIB_CEILING,
  resolveConfiguredMaxBodyBytes,
  resolveMaxTurn,
} from '../../limits.js';
import { decodeOriginIdentity, isSameMachine, sendViaSsh } from '../../federation.js';
import { sendViaTcp } from '../../serve/via-tcp.js';
import { normalizeMid } from '../../platform/machine-id.js';
import type { SendLogEntry } from '../../send-log.js';
import { createReceiptMarker } from '../../send-log.js';
import { resolveDeliveryMode } from '../../delivery-mode.js';
import {
  CONVERSATION_HANDLE_RE,
  continueConversation,
  continueFromRef,
  handleForRef,
  recordConversation,
  resolveHandle,
} from '../../conversations.js';
import {
  decodeRef,
  encodeRef,
  newConversationRef,
  nextTurnRef,
  type ConversationRef,
  type RefEndpoint,
} from '../../ref.js';

/** 票A：上限解析移入 limits.ts；此名保留（004 时代的外部引用面，= 默认 16384）。 */
export { DEFAULT_MAX_BODY_BYTES as MAX_BODY_BYTES } from '../../limits.js';

/**
 * B2.1 回信自动补全三分支（零回归规则）：ssh config 有对端 Host 别名 → 照旧
 * ssh（既有对话字节不变）；无别名且本机有可用 tcp 条目 → tcp（tcp 对话的
 * m=mid8，必然不是 ssh 别名，落到本分支）；其余照旧 ssh。纯函数便于直测。
 * B1：判据从"node.json 文件存在"收紧为"readNodeConfig 成功"（成功即条目
 * 非空）——坏文件/空形状不再把回信引上必死的 tcp 腿。
 */
export function pickAutoVia(remoteM: string, ctx: { sshConfigText?: () => string | undefined; tcpBaseDir?: string }): string {
  if (!sshConfigHasAlias(ctx.sshConfigText?.(), remoteM)) {
    if (ctx.tcpBaseDir !== undefined) {
      try {
        readNodeConfig(join(ctx.tcpBaseDir, 'tcp', 'node.json'));
        return `tcp:${remoteM}`;
      } catch {
        // 未入网/node.json 不可用 → 照旧 ssh
      }
    }
  }
  return `ssh:${remoteM}`;
}

/** ~/.ssh/config 的 Host 行别名匹配（通配 Host 不算确定性别名，跳过）。 */
function sshConfigHasAlias(text: string | undefined, alias: string): boolean {
  if (text === undefined) return false;
  for (const line of text.split(/\r?\n/)) {
    const m = /^Host\s+(.+?)\s*$/i.exec(line);
    if (m === null) continue;
    for (const token of m[1]!.split(/\s+/)) {
      if (token === alias) return true;
    }
  }
  return false;
}

/**
 * 信封瘦身 A+ 的执行侧自动选路（--conversation 且无 --via）：
 * a. ref 带 starId（tcp 会话）→ 固定走 tcp，targetMachine=对端端点的 mid
 *    （本机端点之外的另一端；两端都不在本机取 t 端点）。星条目选择与
 *    "星不在本机 node.json"教学复用 via-tcp 的 selectBrokerEntry（连接前
 *    失败）。--origin 在场=接收腿（消息已在目标机上），不选路——再上 broker
 *    会被对端以同判据弹回来，两机对弹。
 * b. 无 starId 但对端带 m/mid → 照旧 pickAutoVia（B2.1 三分支：ssh 别名
 *    优先，其次本机 tcp 条目）；对端在本机=不补 --via，落单机投递。
 * c. 对端无任何机器指纹、且本机会话注册表里查无两端（超旧引用被带到别
 *    机器）→ 教学显式 --via。本机认识的会话绝不误判（否则本地回复全灭）。
 */
async function autoViaFromRef(
  args: SendArgs,
  deps: SendDeps,
  ref: ConversationRef,
  here: string,
  localMid: string | undefined,
): Promise<SendArgs> {
  const isLocal = (ep: RefEndpoint): boolean =>
    ep.p !== 'human' && isSameMachine(ep.mid, ep.m, localMid, here);
  if (ref.starId !== undefined && args.origin === undefined) {
    const fLocal = isLocal(ref.f);
    const tLocal = isLocal(ref.t);
    const peer = tLocal && !fLocal ? ref.f : ref.t;
    if (peer.p === 'human') return args; // 人发起的对话交给主路径的 CANNOT_REPLY_TO_HUMAN
    // F0：对端 mid 归一后再当 targetMachine（Windows 带杠 MachineGuid → broker
    // 归一前缀轨）；mid 缺失才退机器名槽（名字绝不归一）。
    const peerTarget = peer.mid !== undefined ? normalizeMid(peer.mid) : (peer.m ?? '');
    return { ...args, via: `tcp:${peerTarget}` };
  }
  let staleRef = false;
  const envScan = deps.listClaudeSessions();
  try {
    const envCaller = resolveCallerIdentity(deps.env, envScan);
    // B3.1 bug2：origin 在场即权威——远端来件的发送方身份不走本进程环境残留。
    const caller = args.origin !== undefined ? decodeOriginIdentity(args.origin) : envCaller;
    // B11：只认"调用者身份之外且非本机"的端点为 via 目标——跨机回复时调用者
    // 自己的端点住在对端机上，误选会两机互弹 ssh 到 120s 超时。
    const remote = [ref.f, ref.t].find(
      (ep): ep is { p: 'claude' | 'codex'; id: string; m: string } =>
        !identityMatchesEndpoint(caller, ep) &&
        ep.p !== 'human' && ep.m !== undefined && !isSameMachine(ep.mid, ep.m, localMid, here),
    );
    if (remote !== undefined) return { ...args, via: pickAutoVia(remote.m, deps) };
    staleRef =
      !identityMatchesEndpoint(caller, ref.f) &&
      !identityMatchesEndpoint(caller, ref.t) &&
      ![ref.f, ref.t].some((ep) => ep.p !== 'human' && (ep.m !== undefined || ep.mid !== undefined));
  } catch {
    // 身份解析失败在主路径还会原样炸出（此处不抢答）
  }
  if (!staleRef) return args;
  let codexIds: string[] = [];
  try {
    codexIds = (await deps.listCodexThreads()).map((thread) => thread.id);
  } catch {
    // codex 不可达时按 claude 侧 + 调用者侧判定
  }
  const known = new Set([...envScan.sessions.map((session) => session.sessionId), ...codexIds]);
  if ([ref.f, ref.t].some((ep) => ep.p !== 'human' && known.has(ep.id))) return args;
  throw new MultichatError(
    'USAGE',
    '此对话引用过旧（无机器指纹），请显式加 --via tcp:<机器> 或 --via ssh:<别名> 后重发',
  );
}

export async function sendMessage(args: SendArgs, deps: SendDeps): Promise<SendResult> {
  const mode = resolveDeliveryMode(args.delivery);
  resolveTargetArgs(args);
  // F2：--conversation 双形态——c<数字> 本地短柄先解析成唯一完整 ref（扫全部
  // 分片；过期/撞号在此教学自纠），mc1_/mc2_ 前缀直用永续。柄不过网：跨机腿
  // 到这里时 conversation 已是完整 ref。
  if (args.conversation !== undefined && CONVERSATION_HANDLE_RE.test(args.conversation)) {
    args = { ...args, conversation: resolveHandle(deps.conversationStateFile, args.conversation) };
  }
  // B2：--file 模式正文可缺省（传输完成后自动生成"已送达：<路径>"）
  const body = args.fileArg !== undefined ? resolveFileBody(args, deps) : resolveBody(args, deps);
  const size = body === undefined ? 0 : Buffer.byteLength(body, 'utf8');
  // 票A：上限三层来源（--max-body-kb > CROSSCHAT_MAX_BODY_KIB > 16384 兜底）。
  // 端点封顶（claude 64KiB / codex 1MiB）要等目标解析出来才能补检——生效值
  // = min(配置值, 目标端点封顶)。来源值自身有 16MiB 绝对上界，到顶时教学
  // 直接说"提额无效"，不再指一条走不通的路。
  const configuredMax = resolveConfiguredMaxBodyBytes(args.maxBodyKb, deps.env);
  const turnBudget = resolveMaxTurn(args.maxTurn, deps.env);

  // 信封瘦身 A+：回信命令不再携带 --via，执行侧在此按 ref 补齐路由（显式
  // --via 一字不动；解不开的 ref 照旧交给主路径报错）。历史注记：B11 乒乓
  // 修复的"只认调用者对端"判据仍活在 autoViaFromRef 的 b 分支里。
  if (args.via === undefined && args.conversation !== undefined) {
    const here = deps.hostname?.() ?? osHostname();
    const localMid = deps.machineId?.();
    let ref: ConversationRef | undefined;
    try {
      ref = decodeRef(args.conversation);
    } catch {
      // invalid ref: the main path reports it
    }
    if (ref !== undefined) args = await autoViaFromRef(args, deps, ref, here, localMid);
  }

  // D0：配置值检查在路由定型后执行（autoVia 可能补挂 via）。tcp 形态的尺寸
  // 治理整体移交 via-tcp——1MiB 预检线变为自动降级文件通道、64MiB
  // FILE_TOO_LARGE 封顶，配置值与 16MiB 绝对上界不再前置拦截 tcp（替代原
  // tcp 分支的绝对上界）；单机/ssh 路径字节不变。
  const viaTcp = args.via !== undefined && args.via.startsWith('tcp:');
  if (size > configuredMax && !viaTcp) {
    const atCeiling = configuredMax === MAX_BODY_KIB_CEILING * 1_024;
    // 远端来件（008 D5：--origin 只在 --via 的接收腿出现）拒绝大正文时，读
    // 报错的是发送方——单机教学（本机提额/落盘路径）对它全是误导，换远端
    // 变体（scp 旁路 + 上限属接收方操作者）。
    throw new MultichatError(
      'MESSAGE_TOO_LARGE',
      bodyTooLargeMessage(size, configuredMax, args.via, atCeiling ? 'absolute' : undefined, args.origin !== undefined),
    );
  }

  // Federation (008/B1): everything via lives behind this early branch — the
  // configured-cap check above applies to cross-machine sends too (D6), and the
  // local path below stays byte-identical when --via is absent (D9).
  if (args.via !== undefined) {
    // 票B B2：tcp: 前缀分流到 via-tcp（瞬态 ws + 文件通道），ssh: 逻辑不动一行。
    const tcp = args.via.startsWith('tcp:');
    if (args.fileArg !== undefined && !tcp) {
      throw new MultichatError('USAGE', '--file 目前仅配合 --via tcp:<机器> 使用（ssh 形态走 scp 旁路，见 MESSAGE_TOO_LARGE 教学）');
    }
    // 票A：--via 本地无法解析远端目标——按最宽端点（codex 1MiB）预检，远端
    // 自行复检（现状语义）。--max-body-kb 不透传远端：远程命令面保持固定
    // 白名单（buildSshArgv），远端用自己的两层来源决定上限。D0：tcp 不再
    // 预检——超 1MiB 由 via-tcp 自动降级文件通道。
    const viaLimit = Math.min(configuredMax, CODEX_ENDPOINT_MAX_BODY_BYTES);
    if (!tcp && body !== undefined && size > viaLimit) {
      throw new MultichatError('MESSAGE_TOO_LARGE', bodyTooLargeMessage(size, viaLimit, args.via, 'ssh-precheck'));
    }
    if (tcp) return sendViaTcp(args, body, deps);
    return sendViaSsh(args, body as string, deps);
  }
  if (args.fileArg !== undefined) {
    throw new MultichatError('USAGE', '--file 目前仅配合 --via tcp:<机器> 使用；本机发文件路径直接 --body "<路径>" 即可');
  }
  // 到这里 fileArg 必在 via tcp 分支里消费掉了，body 收窄回 string。
  const messageText = body as string;

  const scan = deps.listClaudeSessions();
  const envCaller = resolveCallerIdentity(deps.env, scan);
  // Federation (008 D5): an incoming remote send carries --origin — injected by
  // the sending machine's CLI — and that identity is authoritative. B3.1 bug2:
  // it must win over ANY ambient env identity, not just human shells — the
  // receiving process (tcp broker/node) may long-run inside an agent env, and
  // letting that residue win mislabels the envelope as if sent by the local
  // session.
  const origin = args.origin !== undefined ? decodeOriginIdentity(args.origin) : undefined;
  const caller: CallerIdentity = origin ?? envCaller;
  // F1 跨机会话信封坐标：发送方机器名——tcp 腿取管线透传的 roster 真名，
  // ssh 腿取 origin 机器段（origin.via='tcp' 时 host 槽是 mid8，不是名字，
  // 不用）；单机与无名瞬态发送方均 undefined → 信封整个省略属性。
  const fromMachine = deps.fromMachine ?? (origin !== undefined && origin.via === undefined ? origin.host : undefined);
  // 016① 跨机信封到达：把信封携带的发送方机器名（from-machine）与其 mid8 绑定
  // 持久化进会话分片（additive machines 字段）——本机后续按 mid 回信时，回执
  // 显示层据它还原 name(mid8)。单机/无名/无 mid 信封不写。
  const arrivalMachines =
    origin !== undefined && fromMachine !== undefined && origin.mid !== undefined
      ? { [normalizeMid(origin.mid).slice(0, 8)]: fromMachine }
      : undefined;

  let target: RefEndpoint;
  let newRef: ConversationRef;
  let turn: number;
  if (args.conversation !== undefined) {
    const ref = decodeRef(args.conversation);
    const asFrom = identityMatchesEndpoint(caller, ref.f);
    const asTo = identityMatchesEndpoint(caller, ref.t);
    if (!asFrom && !asTo) {
      throw new MultichatError(
        'CALLER_NOT_IN_CONVERSATION',
        `Caller (${identityKey(caller)}) is not an endpoint of this conversation. ` +
          '手里的 ref 可能抄漏或已过期——改用 --to <名字> 自动接续该端对最新对话。',
      );
    }
    target = asFrom ? ref.t : ref.f;
    if (target.p === 'human') {
      throw new MultichatError(
        'CANNOT_REPLY_TO_HUMAN',
        'This conversation was started by a human; there is no agent session to deliver a reply to.',
      );
    }
    // B22: the reply-hint ref is a snapshot of send time; when the pair's
    // stored line has already moved at or past it (late reply, parallel
    // senders from one old base), the stored line wins — no turn collisions.
    // Unwired state keeps the exact legacy nextTurnRef behavior.
    const continued =
      deps.conversationStateFile === undefined
        ? { ref: nextTurnRef(ref), turn: ref.c + 1 }
        : continueFromRef(deps.conversationStateFile, ref);
    newRef = continued.ref;
    turn = continued.turn;
  } else {
    // Codex may be entirely absent (unix deploy); --to resolution still has
    // to work claude-side, so an unreachable codex degrades to an empty
    // thread list. A codex-side name then fails resolution with its own
    // error instead of a transport spawn failure, and the codex-target
    // delivery path still hits the real proxy below.
    let threads: CodexThreadSummary[] = [];
    try {
      threads = await deps.listCodexThreads();
    } catch {
      // claude-side --to names still resolvable; otherwise let resolveTargetByName report it
    }
    // Guard above ensures exactly one of --to/--conversation; here it is --to.
    // 018：targetSessionId 在场=会话级直达投递——id 定位优先，名字解析跳过。
    let resolved;
    try {
      resolved = args.targetSessionId !== undefined
        ? resolveTargetById(args.targetSessionId, scan.sessions, threads)
        : resolveTargetByName(args.to ?? '', scan.sessions, threads);
    } catch (error) {
      if (args.targetSessionId === undefined && error instanceof MultichatError && error.code === 'NAME_NOT_FOUND' && deps.diagnoseCodexTarget !== undefined) {
        const diagnosis = await deps.diagnoseCodexTarget(args.to ?? '');
        if (diagnosis.kind !== 'not-found') throw Object.assign(new MultichatError(diagnosis.code, diagnosis.message), { diagnosis });
      }
      throw error;
    }
    target =
      resolved.side === 'claude'
        ? { p: 'claude', id: resolved.session.sessionId }
        : { p: 'codex', id: resolved.thread.id };
    // B15: --to continues the pair's latest conversation when state is wired
    // (meaningful turn counting); absent state keeps the legacy fresh-thread
    // behavior so existing tests/embeddings stay untouched.
    const callerEndpoint = endpointOfIdentity(caller);
    const continued =
      deps.conversationStateFile === undefined
        ? { ref: newConversationRef(callerEndpoint, target), turn: 1 }
        : continueConversation(deps.conversationStateFile, callerEndpoint, target);
    newRef = continued.ref;
    turn = continued.turn;
  }

  // 票A：端点封顶——早期检查只查了配置值，claude 端点 64KiB 更严，解析出
  // 目标后必须补检（配置再大也送不进端点）。到端点硬顶 = 提额无效，教学
  // 直接指向落盘。（信封教学行永远静态 16KiB——第六单政策，见 envelope.ts。）
  const endpointCap = target.p === 'claude' ? CLAUDE_ENDPOINT_MAX_BODY_BYTES : CODEX_ENDPOINT_MAX_BODY_BYTES;
  const effectiveMax = Math.min(configuredMax, endpointCap);
  if (size > effectiveMax) {
    // 远端来件同样换远端教学（第八单）：硬顶事实保留（提额无效），尾巴换
    // scp 旁路——接收方提额也过不了端点硬顶，scp 是唯一出路。
    throw new MultichatError(
      'MESSAGE_TOO_LARGE',
      bodyTooLargeMessage(size, effectiveMax, args.via, target.p, args.origin !== undefined),
    );
  }

  // Federation (008 B2 + B10): a remote-origin send (ssh shell + --origin)
  // stamps both endpoints with their machines — m (hostname) routes the return
  // --via, mid (machine-id) decides "same machine" so hostname collisions
  // cannot fake a local conversation. Local sends stamp nothing (no m = local).
  const here = deps.hostname?.() ?? osHostname();
  const localMid = deps.machineId?.();
  if (origin !== undefined) {
    const fIsCaller = identityMatchesEndpoint(caller, newRef.f);
    const stamp = (ep: RefEndpoint, m: string, mid: string | undefined): RefEndpoint =>
      ep.p === 'human' ? ep : { ...ep, m, ...(mid === undefined ? {} : { mid }) };
    newRef = {
      ...newRef,
      f: stamp(newRef.f, fIsCaller ? origin.host : here, fIsCaller ? origin.mid : localMid),
      t: stamp(newRef.t, fIsCaller ? here : origin.host, fIsCaller ? localMid : origin.mid),
    };
  }
  // B10 collision warning: the ssh peer's hostname equals ours but its
  // machine-id differs — routing is still correct (per-machine ssh alias
  // namespaces resolve it), the name ambiguity is worth telling the human.
  const collision =
    origin !== undefined &&
    origin.host === here &&
    origin.mid !== undefined &&
    localMid !== undefined &&
    origin.mid !== localMid
      ? `⚠ 两台机器同名 (${here})：已按跨机路由（machine-id 不同）。建议改名避免混淆。`
      : undefined;
  // B1 多星：tcp 投递管线（节点守护/broker 自投递）经 refStarId 传入本腿星
  // 标识，签发/续期的 ref 盖上它——发送侧路由成为纯函数 f(ref, node.json)。
  // 单机与 ssh 路径恒 undefined：ref 字节不变（零回归锚点）。
  if (deps.refStarId !== undefined && newRef.starId === undefined) {
    newRef = { ...newRef, starId: deps.refStarId };
  }
  const finish = (result: SendResult): SendResult => ({ ...result, deliveryMode: mode, ...(collision === undefined ? {} : { warning: collision }) });

  // F2：短柄寄生于会话分片（零新文件），在最终 ref（含 origin 盖章与 starId）
  // 定型后分配；状态未接线（异常路径）不分配，信封回退完整 ref。
  const handle =
    deps.conversationStateFile === undefined ? undefined : handleForRef(deps.conversationStateFile, newRef);
  const replyRef = encodeRef(newRef);
  const fromName = displayName(caller);
  // 024 方案3：tcp 跨机信封正向三段坐标 tcp:<星>:<机器>:<工具>/<会话>——工具/
  // 会话段与 020 限定词语法对齐（claude/<名>、codex/<id8>，human 无会话段降为
  // 机器级）。星段=本腿经由星（022 多星下任一可达星皆可为发起坐标，不暗示
  // 唯一）；ssh 腿无星概念、单机/无名发送方缺省 → from-addr 整个不出现。
  const fromQualifier =
    caller.p === 'claude'
      ? `claude/${caller.name ?? caller.id.slice(0, 8)}`
      : caller.p === 'codex'
        ? `codex/${caller.id.slice(0, 8)}`
        : undefined;
  const fromAddr =
    deps.fromStarName !== undefined && fromMachine !== undefined
      ? `tcp:${deps.fromStarName}:${fromMachine}${fromQualifier === undefined ? '' : `:${fromQualifier}`}`
      : undefined;
  /** Every exit path logs who sent what to whom (B14, +from in B16, +fromName in B21). */
  const logNow = (fields: Omit<SendLogEntry, 'ts'>): void => {
    deps.appendLog?.(logEntry(deps, { from: identityKey(caller), fromName, ...fields }));
  };

  if (target.p === 'claude') {
    const claudeSession = scan.sessions.find((session) => session.sessionId === target.id);
    if (claudeSession === undefined) {
      // 027 A+：tcp 接收腿（fromStarName 在场）拼可照抄三段地址——ref 端点只带
      // id 不带名，故会话段用 id8（照抄即达本体）；按名重投（名见来信信封
      // from-name）在被接任时报 SESSION_SUPERSEDED 指路接任者，两跳闭环。
      // ssh/单机对话保持原教学。
      const tcpAddr =
        deps.fromStarName !== undefined && (target.m ?? '') !== ''
          ? `tcp:${deps.fromStarName}:${target.m}:${target.id.slice(0, 8)}`
          : undefined;
      throw new MultichatError(
        'TARGET_NOT_FOUND',
        `Claude session ${target.id} is not currently routable (process exited or unregistered). ` +
          (tcpAddr !== undefined
            ? `对端会话可能已重启——点对点直达可照抄：crosschat send --via ${tcpAddr} --body "…"；按对端名三段重投（名见来信信封 from-name）则在被接任时获 SESSION_SUPERSEDED 指路。`
            : '对端会话可能已重启——改用 --to <名字> 自动接续该端对最新对话（--to 同名即续，无需换名）。' +
              'status 只列本机会话；跨机对端用 ssh <对端> crosschat status 查。'),
      );
    }
    checkSendLogRate(deps.sendLogFile, identityKey(caller), `claude:${target.id}`, deps.now());
    // 020：三段直达（targetSessionId 在场）的回执显示带工具限定词——跨工具同名时发送面认得出谁收到
    const toName =
      args.targetSessionId !== undefined && claudeSession.name !== undefined
        ? `claude/${claudeSession.name}`
        : (claudeSession.name ?? shortId('claude', claudeSession.sessionId));
    const content = composeEnvelope({ fromName, toName, turn, ref: replyRef, body: messageText, turnBudget, ...(fromMachine === undefined ? {} : { fromMachine }), ...(fromAddr === undefined ? {} : { fromAddr }), ...(handle === undefined ? {} : { handle }) });
    try {
      await deps.deliverClaude(
        { pid: claudeSession.pid, messagingSocketPath: claudeSession.messagingSocketPath },
        content,
        { mode },
      );
    } catch (err) {
      logNow({ to: toName, target: `claude:${target.id}`, status: 'failed', code: errorCode(err), turn, replyRef });
      throw err;
    }
    logNow({ to: toName, target: `claude:${target.id}`, status: 'delivered', turn, replyRef });
    if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now(), arrivalMachines);
    return finish(deliveryResult(toName, turn, replyRef, false, handle));
  }

  // Codex delivers by threadId; a missing thread surfaces as a codex adapter error.
  checkSendLogRate(deps.sendLogFile, identityKey(caller), `codex:${target.id}`, deps.now());
  let threadName: string | null | undefined;
  try {
    threadName = (await deps.listCodexThreads()).find((thread) => thread.id === target.id)?.name;
  } catch {
    // An exact ref already identifies the target. Optional display metadata
    // must not make Desktop delivery depend on the separate CLI daemon.
  }
  const toName =
    args.targetSessionId !== undefined && threadName !== undefined
      ? `codex/${threadName}`
      : (threadName ?? shortId('codex', target.id));
  const content = composeEnvelope({ fromName, toName, turn, ref: replyRef, body: messageText, turnBudget, ...(fromMachine === undefined ? {} : { fromMachine }), ...(fromAddr === undefined ? {} : { fromAddr }), ...(handle === undefined ? {} : { handle }) });
  const receiptMarker = createReceiptMarker(target.id, content);
  const parkNow = (): number => {
    park(
      deps.outboxDir,
      target.id,
      { envelope: content, toName, callerKey: identityKey(caller), deliveryMode: mode },
      deps.now(),
    );
    deps.spawnWatchdog?.();
    return outboxCount(deps.outboxDir, target.id);
  };
  const mailboxPath = mailboxFileFor(deps.outboxDir, target.id);
  // Queue discipline (B12): when older items are still parked, a fresh send
  // joins the queue instead of jumping it — order stays FIFO even though a
  // direct attempt could squeeze through an idle window the drain missed.
  const queuedBefore = mode === 'queue' ? outboxCount(deps.outboxDir, target.id) : 0;
  if (queuedBefore > 0) {
    const queue = parkNow();
    return finish(parkedResult(toName, turn, replyRef, queue, mailboxPath, handle));
  }
  try {
    const delivered = await deps.deliverCodex(target.id, content, { mode });
    const queued = delivered.queued === true;
    // Queued sits behind the recipient's running turn: a rollout receipt is
    // structurally impossible within the probe budget, so do not even look.
    const receipt = queued ? undefined : await deps.confirmReceipt?.(target.id, receiptMarker);
    logNow({ to: toName, target: `codex:${target.id}`, status: queued ? 'queued' : 'delivered', turn, replyRef, receipt, receiptMarker });
    if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now(), arrivalMachines);
    return finish({ ...deliveryResult(toName, turn, replyRef, queued, handle), confirmation: receipt });
  } catch (err) {
    // Busy/locked = definitively not delivered (deliver.ts polls before giving
    // up): park the composed envelope verbatim; the watchdog retries it.
    if (
      mode === 'queue' && err instanceof MultichatError &&
      (err.code === 'CODEX_THREAD_BUSY_TIMEOUT' || err.code === 'CODEX_THREAD_LOCKED')
    ) {
      const queue = parkNow();
      logNow({ to: toName, target: `codex:${target.id}`, status: 'parked', turn, replyRef, receiptMarker });
      if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now(), arrivalMachines);
      return finish(parkedResult(toName, turn, replyRef, queue, mailboxPath, handle));
    }
    logNow({ to: toName, target: `codex:${target.id}`, status: 'failed', code: errorCode(err), turn, replyRef, receiptMarker });
    throw err;
  }
}

function logEntry(
  deps: SendDeps,
  fields: Omit<SendLogEntry, 'ts'>,
): SendLogEntry {
  return { ...fields, ts: new Date(deps.now()).toISOString() };
}

function errorCode(err: unknown): string {
  return err instanceof MultichatError ? err.code : 'INTERNAL';
}

function resolveTargetArgs(args: SendArgs): void {
  if (args.to !== undefined && args.conversation !== undefined) {
    throw new MultichatError('TARGET_CONFLICT', 'Use either --to <name> or --conversation <ref>, not both.');
  }
  if (args.to === undefined && args.conversation === undefined) {
    // 018 三段寻址：--via tcp:<星>:<机器>:<会话> 自带收件人（会话段即目标，
    // 机器段可含冒号、会话名禁冒号）——此形态免 --to；其余形态照旧必须给目标
    const segments = args.via === undefined ? [] : args.via.startsWith('tcp:') ? args.via.slice(4).split(':') : [];
    const threePart = segments.length === 3 && segments.every((segment) => segment !== '');
    if (!threePart) {
      throw new MultichatError('TARGET_REQUIRED', 'Specify a target: --to <name> or --conversation <ref>.');
    }
  }
}

function resolveBody(args: SendArgs, deps: SendDeps): string {
  if (args.bodyArg !== undefined && deps.stdinText !== undefined) {
    throw new MultichatError('BODY_CONFLICT', 'Message body was given both via --body and stdin; pick one.');
  }
  const body = args.bodyArg ?? deps.stdinText;
  if (body === undefined || body === '') {
    throw new MultichatError(
      'BODY_REQUIRED',
      'Message body is required: pass --body "<text>" or pipe the message on stdin.',
    );
  }
  return body;
}

/** B2：--file 模式的附言（可缺省——传输完成后自动生成"已送达：<路径>"）。 */
function resolveFileBody(args: SendArgs, deps: SendDeps): string | undefined {
  if (args.bodyArg !== undefined && deps.stdinText !== undefined) {
    throw new MultichatError('BODY_CONFLICT', 'Message body was given both via --body and stdin; pick one.');
  }
  return args.bodyArg ?? deps.stdinText;
}

function displayName(identity: CallerIdentity): string {
  if (identity.p === 'claude') return identity.name ?? shortId('claude', identity.id);
  if (identity.p === 'codex') return shortId('codex', identity.id);
  return 'human';
}

function shortId(prefix: string, id: string): string {
  return `${prefix}/${id.slice(0, 8)}`;
}

function deliveryResult(to: string, turn: number, replyRef: string, queued: boolean, handle?: string): SendResult {
  return { status: queued ? 'queued' : 'delivered', receipt: { status: 'delivered', to, turn, replyRef, queued }, handle };
}

function parkedResult(to: string, turn: number, replyRef: string, queue: number, mailbox: string, handle?: string): SendResult {
  return { status: 'parked', receipt: { status: 'parked', to, turn, replyRef, queue, mailbox }, handle };
}
