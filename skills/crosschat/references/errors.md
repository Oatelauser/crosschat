# crosschat 报错自纠目录（读错误码，不要即兴发明命令）

- `USAGE` 且提示缺少 `--tool`：所有 `send` 都必填收件类型，包括回信。照用完整 hint/TUI 命令，或先核实目标类型后补齐；已有 `--conversation` 保留不变。
- `TARGET_TYPE_REQUIRED`：收件端类型仍未核实。查 `discover` / TUI，按实际目标选择 `--tool`，保留原路由。
- `CALLER_IDENTITY_UNRESOLVED`：原生 ID 与对话两端无法确定匹配关系。保留真实原生身份和原引用，按具体错误核对；来源分类暂不可用或未知本身不阻止原生身份已匹配、收件明确的回信。收件 `--tool` 不能补造缺失或冲突的原生身份。
- `TARGET_CONFLICT`：`--tool` 与固定引用的收件端类型冲突。核对完整目标后修正选择；若有意发送给另一端点，明确使用新的 `--to` 和相应 `--tool`。
- `BAD_PROTO` 且提示端点类型能力缺失：升级对应 crosschat 发送端/broker/node 后再用原类型发送，不能丢掉端点限定继续投递。

- `MESSAGE_TOO_LARGE`：按报错给出的通道和上限处理；提额、路径引用或文件通道的选择见 [advanced.md](advanced.md)。准确数字以当前报错为准。
- `RATE_LIMITED`：发送过快（每对端点 60 秒最多 30 条）。**等待后重试**，或直接总结收尾；系统不会静默丢弃或自动重试。
- `TCP_TRANSPORT_FAILED`（tcp 形态）：连不上 broker 或等回执超时——**远端状态不明，勿盲目重发**（可能与首次投递叠加）。先在对端查 send-log 或 `status --conversations` 核实后再决定。
- `PEER_OFFLINE`（tcp 形态）：对端**机器**当前不在线——稍后重试；若两端另配了 ssh 也可走 ssh 形态。
- `SESSION_NOT_MEMBER` / `SESSION_OFFLINE` / `MACHINE_BOUND` / `SESSION_SUPERSEDED`：分别表示未入册、在册下线、机器绑定或已有接任者。按 [stars.md](stars.md) 的对应恢复路径处理，不静默改投。
- `NAME_COLLISION`（tcp 寻址）：选定收件类型内有多个同名候选。保持 `--tool`，将会话段换成发现结果中的完整原生 ID。
- `STAR_DELETED`（tcp）：星已被 `--remove-star`——册随星葬、钥匙作废、无复活，被删星连接即断。找 broker 主 `crosschat serve --add-star <星名>` 重建后重新配钥入星；拿死星钥发送会报 `BAD_AUTH 钥匙不匹配任何星——星可能未创建或已删除`，别重试（旧钥已废）。
- `ADMIN_REQUIRED`（tcp 远程管理 op）：非管理员调管理 op（普通成员发钥/删节点，或任何人远程调加删星/改星名等本机域 op）——世上不存在全能远程钥匙；找星管理员（星管理钥，`--via tcp:<星>` 写 op）或到 broker 机本机执行。
- 收到"文件 … 已送达"但那个路径不存在：附件超过 5 天被回收——回对端"**附件已过期，请重发 --file**"。
- `CODEX_THREAD_LOCKED` / `CODEX_THREAD_BUSY_TIMEOUT`：目标写者占用或暂不可投递。以本次结果为准：`parked` 表示已暂存并安排自动补投，无需重发或轮询；投递失败则按报错处理。`steer` 不自动变成轮后补投。
- `CODEX_WRITE_UNCERTAIN` / `CLAUDE_PIPE_WRITE_UNCERTAIN` / `OPENCODE_WRITE_UNCERTAIN` / `DSH_WRITE_UNCERTAIN`：写入可能已被接受，先核对目标历史或日志，不直接重发。已有本机寄存项出现此状态会暂停补投；Harness 通道没有 Codex 的寄存补投。
- `OPENCODE_NOT_CONFIGURED` / `OPENCODE_REGISTRATION_UNREADABLE` / `OPENCODE_REGISTRATION_MALFORMED`：核对 OpenCode V2 CLI 或桌面默认本机服务是否正在运行及配置目录是否一致，再刷新。桌面会话在原生桌面打开；crosschat 只发现已有服务，不自动启动或修复。
- `OPENCODE_AUTH_REQUIRED`：核对所选 OpenCode 服务的认证；显式 `CROSSCHAT_OPENCODE_TOKEN` 对应服务密码，不是模型 API key，默认服务认证从原生注册记录读取。
- `OPENCODE_OWNER_MISMATCH`：注册记录与当前响应服务不一致；等 OpenCode 重启完成后刷新，不改投其他实例。
- `OPENCODE_UNSUPPORTED_VERSION` / `OPENCODE_PROTOCOL_ERROR`：当前服务版本或接口不匹配，保留错误码与工具版本排查兼容性；不以新建会话绕过。
- `OPENCODE_SESSION_NOT_FOUND`：目标完整会话 ID 已由服务确认不存在，重新核对目标。`OPENCODE_LOCATION_NOT_FOUND` 表示工作区位置不可解析，核对对应工作区配置；两者不互相替代。
- `DSH_NOT_CONFIGURED`：当前用户下没有 live Harness 桥；在实际使用的 profile 启用 crosschat Host bundle 后刷新。`crosschat dsh-bridge-path` 只输出随包目录，安装步骤见[Harness 使用说明](https://github.com/Oatelauser/crosschat/blob/main/docs/deepseek-harness.md)。
- `DSH_REGISTRATION_UNREADABLE` / `DSH_REGISTRATION_MALFORMED` / `DSH_UNAVAILABLE`：登记损坏、不可读或活实例失联，保留来源错误并核对实际 Harness 实例；发现命令不自动修复或启动服务。
- `DSH_AUTH_REQUIRED` / `DSH_OWNER_MISMATCH`：桥的实例凭据或 owner 不匹配，等原生实例重启完成后刷新。登记中的 token 是本机桥凭据，不是模型 key，不在聊天中粘贴。
- `DSH_UNSUPPORTED_VERSION` / `DSH_UNSUPPORTED_PROTOCOL` / `DSH_PROTOCOL_ERROR`：保留实际 Harness 版本、桥版本和错误码，按兼容性问题排查。`DSH_AMBIGUOUS_SESSION` 表示多个 live 实例包含同一原生 ID，先由用户关闭重复 owner 后刷新。
- `DSH_SESSION_NOT_FOUND`：目标已不是当前 live root Agent，核对完整 ID，并由用户在原生 Harness 打开目标历史会话后刷新；crosschat 不恢复或新建替代会话。
- `CODEX_DESKTOP_OWNER_UNAVAILABLE`：名称已命中保存记录，但本次未找到 Desktop owner；在桌面打开目标后再试。该结果只描述 Desktop，不能推断 CLI 也不可达。
- `CODEX_TARGET_PROBE_FAILED` / `CODEX_DISCOVERY_UNAVAILABLE`：目标探测或记录来源读取失败，不能当作名称不存在。按报错中的 `stage` 和 `code` 排查，保留原目标与模式。
- `CODEX_TARGET_DISCOVERY_CHANGED`：首次名单与补查期间状态发生变化，补查已能探测目标；本条仍未发送。核对目标后可重新执行原命令。
- `CODEX_DESKTOP_UNAVAILABLE` / `CODEX_DESKTOP_TIMEOUT`：桌面通道或已绑定的 owner 不可达。确认目标桌面会话仍打开，再按错误信息处理；启动另一个 CLI daemon 不会恢复桌面 owner。
- `CODEX_DESKTOP_UNSUPPORTED` / `CODEX_DESKTOP_PROTOCOL_ERROR` / `CODEX_DESKTOP_REQUEST_REJECTED`：当前桌面协议能力或请求不匹配，保留错误上下文排查。不要把 `steer` 改成 `queue` 来掩盖失败。
- `OUTBOX_BUSY`：本地队列锁被占用，本条没有成功寄存；等待占用结束后再发送。`OUTBOX_FULL` 则按报错中的 mailbox 路径取回已有内容，先处理积压。
- `OUTBOX_INVALID_THREAD_ID`：当前原生 ID 不能安全用作本地寄存文件键。保留完整 ID 并报告适配问题，不通过截断、改写 ID 或改投其他会话绕过。
- `CALLER_IDENTITY_CONFLICT`：多个原生工具的身份变量同时存在（包括 `DSH_SESSION_ID`），或 OpenCode 的原生与显式会话 ID 不一致。先确认当前实际宿主，只在发送命令的子进程中移除其他工具或显式覆盖的残留身份；保留当前会话的真实身份和原回复路由。无法确定宿主时报告冲突，不靠改名、改引用或重启其他会话绕过。
- 其他错误码：错误信息已写明原因与出路，按信息处理即可。

## 自身工具类型待核实

程序优先从原生调用识别自身类型，`send --tool` 始终只选择收件端。需要查看本次来源状态时，在当前原生会话运行 `crosschat identity`，保留输出的状态和原因。

只有程序返回 `shouldAsk: true` 及本次生成的确认命令时，才向用户询问自身工具类型；用户回答后用该命令填写真实类型，逐字保留程序生成的 `--context`。`identity confirm` 的 `--tool` 表示要确认的自身类型，与 `send --tool` 的含义不同。已有待确认项由同来源其他会话展示时等待共享结果；同来源的新会话和可自动重核的正常重启不各问一次。`send` 的来源探测不创建询问；当前真实未知入口的人工确认范围仍需逐项批准，不能把兜底机制当作全部工具已经支持。

若程序报告无法关联当前来源、能力缺口或待决策，保留证据交用户判断，不用逐会话重复提问、伪造环境变量或全局记住一个猜测类型。来源暂不可达时允许程序在恢复后只读重核；结果不明的发送仍按原有规则核对，不自动重发。
