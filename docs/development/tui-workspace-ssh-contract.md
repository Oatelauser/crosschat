# SSH 工作区应用合同

2026-10-23。用户已批准：外部 SSH Host 只读；TUI 创建的连接可新增、编辑、删除；密码及私钥口令遮蔽输入、仅活动连接内存复用；首次主机完整指纹确认后信任，已知指纹变化拒绝，不能跳过检查。远端不安装软件，失败不回落本机。

## 共享接线

`createSshApplication({ home?, configFile?, env?, onChallenge? })` 保留 `list/discovery/inspect/doctor`，新增：

- `setActiveContext(contextId: string | null): void`：真正进入/离开 SSH 连接时调用；相同 ID 幂等，列表仅移动选择不调用。更换活动上下文取消待决认证并清除内存秘密。
- `dispose(): void`：关闭、退出和异常恢复时取消待决认证并清除内存秘密。
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
