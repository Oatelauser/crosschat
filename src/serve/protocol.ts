/**
 * tcp broker 协议层（票B B1）：单文件、客户端服务端共用。JSON 单帧单 ws
 * 文本消息。B2 才有行为实现的帧（file-* 等）类型先定义全。
 */
export const PROTOCOL_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** 协议错误码（error.code），与各端报错文案共用。 */
export const ERR = {
  BAD_AUTH: 'BAD_AUTH',
  BAD_PROTO: 'BAD_PROTO',
  UNKNOWN_MACHINE: 'UNKNOWN_MACHINE',
  PEER_OFFLINE: 'PEER_OFFLINE',
  MACHINE_NAME_COLLISION: 'MACHINE_NAME_COLLISION',
  NOT_READY: 'NOT_READY',
  /** B2 修订：file-begin 尺寸预拒（>64MiB）。 */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  /** 018：三段寻址的会话段不是星成员（教学：会话须经启动器入星）。 */
  SESSION_NOT_MEMBER: 'SESSION_NOT_MEMBER',
  /** 028：册内在册但当前下线（教学：等 resume 复活/extends 接任/id8 点对点——绝不静默改投）。 */
  SESSION_OFFLINE: 'SESSION_OFFLINE',
  /** 028 边界1：跨机 resume——册位绑原机器（教学：迁移走显式操作）。 */
  MACHINE_BOUND: 'MACHINE_BOUND',
  /** 018：死名已由 extends 接续（报错文本指路接任者）。 */
  SESSION_SUPERSEDED: 'SESSION_SUPERSEDED',
  /** 018：extends 同旧名先声明先得，后声明者冲突回执。 */
  EXTENDS_CONFLICT: 'EXTENDS_CONFLICT',
  /** 020：会话段撞名（多命中）——复用单机 --to 同码（多候选列名单），教学文案区分场景。 */
  NAME_COLLISION: 'NAME_COLLISION',
  /** 034：非管理员调管理 op（教学：找星管理员或 broker 主；世上不存在全能远程钥匙）。 */
  ADMIN_REQUIRED: 'ADMIN_REQUIRED',
  /** 033 引入（时为字面量）、034 收编 ERR 表：星已删除（册随星葬、钥匙作废、无墓碑无复活）。 */
  STAR_DELETED: 'STAR_DELETED',
  /** 明确撤权通知；普通 BAD_AUTH 不表示已建立的连接被撤权。 */
  CREDENTIAL_REVOKED: 'CREDENTIAL_REVOKED',
} as const;

/**
 * 018 proto:3 能力标识：握手帧 caps 数组含此值 = 会话级星成员可用。
 * caps 缺省/不含 = 老节点（proto:1 行为不变）；后续能力（如 010 TLS）沿此数组追加。
 */
export const CAP_SESSION_MEMBERS = 'session-members';

/**
 * 022 多星能力标识：broker 一进程一端口托管多颗星。多星 broker 的 info 帧
 * 不携带 starId/name（见钥匙才知星），星标识挪到 connected 帧——此 cap 即
 * "info 无星标识是合法多星形态"的信号。纯信息性 additive，老节点零影响。
 */
export const CAP_MULTI_STAR = 'multi-star';

/**
 * 034 挑战应答能力：管理连接（星管理钥）握手走 nonce→HMAC 证明，钥匙永不过线。
 * additive——仅管理连接启用，星钥连接维持现状。客户端见 info 无此 cap（旧版/
 * 被中间人剥除）即拒连，**无降级路径**（绝不回落裸钥发送管理钥）。
 */
export const CAP_CHALLENGE_AUTH = 'challenge-auth';

/**
 * 022：socket 形状（ws.WebSocket 结构性满足）——broker 自挂聚合器的本进程
 * 虚拟连接按此接口注入 NodeClient/Broker，两个方向各持一端。
 */
export interface SocketLike {
  readyState: number;
  send(data: string, cb?: () => void): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  terminate?(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** caps 数组包含判定（缺省数组=老节点，恒 false）。 */
export function hasCap(caps: string[] | undefined, cap: string): boolean {
  return Array.isArray(caps) && caps.includes(cap);
}

/**
 * 020 tool 值规约（broker/node 共用一处定义）：小写字母/数字，禁冒号禁斜杠，
 * ≤16 字符；大小写归一（大写声明小写化收）。非法返回 undefined（声明侧拒收教学，
 * broker 容错侧静默降级为无 tool）。
 */
export function sanitizeTool(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const tool = raw.toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(tool) ? tool : undefined;
}

export interface InfoFrame {
  op: 'info';
  proto: number;
  server: string;
  caps: string[];
  /** B0 多星地基：broker 星标识（注册表缺省则不发该字段——additive）。 */
  starId?: string;
  /** E0 星名：broker 权威星名（注册表缺省则不发——additive，节点据此同步条目 name）。 */
  name?: string;
}
export interface ConnectFrame {
  op: 'connect';
  proto: number;
  role: 'node' | 'sender';
  machineId?: string;
  /** 星钥（node/sender 角色）；034 管理连接（admin=true）必须缺席——adminKey 永不过线。 */
  auth?: string;
  /** B2.1 修订：节点自报的人读显示名（≤32 字符、无控制符）。寻址权威是 machine-id 前缀，名字不参与回信路由。 */
  name?: string;
  /** 018 proto:3：能力声明（缺省=老节点，proto:1 行为不变）。broker 据此识别会话级成员感知的聚合器。 */
  caps?: string[];
  /**
   * 034 管理连接声明：true 时 auth 必须缺席（星管理钥永不过线）——broker 回
   * auth-challenge（一次性 nonce），客户端以 auth-proof（HMAC 证明）应答。
   */
  admin?: boolean;
}
export interface ConnectedFrame {
  op: 'connected';
  machineName?: string;
  /**
   * 022 多星：星标识挪到钥匙核验后（info 帧无法预知连接属星）——多星 broker
   * 在此回填，新客户端据此核对/同步条目；单星连接不带该字段（字节不变）。
   */
  starId?: string;
  /** 022 多星：星名随 starId 同帧（broker 权威，条目同步与单星 info.name 同源）。 */
  name?: string;
}
export interface ErrorFrame {
  op: 'error';
  code: string;
  message: string;
  id?: string;
}

/** Revoke exactly one star/credential scope; never carries secret material. */
export interface CredentialRevokedFrame {
  op: 'credential-revoked';
  starId: string;
  kind: 'node' | 'admin';
  reason: 'node-removed' | 'admin-key-revoked';
  message: string;
}

function isCredentialRevoked(value: Record<string, unknown>): boolean {
  return typeof value.starId === 'string' && value.starId !== '' && typeof value.message === 'string'
    && ((value.kind === 'node' && value.reason === 'node-removed')
      || (value.kind === 'admin' && value.reason === 'admin-key-revoked'));
}
export interface SendFrame {
  op: 'send';
  id: string;
  targetMachine: string;
  to?: string;
  conversation?: string;
  body: string;
  origin?: string;
}
export interface ReceiptFrame {
  op: 'receipt';
  id: string;
  status: 'delivered' | 'queued' | 'parked';
  turn?: string;
  replyRef?: string;
  /** B2 修订：成功时携带远端 runSend 完整输出（发送方按 ssh 语义展示）。 */
  output?: string;
}
export interface DeliverFrame {
  op: 'deliver';
  id: string;
  /** F1：发送方机器名（broker 注册表 roster 名）；无名瞬态发送方缺省——投递侧据它落信封 from-machine。 */
  fromMachine?: string;
  payload: string;
  /** B2 修订：投递目标三件套随帧透传（B1 只转发 body，节点无从得知路由）。 */
  to?: string;
  conversation?: string;
  origin?: string;
  /** 018：会话级投递目标（三段寻址命中成员的会话 ID）——聚合器本地按它注入投递，不再经名字解析。 */
  sessionId?: string;
}
export interface ResultFrame {
  op: 'result';
  id: string;
  status: 'delivered' | 'queued' | 'parked' | 'error';
  turn?: string;
  replyRef?: string;
  /** B2 修订：status='error' 时的结构化错误（比 ssh 文本重抛更准）。 */
  code?: string;
  message?: string;
  /** B2 修订：成功时携带完整 runSend 输出（发送方逐字对齐 ssh 展示）。 */
  output?: string;
}
export interface FileBeginFrame {
  op: 'file-begin';
  id: string;
  /** B2 修订：broker 按 targetMachine 路由（B1 定义帧型时未含，运行时从未使用）。 */
  targetMachine: string;
  sha256: string;
  name: string;
  size: number;
}
export interface FileChunkFrame {
  op: 'file-chunk';
  id: string;
  seq: number;
  bytes: string;
}
export interface FileEndFrame {
  op: 'file-end';
  id: string;
}
export interface FileResultFrame {
  op: 'file-result';
  id: string;
  ok: boolean;
  path?: string;
  error?: string;
  /** B2 修订：begin 应答携带断点续传锚（0 = 从头传）。 */
  resumeFrom?: number;
  /** B2 修订：秒回去重标记（对端 inbox 已有同 sha 完整文件）。 */
  dedup?: boolean;
}

/** B2.1 修订：成员机向 broker 拉在线机器表（瞬态连接，status 用）。 */
export interface RosterFrame {
  op: 'roster';
}
export interface RosterMachine {
  name?: string;
  mid8: string;
  online: boolean;
  /**
   * 018（批二）：该机当前声明的会话成员（在线聚合器的成员表快照；老 broker
   * 不发此字段——additive，旧读者忽略）。status --stars 视图与启动器 extends
   * 校验（旧名是否仍是活成员）共用。
   */
  sessions?: SessionMemberDecl[];
  /**
   * 028：该机在册但下线的成员（roster offline 条目；additive）。sessions 保持
   * "活成员"语义不动（extends 校验共用），下线面单列——status --stars 三态展示。
   */
  offlineSessions?: SessionMemberDecl[];
}
export interface RosterResultFrame {
  op: 'roster-result';
  machines: RosterMachine[];
}

/** E1 远程枚举：claude 段行（字段镜像本地 status --json 的 claude 行）。 */
export interface StatusClaudeRow {
  name: string | null;
  kind: string;
  status: string;
  pid: number;
  cwd: string | null;
}
/** E1 远程枚举：codex 段行（字段镜像本地 status --json 的 codex 行；id 已截 8 位）。 */
export interface StatusCodexRow {
  name: string | null;
  status: string;
  id: string;
  cwd: string | null;
  createdAt: string | null;
  originator: string | null;
}
/** E1 远程枚举载荷：分段镜像本地语义——codex daemon 没跑时给 unavailable 段而非整体失败。 */
export interface StatusPayload {
  claude: StatusClaudeRow[];
  codex: StatusCodexRow[] | { unavailable: string };
}

/** E1 远程会话枚举（票012）：请求方→broker；目标是节点时 broker 原帧转发。 */
export interface StatusQueryFrame {
  op: 'status-query';
  id: string;
  targetMachine: string;
}
/** E1：目标侧扫描回程（节点→broker，broker 原帧转发回请求方）。 */
export interface StatusResultFrame {
  op: 'status-result';
  id: string;
  ok: boolean;
  payload?: StatusPayload;
  error?: string;
}

/** 018 extends 旧名声明：字符串=同机旧名；{machine,name}=机器限定旧名（跨机接续）。 */
export type ExtendsRef = string | { machine: string; name: string };

/** 018 会话成员声明（sessions 帧元素）：成员键=会话 ID（claude sessionId / codex thread id），名字仅显示/寻址句柄。 */
export interface SessionMemberDecl {
  sessionId: string;
  name?: string;
  /**
   * 020：工具限定词（claude/codex/未来适配器；值规约=小写字母数字 ≤16，禁冒号禁斜杠）。
   * 会话段可选 `工具/名字` 限定词即据此解析——同机跨工具同名时消歧。老聚合器缺省
   * （undefined）——broker 永不硬编码工具清单，声明即寻址。
   */
  tool?: string;
  /** 显式继承的旧会话名（唯一通道 --extend-session；隐式/同名继承已否决）。 */
  extends?: ExtendsRef;
  /**
   * 029 --rm 临时成员标记：死亡（含异常死亡）即删册零痕迹，不留下线册位。
   * 启动器 --rm attach 声明携带 → 聚合器成员表 → broker 册落盘 → 切片回带，
   * 对账循环验得死临时成员即报 member-remove（028 时仅包装器 detach·erase 路，
   * kill 场景册位滞留下线态——drill-028 F1）。
   */
  temporary?: boolean;
}

/**
 * 018 会话成员声明帧（聚合器→broker，node 角色独占）：全量重播语义——数组即
 * 该机（该连接）当前全部会话成员，空数组=清空。连接断开即随机器条目消失。
 */
export interface SessionsFrame {
  op: 'sessions';
  sessions: SessionMemberDecl[];
}

/**
 * 018 恢复链②（批二）：聚合器向 broker 查回"我机器的册内名单"（028 起常驻
 * 对账循环的输入——broker 答以落盘 roster 的本机切片，broker 重启不失忆；
 * 老 broker 答最后已知名单）。node 角色独占；老 broker 不识此帧（发了被丢，
 * 聚合器侧 cap 协商先行，不会发）。
 */
export interface MembersQueryFrame {
  op: 'members-query';
}

/** members-query 应答：该机器最后已知名单（含 extends；死活由聚合器本地验活过滤）。 */
export interface MembersResultFrame {
  op: 'members-result';
  members: SessionMemberDecl[];
}

/**
 * 028 成员删除（双向帧）：命令面 `serve --connect <星> --member-remove <名|id8>`
 * 与聚合器 --rm 退场离册共用。星内任何机器可发（同星共钥=互信域，纯册状态
 * 操作）；broker 侧命中即删 roster 条目并向归属机聚合器转发同帧（清本地表）。
 */
export interface MemberRemoveFrame {
  op: 'member-remove';
  /** 名字精确或会话 id 前缀（≥8 位）。 */
  target: string;
}

/** member-remove 应答：幂等（零命中=ok 注明本不在册）；多名命中=拒绝列 id8 教消歧。 */
export interface MemberRemoveResultFrame {
  op: 'member-remove-result';
  ok: boolean;
  /** 已删除条目的人读标识（名或 id8）。 */
  removed: string[];
  error?: string;
}

/**
 * 034 管理连接挑战（broker→客户端）：一次性 nonce，客户端以
 * auth-proof = HMAC-SHA256(星管理钥, nonce) 的 hex 应答。nonce 每连接每挑战
 * 现发——捕获的旧证明在他连接（nonce 不同）或本连接（一次性消费）都不再有效。
 */
export interface AuthChallengeFrame {
  op: 'auth-challenge';
  nonce: string;
}

/** 034 挑战应答证明（客户端→broker）：钥匙本体永不出现在任何帧里。 */
export interface AuthProofFrame {
  op: 'auth-proof';
  proof: string;
}

/**
 * 034 管理 op 请求（星管理域，已认证连接）：action×角色矩阵在 broker 侧表驱动
 * （成员=星钥连接可读本星；星管理员=星管理钥连接另可发钥/删节点；越权回
 * ADMIN_REQUIRED）。未知 action 同样 ADMIN_REQUIRED（本机专属 op 不上网）。
 */
export interface AdminOpFrame {
  op: 'admin-op';
  id: string;
  action: string;
  /** gen-key：发钥数量（1-10）。 */
  n?: number;
  /** gen-key：node.json 文本落点 host（端口以 broker 实际监听口为准）。 */
  host?: string;
  /** remove-node：目标 label。 */
  label?: string;
}

/** 034 list-nodes 回显行——**永不携带 key/adminKey**（发钥只走 gen-key 显式动作）。 */
export interface AdminNodeRow {
  label: string;
  name?: string;
  mid8?: string;
  addedAt: string;
  /** 星管理钥条目标记（非机器身份——无 key/machineId）。 */
  admin?: boolean;
}

/** 034 list-members 回显行（册内成员快照；册本身无钥匙）。 */
export interface AdminMemberRow {
  sessionId: string;
  name?: string;
  tool?: string;
  machine: string;
  machineName?: string;
  online?: boolean;
}

/** 034 管理 op 回执（一问一答；ok=false 时 error 带人话教学）。 */
export interface AdminOpResultFrame {
  op: 'admin-op-result';
  id: string;
  ok: boolean;
  error?: string;
  /** gen-key：新钥与 node.json 文本（发钥是显式动作——仅此路径回显钥匙）。 */
  results?: Array<{ label: string; key: string; nodeJsonContent: string }>;
  /** list-nodes 回显（无钥匙）。 */
  nodes?: AdminNodeRow[];
  /** list-members 回显。 */
  members?: AdminMemberRow[];
  /** remove-node：是否删到。 */
  removed?: boolean;
}

export type Frame =
  | InfoFrame
  | ConnectFrame
  | ConnectedFrame
  | ErrorFrame
  | CredentialRevokedFrame
  | SendFrame
  | ReceiptFrame
  | DeliverFrame
  | ResultFrame
  | FileBeginFrame
  | FileChunkFrame
  | FileEndFrame
  | FileResultFrame
  | RosterFrame
  | RosterResultFrame
  | StatusQueryFrame
  | StatusResultFrame
  | SessionsFrame
  | MembersQueryFrame
  | MembersResultFrame
  | MemberRemoveFrame
  | MemberRemoveResultFrame
  | AuthChallengeFrame
  | AuthProofFrame
  | AdminOpFrame
  | AdminOpResultFrame;

const OPS = new Set([
  'info',
  'connect',
  'connected',
  'error',
  'credential-revoked',
  'send',
  'receipt',
  'deliver',
  'result',
  'file-begin',
  'file-chunk',
  'file-end',
  'file-result',
  'roster',
  'roster-result',
  'status-query',
  'status-result',
  'sessions',
  'members-query',
  'members-result',
  'member-remove',
  'member-remove-result',
  'auth-challenge',
  'auth-proof',
  'admin-op',
  'admin-op-result',
]);

/** 解析一帧 ws 文本消息；JSON 损坏或 op 未知返回 undefined（调用方丢弃）。 */
export function parseFrame(text: string): Frame | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof obj !== 'object' || obj === null) return undefined;
  const op = (obj as { op?: unknown }).op;
  if (op === 'credential-revoked' && !isCredentialRevoked(obj as Record<string, unknown>)) return undefined;
  return typeof op === 'string' && OPS.has(op) ? (obj as Frame) : undefined;
}

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}
