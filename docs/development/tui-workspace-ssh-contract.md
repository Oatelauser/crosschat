# SSH 工作区应用合同

2026-10-23。用户已批准：外部 SSH Host 只读；TUI 创建的连接可新增、编辑、删除；密码及私钥口令遮蔽输入、仅活动连接内存复用；首次主机完整指纹确认后信任，已知指纹变化拒绝，不能跳过检查。远端不安装软件，失败不回落本机。

## 共享接线

`createSshApplication({ home?, configFile?, env?, onChallenge? })` 保留 `list/discovery/inspect/doctor`，新增：

- `setActiveContext(contextId: string | null): void`：真正进入/离开 SSH 连接时调用；相同 ID 幂等，列表仅移动选择不调用。更换活动上下文取消待决认证并清除内存秘密。
- `dispose(): Promise<void>`：关闭、退出和异常恢复时取消待决认证并清除内存秘密，等待 owned helper 与临时目录清理。
- `configuration.preview(request)` / `configuration.apply({...request, expectedRevision})`：仅写 `.crosschat/ssh-connections.json` 的 TUI 受管条目，绝不改外部 `.ssh/config`。请求 operation 为 `create/update/delete`，update/delete 以完整 contextId 定位，create/update 的 profile 为 `{name,host,user?,port,keyFile?}`。preview 返回 `{enabled,revision,impact,reason?}`；apply 返回 `{status,message,contextId?}`，status 为 applied/changed/blocked/cancelled/failed。确认与保存之间配置变化即拒绝。

`SshChallenge` 与 `SshChallengeHandler` 从 `application/ssh/index.ts` 导出：

```ts
type SshChallenge =
  | { kind: 'password' | 'passphrase'; contextId: string; host: string; prompt: string }
  | { kind: 'host-key'; contextId: string; host: string; prompt: string; algorithm: string; fingerprint: string };
type SshChallengeHandler = (challenge: SshChallenge, signal: AbortSignal) => Promise<string | boolean | null>;
```

handler 由 composition 映射到通用 prompt：secret 对应密码/口令，confirm 对应主机信任。秘密不得进入普通页、snapshot 只读字段、日志或偏好；拒绝和取消返回 null/false。指纹挑战必须有原生 OpenSSH 提供的完整 SHA256 指纹和算法；单独的 yes/no 提示一律拒绝。原生 OpenSSH 执行权威主机密钥检查与 known_hosts 写入，不使用 `StrictHostKeyChecking=no`、`accept-new` 或 `/dev/null` 信任库。

原生 SSH 调用保留三 pipe 的结构化 discover/doctor 数据；交互通过独立 owned ASKPASS 桥，不占用远端命令 stdin。桥只在本机临时保存公开 helper 程序，秘密通过有界、随机能力保护的本机 IPC 传递；取消、超时、进程 close 和 dispose 收口 socket/listener/helper 临时目录。配置版本变化清除旧凭据；外部认证源（SSH agent 等）仍由 SSH 自身管理。

## 资源入口

`createSshResource({ssh})` 保持原名。列表 `a` 新增受管连接、`e` 编辑受管连接、`Ctrl+D` 删除受管连接；外部 Host 两项写操作置灰并说明来源。Enter 进入远机会话、t 检测、D 体检、d 详情、g 指引、y 复制、i 读取信息保持。详情展示安全连接参数与配置归属，绝不显示秘密。

受管连接不会伪造原生 SSH Host 别名；原 CLI `send --via ssh:Host` 的解析和行为保持。受管远机会话没有可直接使用的原 CLI 寻址模板时明确禁用 y，仍可 Y 复制完整 SessionRef、g 查看原生终端执行位置；不生成无效命令。只有 TUI 显式传入 onChallenge 才启用交互，旧非交互应用调用保留 BatchMode。

## 隔离验证与限制

- 应用/资源/上下文定向共 55 项：外部配置保持、受管 CRUD、确认版本拒写、秘密字段拒收、损坏/链接存储拒写、活动上下文和配置变化清凭据、取消与未知提示拒绝，以及真实本机 ASKPASS helper 的完整指纹、秘密不落 env/argv/file、进程和临时目录回收。
- `node test/helpers/tui-ssh-native-validation.mjs` 是可选探针，仅利用本机已有 Windows OpenSSH 9.5p2 和本机 WSL OpenSSH 8.9p1/Node 22。产品运行不依赖 WSL；探针不安装软件，不连接生产主机，不修改用户账户或系统配置。
- 2026-10-23 八项原生链通过：Windows ssh 实际连接临时 loopback sshd，首个完整指纹等于服务端实际 key；加密私钥口令认证；确认后 isolated known_hosts 落盘；刷新不重问；受管配置实际参数可连接；切换连接后重问；已知指纹变化拒绝且不重新询问信任。服务端保留 StrictModes=yes。
- 首跑临时 authorized_keys 放在 /tmp 子目录，sshd 按其 StrictModes 规则拒绝可写祖先；仅把自有 fixture 改到 WSL root 的私有临时子目录后通过。没有放宽 SSH 主机核验或服务端文件权限检查。最终自有服务、Windows/WSL 两侧已验证临时根全部移除。
- 实际密码服务端认证未在这项原生探针证明：密码分类、实际 ASKPASS helper 传递、缓存和取消通过受控测试；本机原生服务器探针采用临时加密私钥，未改任何系统账户密码或 PAM。该探针也不代替 macOS/Linux 真实终端验收。
