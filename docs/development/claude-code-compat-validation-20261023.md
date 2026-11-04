# Claude Code CLI 兼容 CI 开发与验收记录

2026-10-23，Asia/Shanghai。用户在 ZCode 实测后选择暂缓其接入，按既定 C01 顺序继续已有工具兼容 CI。此文件保留范围、TDD 与真实验证证据；未运行的事项不记为通过。

## 范围与所有权

- 使用正式 Windows x64 Claude Code CLI + 生产 crosschat wrapper / 发现 / 管道发送 / 回信；模型端为本机 HTTP Messages 脚本服务，固定假 key，不接真实模型服务。
- 不改已有工具行为。交互 TUI、Desktop、真实 SSH/TCP，以及工具 × Linux/Windows/macOS 的 C00 矩阵均不计入本轮通过。
- 测试总根按用户要求保留：`D:\workspace\CC\multichat\node_modules\.cache\crosschat-dsh-20261023-0975b6b93f724fec95264ad45903f291`。本工具独占 `claude-compat-20261023-b118f74c76a441009eed1e03c1a9932c`，已记录 ownership 与用户原有 Claude 的安装前基线；不运行、升级或卸载用户原有 Claude。
- 本批直接取官方 npm 原生包并校验后隔离使用，无全局安装、自更新、PATH 或协议注册。CI 每轮隔离软件副本均已自动清除；初始引导便携副本的删除被自动审批拒绝，按用户已批准的 D盘总根统一删除约定保留。详情见文末清理结果。
- 原生执行 job 只有 contents:read；独立报告 job 在默认分支用受信提交的 validator 审查 artifact 数据后才允许去重 Issue。不把本地脚本通过称为 GitHub Actions 已运行/启用，不为验证而创建外部 Issue。

## 已核实的正式发行与最小原生路径

平台包 `@anthropic-ai/claude-code-win32-x64@2.1.309`，官方固定 URL / SHA512 SRI / 实际字节与 exe SHA256 见[引导证据](evidence/claude-code-compat-20261023/native-bootstrap.json)。压缩包 136,346,595 字节，四个普通文件；路径、类型、摘要与 metadata 已检查。`--version`、`--help` 正常退出。官网合同研究见[一手研究](../research/claude-code-compat-contract-20261023.md)。

独立最小真实会话使用 `--safe-mode` + 普通 `-p` / stream-json / `crossSessionInbound: accept`，并保持 stdin。实际 loopback 收到两次 Messages 请求；真实 Bash 的 socket、session ID 和 home 与本次隔离注册匹配，Windows key 文件存在；正常 result 后 stdin.end，exit0，注册撤下，模型和探针服务关闭。随后操作系统核对未见本工具根下的 Node/Python/Claude 运行进程。这个最小探测不代替下面七项完整生产 Adapter 验收。

`--bare` 会关闭原生 inbox，不能用于此兼容测试。长 D盘根叠加 npm 布局的 exe 路径超过 Windows MAX_PATH；普通 Node spawn 的 ENOENT 已单独复现，同一个自有文件在 APPDATA 使用 Windows 扩展路径后可正常启动。工装处理该路径，不修改生产 resolver。

## TDD 证据

| 提交 | 实际验证 | 结果与边界 |
| --- | --- | --- |
| `d2cdb89` | `npm test -- test/claude-compat-ci.test.ts test/claude-compat-fixture.test.ts` | 编译期 RED：新增引用的工装模块尚未实现，未执行测试用例；不记作业务运行期失败 |
| `abe1d7b` | `npm test -- test/claude-compat-fixture.test.ts` | 18项模型/profile 通过；新增 workflow 信任边界用例实际执行并因缺 workflow 失败 |
| `2bb0415` | 上述两个 target | 33/33 受控检查 GREEN，含发行物、解包、fresh report、清理所有权、模型/环境隔离和 job 权限边界；不计真实 Adapter 通过 |
| `f863604` → `b05d86f` | `npm test -- test/claude-compat-ci.test.ts` | 15项中1项运行期 RED→15/15 GREEN：拒绝同检查既通过又失败、顺序矛盾或跳过前序检查的回归证据 |
| `6aeca51` → `0e53369` | `npm test -- test/claude-compat-lifecycle.test.ts test/claude-compat-fixture.test.ts` | 生命周期4项实际失败→4/4通过，原工装19/19通过。初始化失败关闭模型；清理步骤失败不阻断剩余资源释放，未知状态保留 |
| `88a737f` → `0ec8764` | `npm test -- test/claude-compat-evidence.test.ts`，再执行全部四个 Claude 工装 target | 新增5项实际 RED→GREEN；全部43项通过。只有本次原生 init / 模型 / 工具 / ACK 证据充分后才将注册或身份差异归为 compatibility，工装与清理失败仍为 infrastructure |

不以固定覆盖率或用例数量代替判断。新 profile 的实际 child homedir/tmpdir、外部 URL 写入前拒绝、挂起 HTTP 响应取消，以及清理错误后的模型关闭均有受控行为检查。

## 完整原生验收门槛

| 检查 | 要证明的行为 | 当前状态 |
| --- | --- | --- |
| 正式 wrapper 与原生注册 | 两个自有 CLI 的 PID、完整 ID、名称、cwd、socket/key 归属正确 | 通过 |
| 模型与普通 Bash 身份 | 真 tool_use → Bash → tool_result → result，身份源于原生 socket，Bash 实际 cwd 也在自有 workspace | 通过 |
| 发现与空闲 queue/steer | 生产分页发现两会话，两模式各一次原生唤醒 | 通过 |
| 忙时 queue | 真工具 gate 完成，原轮先结束，消息在后继轮被消费，共两个 result | 通过 |
| 忙时 steer | 真工具正常完成后于当前轮消费追加内容，共一个 result | 通过 |
| 原生 shell 发送与会话回信 | 两侧实际 Bash 调用 crosschat，使用当前信封回信，ref 全ID/nonce/turn 正确 | 通过 |
| 退出与缺目标 | 旧完整目标、缺目标失败，不创建替代会话；所有自有资源正常关闭 | 通过 |

忙时判断采用实际模型请求、工具结果、原轮 assistant 历史和真实 result，不依赖 stdout 与 HTTP 两条通道在父进程中的回调到达先后。底层管道 `delivered` 只证明写入，不能独立作为消费成功证据。

已保留两次完整脚本的工装校准证据：[第一次](evidence/claude-code-compat-20261023/manual-probe-1.json)在原生初始化结束前读取到自动名，已调整为 bootstrap 完成后读取当前注册；[第二次](evidence/claude-code-compat-20261023/manual-probe-2.json)第0项通过，两会话各完成一个无错误 result，但解析 Bash 工具结果完整文本时因 JSON 后的附注失败。二者均是 infrastructure、无回归通知，正常退出、注册撤下、模型关闭和自有 fixture 删除全部通过；不能记成上游协议变化。

[第三次](evidence/claude-code-compat-20261023/manual-probe-3.json)通过前四项，但 steer 判断只看 user/text，漏看真实模型输入中的 user/tool_result 附注，报告暂列 compatibility；[第四次](evidence/claude-code-compat-20261023/manual-probe-4.json)完整七项通过，并记录追加消息确实在 user/tool_result。没有为了通过测试改变产品映射或增加固定 sleep。第三次不是已证实的上游回归，也没有创建 Issue。

完整 [CI 串行序列](evidence/claude-code-compat-20261023/sequence-1-summary.json)也已运行：固定基线和当时 latest 候选均为 2.1.309，各自全新环境七项通过，run ID 不同；进程 code0、signal=null、timedOut=false，两轮 runtime / 注册 / 模型 / fixture 均正常释放，forced=false、errors=[]；安装 task root 已删除，分类 compatible、notify=false。只读复用本批已下载的官方 tgz，仍重新校验其 SHA512，不借用用户安装。

现有 Claude CLI 不支持 `--to claude/<UUID>`；工装按真实唯一完整名称发起投递，并解码回执确认精确原生 ID。退出/缺目标则用正式完整 conversation ref 精确投递并核对 TARGET_NOT_FOUND。不添加新的产品寻址语法。原生回信复制本次唯一请求信封的短柄，避免从旧历史误取 human 会话。

## 最终本地验收与清理

后续清理状态更新（2026-10-23 17:01，Asia/Shanghai）：用户要求核对临时文件，[只读复核](evidence/tool-integration-cleanup-20261023.json)确认 D盘总根已不存在，因此下文历史记载的初始引导便携 exe、tgz 及其临时研究/证据副本已不在该位置；Temp 下 `crosschat-*` 文件和目录均为0。旧清理 JSON 和拒绝回执保持原样，仓库内的脱敏验收证据保留。本次没有再次执行删除或运行工具。

失败分类修复后，最终 [第二次串行 CI](evidence/claude-code-compat-20261023/sequence-2-summary.json)再次通过：基线与当时最新候选均为 2.1.309，分别七项通过，正常 code0 / 无信号 / 无超时，两个自有 runtime、注册、模型服务、fixture 和安装目录均正常清理，compatible、notify=false。

`npm run check` 退出0：ESLint、184模块 / 584边运行时依赖图（无环或越界）、TypeScript build、Vitest 全部通过。200个测试文件通过 / 3个跳过，2084项通过 / 11项跳过；新的四个 Claude 受控 target 共43项通过。真实原生兼容序列另行执行，不把旧 live suite 的跳过当作真实验证通过。已测试源 HEAD 和统计见[最终验证记录](evidence/claude-code-compat-20261023/verification.json)。

只读收尾核对：本工具根下匹配到的自有 Node/Python/Claude/Bash 进程为0，用户原有 Claude 命令路径与 baseline 一致。所有 CI 安装与 live fixture 已删除。剩余初始引导便携 `claude.exe` 一份，SHA256 与下载验证时相同；尝试在核对 owner / 绝对路径 / 摘要后删除它，自动审批复核拒绝启动该操作，原因为 `blocked by policy`。未换 Node、其它 shell 或 CI 包装绕过删除；按用户既有决定保留在 D盘独占测试根，连同 tgz / 研究 / 证据由用户最后统一删除。没有本批全局安装或系统注册需要卸载，也没有卸载用户原有软件。具体路径与剩余数量见[清理记录](evidence/claude-code-compat-20261023/cleanup.json)。

本批保证上述七项行为，不声称覆盖原生所有配置组合。生产 wrapper 固定 accept；直接启动原生 CLI 的 refuse，以及无/错误 peerToken 的原生负向场景尚未实跑，研究报告中的这些建议没有计为通过。交互 TUI、Desktop、模型推理质量、三平台矩阵也不在本批实际结果内。

代码与本地正式验证完成；GitHub 托管 runner、定时触发、artifact 和 Issue job 的首轮仍需工作流进入默认分支后记录实际 run，见待办 C06。没有推送、发布共享 API 资料或创建外部 Issue。
