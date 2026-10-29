import type { CodexThreadSummary } from '../../codex/client.js';
import type { OpenCodeThread } from '../../opencode/client.js';
import type { DshThread } from '../../dsh/client.js';
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
import { endpointConstraintMatches, isEndpointTypeFor, parseToolType, toolTypeFor, TOOL_TYPES } from '../../tool-types.js';
import type { EndpointConstraint } from '../../tool-types.js';
import { composeEnvelope } from '../../envelope.js';
import {
  bodyTooLargeMessage,
  CLAUDE_ENDPOINT_MAX_BODY_BYTES,
  CODEX_ENDPOINT_MAX_BODY_BYTES,
  OPENCODE_ADAPTER_MAX_BODY_BYTES,
  DSH_ADAPTER_MAX_BODY_BYTES,
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
  latestKnownConversationRef,
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

/** Preserve native-ID matching; use source coordinates only to disambiguate both endpoints. */
function conversationSides(
  ref: ConversationRef,
  caller: CallerIdentity,
  selected: EndpointConstraint,
  sourceHost: string,
  sourceMid: string | undefined,
): { asFrom: boolean; asTo: boolean } {
  let asFrom = identityMatchesEndpoint(caller, ref.f);
  let asTo = identityMatchesEndpoint(caller, ref.t);
  if (asFrom && asTo) {
    const machineMatch = (endpoint: RefEndpoint): number => {
      if (endpoint.p === 'human') return 0;
      if (endpoint.mid !== undefined && sourceMid !== undefined) return endpoint.mid === sourceMid ? 2 : 0;
      return endpoint.m === sourceHost ? 1 : 0;
    };
    const fromMachine = machineMatch(ref.f);
    const toMachine = machineMatch(ref.t);
    if (fromMachine !== toMachine) {
      asFrom = fromMachine > toMachine;
      asTo = toMachine > fromMachine;
    }
  }
  if (asFrom && asTo && ref.f.p !== 'human' && ref.t.p !== 'human' && ref.f.endpointType !== ref.t.endpointType) {
    const receives = (endpoint: RefEndpoint): boolean => endpoint.p !== 'human'
      && endpointConstraintMatches({ providerId: endpoint.p, endpointType: endpoint.endpointType }, selected);
    const fromReceives = receives(ref.f);
    const toReceives = receives(ref.t);
    if (fromReceives === toReceives) throw new MultichatError('CALLER_IDENTITY_UNRESOLVED', 'This native ID appears at both conversation endpoints and the recipient type does not identify one recipient.');
    asFrom = toReceives;
    asTo = fromReceives;
  }
  return { asFrom, asTo };
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
  selected: EndpointConstraint,
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
    const origin = args.origin !== undefined ? decodeOriginIdentity(args.origin) : undefined;
    const caller = origin ?? envCaller;
    const endpoints = [ref.f, ref.t];
    const { asFrom, asTo } = conversationSides(ref, caller, selected, origin?.host ?? here, origin === undefined ? localMid : origin.mid);
    const recipient = asFrom === asTo ? undefined : asFrom ? ref.t : ref.f;
    // B11：只认"调用者身份之外且非本机"的端点为 via 目标——跨机回复时调用者
    // 自己的端点住在对端机上，误选会两机互弹 ssh 到 120s 超时。
    const remote = endpoints.find(
      (ep): ep is { p: 'claude' | 'codex' | 'opencode' | 'dsh'; id: string; m: string } =>
        (recipient === undefined ? !identityMatchesEndpoint(caller, ep) : ep === recipient) &&
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
  try { for (const thread of await deps.listOpenCodeThreads?.() ?? []) known.add(thread.id); } catch { /* Preserve independent native sources. */ }
  try { for (const thread of await deps.listDshThreads?.() ?? []) known.add(thread.id); } catch { /* Preserve independent native sources. */ }
  if ([ref.f, ref.t].some((ep) => ep.p !== 'human' && known.has(ep.id))) return args;
  throw new MultichatError(
    'USAGE',
    '此对话引用过旧（无机器指纹），请显式加 --via tcp:<机器> 或 --via ssh:<别名> 后重发',
  );
}

export async function sendMessage(args: SendArgs, deps: SendDeps): Promise<SendResult> {
  const mode = resolveDeliveryMode(args.delivery);
  const selected = selectedTool(args);
  const discoverySelection = selected;
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
    if (ref !== undefined) {
      if (deps.conversationStateFile !== undefined) ref = latestKnownConversationRef(deps.conversationStateFile, ref);
      args = await autoViaFromRef(args, deps, ref, here, localMid, selected);
    }
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
  const nativeCaller = resolveCallerIdentity(deps.env, scan);
  const envCaller = args.origin === undefined && deps.enrichCallerIdentity !== undefined
    ? await deps.enrichCallerIdentity(nativeCaller) : nativeCaller;
  // Federation (008 D5): an incoming remote send carries --origin — injected by
  // the sending machine's CLI — and that identity is authoritative. B3.1 bug2:
  // it must win over ANY ambient env identity, not just human shells — the
  // receiving process (tcp broker/node) may long-run inside an agent env, and
  // letting that residue win mislabels the envelope as if sent by the local
  // session.
  const origin = args.origin !== undefined ? decodeOriginIdentity(args.origin) : undefined;
  const caller: CallerIdentity = origin ?? envCaller;
  const here = deps.hostname?.() ?? osHostname();
  const localMid = deps.machineId?.();
  const sourceHost = origin?.host ?? here;
  const sourceMid = origin === undefined ? localMid : origin.mid;
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
  let callerIsFrom: boolean;
  let replyThreads: CodexThreadSummary[] | undefined;
  if (args.conversation !== undefined) {
    const decoded = decodeRef(args.conversation);
    const ref = deps.conversationStateFile === undefined ? decoded : latestKnownConversationRef(deps.conversationStateFile, decoded);
    const { asFrom, asTo } = conversationSides(ref, caller, selected, sourceHost, sourceMid);
    if (!asFrom && !asTo) {
      throw new MultichatError(
        'CALLER_NOT_IN_CONVERSATION',
        `Caller (${identityKey(caller)}) is not an endpoint of this conversation. ` +
          '手里的 ref 可能抄漏或已过期——改用 --to <名字> --tool <收件类型> 自动接续该端对最新对话。',
      );
    }
    callerIsFrom = asFrom;
    target = asFrom ? ref.t : ref.f;
    if (target.p === 'human') {
      throw new MultichatError(
        'CANNOT_REPLY_TO_HUMAN',
        'This conversation was started by a human; there is no agent session to deliver a reply to.',
      );
    }
    let boundRef = ref;
    if (selected.providerId !== target.p || target.endpointType !== undefined && !endpointConstraintMatches({ providerId: target.p, endpointType: target.endpointType }, selected)) {
      throw new MultichatError('TARGET_CONFLICT', 'The selected tool type does not match the conversation recipient.');
    }
    if (target.endpointType === undefined && selected.endpointType !== undefined) {
      const codex = target.p === 'codex' ? await deps.listCodexThreads({ endpointType: selected.endpointType, complete: true }) : [];
      const dsh = target.p === 'dsh' ? await deps.listDshThreads?.({ endpointType: selected.endpointType }) ?? [] : [];
      const openCode = target.p === 'opencode' ? await deps.listOpenCodeThreads?.() ?? [] : [];
      resolveTargetById(target.id, scan.sessions, codex, openCode, dsh, selected);
      target = { ...target, endpointType: selected.endpointType };
      boundRef = { ...boundRef, ...(asFrom ? { t: target } : { f: target }) };
      if (target.p === 'codex') replyThreads = codex;
    }
    const sender = asFrom ? boundRef.f : boundRef.t;
    if (caller.p !== 'human' && caller.endpointType !== undefined && sender.p !== 'human' && sender.endpointType === undefined) {
      const typedSender = { ...sender, endpointType: caller.endpointType };
      boundRef = { ...boundRef, ...(asFrom ? { f: typedSender } : { t: typedSender }) };
    }
    // B22: the reply-hint ref is a snapshot of send time; when the pair's
    // stored line has already moved at or past it (late reply, parallel
    // senders from one old base), the stored line wins — no turn collisions.
    // Unwired state keeps the exact legacy nextTurnRef behavior.
    const continued =
      deps.conversationStateFile === undefined
        ? { ref: nextTurnRef(boundRef), turn: boundRef.c + 1 }
        : continueFromRef(deps.conversationStateFile, boundRef, ref);
    newRef = continued.ref;
    turn = continued.turn;
  } else {
    // Codex may be entirely absent (unix deploy); --to resolution still has
    // to work claude-side, so an unreachable codex degrades to an empty
    // thread list. A codex-side name then fails resolution with its own
    // error instead of a transport spawn failure, and the codex-target
    // delivery path still hits the real proxy below.
    let threads: CodexThreadSummary[] = [];
    let openCode: OpenCodeThread[] = [];
    let dsh: DshThread[] = [];
    try {
      threads = await deps.listCodexThreads(discoverySelection?.providerId === 'codex' ? { endpointType: discoverySelection.endpointType, complete: true } : undefined);
    } catch (error) {
      if (selected.providerId === 'codex') throw error;
      // claude-side --to names still resolvable; otherwise let resolveTargetByName report it
    }
    try { openCode = await deps.listOpenCodeThreads?.() ?? []; }
    catch (error) {
      if (selected.providerId === 'opencode') throw error;
      // An unavailable optional source must not block the other tools.
    }
    try { dsh = await deps.listDshThreads?.(discoverySelection?.providerId === 'dsh' ? { endpointType: discoverySelection.endpointType } : undefined) ?? []; }
    catch (error) {
      if (discoverySelection.providerId === 'dsh') throw error;
      // Existing tools remain independent of this optional native source.
    }
    // Guard above ensures exactly one of --to/--conversation; here it is --to.
    // 018：targetSessionId 在场=会话级直达投递——id 定位优先，名字解析跳过。
    let resolved;
    try {
      resolved = args.targetSessionId !== undefined
        ? resolveTargetById(args.targetSessionId, scan.sessions, threads, openCode, dsh, selected)
        : resolveTargetByName(args.to ?? '', scan.sessions, threads, openCode, dsh, selected);
    } catch (error) {
      if (selected.providerId === 'codex' && args.targetSessionId === undefined && error instanceof MultichatError && error.code === 'NAME_NOT_FOUND' && deps.diagnoseCodexTarget !== undefined) {
        const diagnosis = await deps.diagnoseCodexTarget(args.to ?? '');
        if (diagnosis.kind !== 'not-found') throw Object.assign(new MultichatError(diagnosis.code, diagnosis.message), { diagnosis });
      }
      throw error;
    }
    target =
      resolved.side === 'claude'
        ? { p: 'claude', id: resolved.session.sessionId }
        : { p: resolved.side, id: resolved.thread.id };
    const row = resolved.side === 'claude' ? resolved.session : resolved.thread;
    const endpointType = row.endpointType ?? selected.endpointType;
    if (endpointType !== undefined) target = { ...target, endpointType };
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
    callerIsFrom = conversationSides(newRef, caller, selected, sourceHost, sourceMid).asFrom;
  }

  // 票A：端点封顶——早期检查只查了配置值，claude 端点 64KiB 更严，解析出
  // 目标后必须补检（配置再大也送不进端点）。到端点硬顶 = 提额无效，教学
  // 直接指向落盘。（信封教学行永远静态 16KiB——第六单政策，见 envelope.ts。）
  const endpointCap = target.p === 'claude' ? CLAUDE_ENDPOINT_MAX_BODY_BYTES
    : target.p === 'opencode' ? OPENCODE_ADAPTER_MAX_BODY_BYTES
      : target.p === 'dsh' ? DSH_ADAPTER_MAX_BODY_BYTES : CODEX_ENDPOINT_MAX_BODY_BYTES;
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
  if (origin !== undefined) {
    const stamp = (ep: RefEndpoint, m: string, mid: string | undefined): RefEndpoint =>
      ep.p === 'human' ? ep : { ...ep, m, ...(mid === undefined ? {} : { mid }) };
    newRef = {
      ...newRef,
      f: stamp(newRef.f, callerIsFrom ? origin.host : here, callerIsFrom ? origin.mid : localMid),
      t: stamp(newRef.t, callerIsFrom ? here : origin.host, callerIsFrom ? localMid : origin.mid),
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
  const deliveryOptions = { mode, ...(target.endpointType !== undefined ? { endpointType: target.endpointType } : {}) };
  const targetKey = identityKey(target);
  const targetTool = toolTypeFor(target.p, target.endpointType) ?? target.p;
  const fromName = displayName(caller);
  // Address and type are independent. Full native IDs remain opaque and
  // routable even when a name happens to resemble a former tool qualifier.
  const fromTool = caller.p === 'human' ? undefined : toolTypeFor(caller.p, caller.endpointType);
  const senderEndpoint = callerIsFrom ? newRef.f : newRef.t;
  const replyTool = fromTool ?? (senderEndpoint.p === 'human' ? undefined : toolTypeFor(senderEndpoint.p, senderEndpoint.endpointType));
  const fromQualifier = caller.p === 'human' ? undefined : caller.id;
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
          ? `tcp:${deps.fromStarName}:${target.m}:${target.id}`
          : undefined;
      throw new MultichatError(
        'TARGET_NOT_FOUND',
        `Claude session ${target.id} is not currently routable (process exited or unregistered). ` +
          (tcpAddr !== undefined
            ? `对端会话可能已重启——点对点直达可照抄：crosschat send --via ${tcpAddr} --tool ${targetTool} --body "…"；按对端名三段重投（名见来信信封 from-name）则在被接任时获 SESSION_SUPERSEDED 指路。`
            : '对端会话可能已重启——改用 --to <名字> --tool <收件类型> 自动接续该端对最新对话（--to 同名即续，无需换名）。' +
              'status 只列本机会话；跨机对端用 ssh <对端> crosschat status 查。'),
      );
    }
    checkSendLogRate(deps.sendLogFile, identityKey(caller), targetKey, deps.now());
    // 020：三段直达（targetSessionId 在场）的回执显示带工具限定词——跨工具同名时发送面认得出谁收到
    const toName =
      args.targetSessionId !== undefined && claudeSession.name !== undefined
        ? `claude/${claudeSession.name}`
        : (claudeSession.name ?? shortId('claude', claudeSession.sessionId));
    const content = composeEnvelope({ fromName, fromTool, replyTool, toName, turn, ref: replyRef, body: messageText, turnBudget, ...(fromMachine === undefined ? {} : { fromMachine }), ...(fromAddr === undefined ? {} : { fromAddr }), ...(handle === undefined ? {} : { handle }) });
    try {
      await deps.deliverClaude(
        { pid: claudeSession.pid, messagingSocketPath: claudeSession.messagingSocketPath },
        content,
        deliveryOptions,
      );
    } catch (err) {
      logNow({ to: toName, target: targetKey, status: 'failed', code: errorCode(err), turn, replyRef });
      throw err;
    }
    logNow({ to: toName, target: targetKey, status: 'delivered', turn, replyRef });
    if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now(), arrivalMachines);
    return finish(deliveryResult(toName, turn, replyRef, false, handle));
  }

  if (target.p === 'opencode') {
    if (deps.deliverOpenCode === undefined) throw new MultichatError('OPENCODE_NOT_CONFIGURED', 'OpenCode delivery is not available in this context.');
    const toName = `${targetTool}/${target.id}`;
    const content = composeEnvelope({ fromName, fromTool, replyTool, toName, turn, ref: replyRef, body: messageText, turnBudget, ...(fromMachine === undefined ? {} : { fromMachine }), ...(fromAddr === undefined ? {} : { fromAddr }), ...(handle === undefined ? {} : { handle }) });
    checkSendLogRate(deps.sendLogFile, identityKey(caller), targetKey, deps.now());
    try {
      const result = await deps.deliverOpenCode(target.id, content, deliveryOptions);
      logNow({ to: toName, target: targetKey, status: result.queued ? 'queued' : 'delivered', turn, replyRef });
      if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now(), arrivalMachines);
      return finish(deliveryResult(toName, turn, replyRef, result.queued, handle));
    } catch (err) {
      logNow({ to: toName, target: targetKey, status: 'failed', code: errorCode(err), turn, replyRef });
      throw err;
    }
  }

  if (target.p === 'dsh') {
    if (deps.deliverDsh === undefined) throw new MultichatError('DSH_NOT_CONFIGURED', 'DeepSeek Harness delivery is not available in this context.');
    const toName = `${targetTool}/${target.id}`;
    const content = composeEnvelope({ fromName, fromTool, replyTool, toName, turn, ref: replyRef, body: messageText, turnBudget, ...(fromMachine === undefined ? {} : { fromMachine }), ...(fromAddr === undefined ? {} : { fromAddr }), ...(handle === undefined ? {} : { handle }) });
    checkSendLogRate(deps.sendLogFile, identityKey(caller), targetKey, deps.now());
    try {
      const result = await deps.deliverDsh(target.id, content, deliveryOptions);
      logNow({ to: toName, target: targetKey, status: result.queued ? 'queued' : 'delivered', turn, replyRef });
      if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now(), arrivalMachines);
      return finish(deliveryResult(toName, turn, replyRef, result.queued, handle));
    } catch (err) {
      logNow({ to: toName, target: targetKey, status: 'failed', code: errorCode(err), turn, replyRef });
      throw err;
    }
  }

  // Codex delivers by threadId; a missing thread surfaces as a codex adapter error.
  checkSendLogRate(deps.sendLogFile, identityKey(caller), targetKey, deps.now());
  let threadName: string | null | undefined;
  try {
    threadName = (replyThreads ?? await deps.listCodexThreads(target.endpointType === undefined ? undefined : { endpointType: target.endpointType, complete: true })).find((thread) => thread.id === target.id && (target.endpointType === undefined || thread.endpointType === target.endpointType))?.name;
  } catch {
    // An exact ref already identifies the target. Optional display metadata
    // must not make Desktop delivery depend on the separate CLI daemon.
  }
  const toName =
    args.targetSessionId !== undefined && threadName !== undefined
      ? `codex/${threadName}`
      : (threadName ?? shortId('codex', target.id));
  const content = composeEnvelope({ fromName, fromTool, replyTool, toName, turn, ref: replyRef, body: messageText, turnBudget, ...(fromMachine === undefined ? {} : { fromMachine }), ...(fromAddr === undefined ? {} : { fromAddr }), ...(handle === undefined ? {} : { handle }) });
  const receiptMarker = createReceiptMarker(target.id, content, target.endpointType);
  const parkNow = (): number => {
    park(
      deps.outboxDir,
      target.id,
      { envelope: content, toName, callerKey: identityKey(caller), deliveryMode: mode, ...(target.endpointType === undefined ? {} : { endpointType: target.endpointType }) },
      deps.now(),
    );
    deps.spawnWatchdog?.();
    return outboxCount(deps.outboxDir, target.id, target.endpointType);
  };
  const mailboxPath = mailboxFileFor(deps.outboxDir, target.id, target.endpointType);
  // Queue discipline (B12): when older items are still parked, a fresh send
  // joins the queue instead of jumping it — order stays FIFO even though a
  // direct attempt could squeeze through an idle window the drain missed.
  const queuedBefore = mode === 'queue' ? outboxCount(deps.outboxDir, target.id, target.endpointType) : 0;
  if (queuedBefore > 0) {
    const queue = parkNow();
    return finish(parkedResult(toName, turn, replyRef, queue, mailboxPath, handle));
  }
  try {
    const delivered = await deps.deliverCodex(target.id, content, deliveryOptions);
    const queued = delivered.queued === true;
    // Queued sits behind the recipient's running turn: a rollout receipt is
    // structurally impossible within the probe budget, so do not even look.
    const receipt = queued ? undefined : await deps.confirmReceipt?.(target.id, receiptMarker, target.endpointType);
    logNow({ to: toName, target: targetKey, status: queued ? 'queued' : 'delivered', turn, replyRef, receipt, receiptMarker });
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
      logNow({ to: toName, target: targetKey, status: 'parked', turn, replyRef, receiptMarker });
      if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now(), arrivalMachines);
      return finish(parkedResult(toName, turn, replyRef, queue, mailboxPath, handle));
    }
    logNow({ to: toName, target: targetKey, status: 'failed', code: errorCode(err), turn, replyRef, receiptMarker });
    throw err;
  }
}

function selectedTool(args: SendArgs): EndpointConstraint {
  if (args.tool === undefined) throw new MultichatError('USAGE', 'send requires --tool <recipient type>, including --conversation replies. Copy the complete reply hint or TUI send command.');
  const selected = parseToolType(args.tool);
  if (selected === undefined) throw new MultichatError('USAGE', `Unknown --tool type. Use ${TOOL_TYPES.map((tool) => tool.id).join(', ')}.`);
  if (args.targetEndpointType !== undefined && (args.targetProviderId === undefined || !isEndpointTypeFor(args.targetProviderId, args.targetEndpointType))) throw new MultichatError('USAGE', 'Invalid injected target delivery type.');
  const injected = args.targetProviderId === undefined ? undefined : { providerId: args.targetProviderId, endpointType: args.targetEndpointType };
  if (selected !== undefined && injected !== undefined && !endpointConstraintMatches(selected, injected)) throw new MultichatError('TARGET_CONFLICT', 'The selected tool differs from the exact native target.');
  return selected;
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
  if (identity.p !== 'human') return shortId(identity.p, identity.id);
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
