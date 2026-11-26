# 1.13.2 发布记录

2026-11-26。用户要求“提交+发布”，并在发布范围确认中选择“仅本次修复：从 1.13.1 单独适配发布”。

## 来源与范围

- 原开发工作区仅提交本聊天的 22 个文件为 `f52307d`（`fix(codex): restore Desktop messaging through native app tools`），其余未提交工作保持原处。
- npm 1.13.1 的 gitHead 与标签 `v1.13.1` 均为 `874461ae9ecdb799d880c28c1db30999c2c51555`。远端 main 当时比此基线多 442 个提交，不能作为用户选定的窄范围发布基线。
- 本发布分支 `codex/release-1.13.2` 从上述标签建立，独立适配本次原生宿主桥和 IPC 错误诊断。未合入 main 的 OpenCode、Harness、C14 命令或新会话格式。
- 新工具和端点类型限定在集成入口；旧 send 管线只将原生受理结果的 `turnId` 改为可选。CLI 参数、旧信封和会话存储保持 1.13.1 格式。package 与 lock 仅更新项目版本，package.files 增加桥目录，依赖版本保持。
- 开发分支的调查、真实双向验证和旧测试结果保留于 [诊断记录](codex-desktop-ipc-diagnosis-20261125.md)；它们不代替本发布分支的独立验证。

## 行为与使用

当前宿主通过正式 `list_threads`、`read_thread`、`send_message_to_thread` 执行 native MCP，crosschat 负责信封、限流、通信对续话和日志。发送前核验真实 Codex 发送方，完整发现后按完整 ID 优先、否则旧名称规则选目标，再复核目标状态。严格拒绝未知或不匹配的返回；不确定写入不自动重试、不改投 CLI、不进入补投队列。

桥仅支持本机显式 `--to <名称或完整ID> --tool codex-desktop --delivery steer`。`--tool` 只属于桥入口；普通 `crosschat send` 仍走旧路径。桥不接受 queue、conversation 引用和远端路由。旧回复 hint 仍指向普通 CLI，使用桥回复须指定已核实的真实发送方 ID。具体宿主接入见 [说明](../../skills/crosschat/references/codex-desktop-native.md)。

原生工具受理没有 turnId，结果诚实返回 `unconfirmed`，不得据此重发。默认 IPC 探测仍保留既有回退；发现诊断明确区分缺少通道与缺少 owner。无需修改审批策略、绕过正式 MCP 或安装远端 Codex。

## 独立验证

- 本发布工作树重新 `npm ci`、定向测试、`npm run check`，均退出 0。
- 最终完整检查：ESLint / TypeScript 通过；187 模块、581 条运行时依赖边，无循环或边界违规；179 个测试文件通过、3 个既有跳过；1,920 项通过、11 项既有跳过、0 失败。
- 原生桥 99 项隔离测试；诊断与原路由 67 项定向测试。完整 ID 被另一会话标题遮蔽、匿名目标显示的回归均验证 RED→GREEN，只在新入口修正，未改旧全局寻址。
- `git diff --check`、构建 CLI 版本 `1.13.2`、桥 `--help` 均通过。npm pack 含 388 个文件、722020 字节，包含桥、编译模块和技能说明，未带测试、依赖、其它工具适配或用户配置。本机 tgz SHA256：`d00ae7ae671999cfbf20a4c321ce51cfaaf6ec37a3844b7f5be2e5e726191c10`。
- 从 tgz 解包后独立安装生产依赖，CLI `--version` 与桥 `--help` 均退出 0，确认安装包可加载新入口。
- 本版本构建通过实际宿主工具向“多工具适配2”投递 `CC-RELEASE-1.13.2-20261126`，使用真实当前会话身份、独立临时状态目录，返回 delivered / steer / unconfirmed，旧格式 handle `c1`，进程退出 0。
- 目标轮次 `01a215be-3a9d-7583-96ed-bcd059231efa` 完成并回复：“已收到 CC-RELEASE-1.13.2-20261126。cross-session-message 和 crosschat-reply-hint 均可见，标签以转义文本形式呈现。” 本次只验证发布构建的实际单向消费；旧版本双向续话由本分支隔离测试验证，原开发实现另有真实双向证据。

检查日志、包审计和发布回执保存在仓库外 `C:/Users/yangsheng/.codex/artifacts/crosschat/release-1.13.2/`。发布沿用 GitHub Release → Windows / Node 24 完整检查 → npm Trusted Publisher / OIDC；最终状态以 [GitHub Release](https://github.com/Oatelauser/crosschat/releases/tag/v1.13.2)、发布 Actions 和 npm 元数据为准。
