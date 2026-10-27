# 会话选择与成员管理：验收记录

代码与原生/终端验证完成于2026-10-26；用户当时要求“准备暂停任务”，保存检查点后暂停。2026-10-27用户要求继续，随后完成剩余文档统一及审阅。下方保留批准、基础验证边界与暂停历史；当时只验证通用接口就宣布原生改名收尾过早，后续实际接入与限制以[原生改名补验](native-rename-validation-20261027.md)为准。

工作分支：`codex/core-refactor-pre-tui`；暂停及收尾时 HEAD：`84c24af30060c7030b4cbc85729c87a5dbb53f98`。本轮修改仍在工作区，未暂存、提交、发布或全局安装。工作区混有其他聊天修改，不得整批回退、暂存或覆盖。

## 读取入口

1. 本记录及[设计与批准](session-selection-membership-design-20261026.md)。
2. [TUI 续接记录](tui-progress.md)、[核心续接记录](core-refactor-progress.md)、[代码规范](code-standards.md)。
3. 下方验证与能力边界；不要重复已通过的全量检查，除非再改产品代码、出现新失败或存在未解决风险。

## 最终批准，禁止恢复旧设想

用户要求各工具统一并明确答复“采用这套统一规则”：

- 经 crosschat 启动器启动：空白等待，首条输入或 `/resume` 后入星，跟随本窗口切换。当前本聊天接入 Claude、Codex CLI；其他工具接入由「多工具适配」后续实施。
- 直接运行原生工具及桌面/Web：统一由 TUI 明确选择 node 的具体会话入星。所有工具取消裸 `/resume` 自动归队，旧/手动成员也不例外；永久册位保留。这是已批准规则，不是 Codex 的遗留阻断。
- node 普通断网重连重播当前内存声明；node 进程重启后，仍活着的启动器重连恢复当前声明，没有启动器的手动成员由 TUI/显式 adopt 恢复。
- `--rm` 不改变已有永久成员；属性逐星以 broker 为准。A→B 只释放本窗口 A，永久 A 留册下线，临时 A 最后声明释放后清册。
- TUI 手动管理永久成员；不提供永久/临时转换表单，不引入星内别名。原生改名仅在公开接口及实际 owner 同步均核实后开放。
- 安全、秘密与项目目录权限本轮排除。没有生产远端验证、安装或升级授权；禁止在远端 Linux 安装 Codex。

## 已实现范围与接缝

- `src/commands/session-star.ts`：删除无条件“入星…（attach 自动，异常见日志）”；真正失败在 stderr 显示原因、错误码、适用星和绝对 launcher.log 路径。两种 `--rm` 参数顺序已验证；完整原生 ID 及每窗口随机 claim 隔离同目录并发。
- `src/application/session-selection.ts`：窗口选择事件、代次、取消和释放，防止迟到选择或启动结果覆盖当前会话。
- Claude：`src/claude/session-events.ts` 与 `src/commands/session-event-hook.ts`，单次私有 settings/hooks、IPC/token 和实际子 PID 登记核验；不修改全局配置、不保留 prompt。registry 尊重 `CLAUDE_CONFIG_DIR`，暂不可读有界重核，finally 清理。
- Codex：`src/codex/session-events.ts`，私有认证 loopback WS 桥透传实际 native owner；处理 picker 的多连接与连接内请求 ID，拒绝迟到回执，忽略自动标题线程。`src/codex/launcher-owner.ts` 只启动已安装且与 CLI 同版本的 daemon，不下载或修配置。
- node/broker/protocol/registry：claim 绑定真实 attach socket；永久属性保护、最后临时声明清理、精确删册同时撤在线路由；删除整个“原生发现自动复活册位”的循环，所有 Provider 使用同一规则。
- `src/application/session-operations.ts` 及 serve/TCP 接口：describe/apply、逐操作四态能力、精确 node/provider/native 身份、owner/版本/revision 核验，写结果不明不自动重放。第三 Provider 可扩展，不在通用 TUI 散落工具名判断。
- TUI：成员页 a 进入当前星会话发现，会话页 a 对所选完整身份入星；精确删除即时撤路由。节点/成员/会话活动页每2秒有界刷新，弹层暂停；只核验选中行能力，旧代次结果丢弃。默认 composition 已接通 watch 与能力恢复。
- 基础验收时没有启用生产 Claude/Codex CLI/Desktop 原生改名适配器，TUI 改名禁用。第三测试 Provider 通过只证明通用操作链；后续已接入 Codex CLI，Claude/Desktop 的实际限制见[原生补验](native-rename-validation-20261027.md)。

Codex CLI/Desktop、Claude 之外的适配需求已经按用户要求两次交接给既有桌面聊天「多工具适配」。仅要求其登记、排序后续任务，无需回信；不要为了本轮暂停重复投递或轮询。其计划文档属于另一聊天，不能擅自改为“已完成”。

## 最新自动检查

最后 `npm run check` 成功，包含最终统一取消裸 resume 规则及默认 composition 接线：

- lint、TypeScript 构建通过。
- 运行时依赖图：192 modules / 602 edges，无环或越界。
- Vitest：207 文件通过、3 跳过；2130 tests 通过、11 跳过，总2141。
- 普通测试清除 `CROSSCHAT_LIVE`，使用隔离目录、受控 broker/node/WS 和注入原生来源。

定向证据包括 `serve-sessions.test.ts` 37项、`session-star.test.ts` 39项、`tcp-session-operations.test.ts` 5项、`session-operations.test.ts` 4项、Claude/Codex events 各2项、`tui-composition.test.ts` 14项。覆盖永久 rm、多 claim、socket 转移、取消裸恢复、明确选择恢复、第三 Provider、精确入星/删除、断线 uncertain 零重放、能力恢复及默认组装自动刷新。

早先一轮 check 因新增测试的 unused 参数 lint 失败，已修复并运行上述最终成功轮；不以失败轮作通过证据。2026-10-27只修改文档，沿用上述代码检查及原生/终端证据，没有重复启动工具或全量测试。

## 真实原生选择验证

与普通隔离测试分开，均使用独立 profile/workspace、loopback 模型及真实 Windows ConPTY；没有修改用户原生配置或向生产聊天投递测试内容。

| 对象 | 工装及版本 | 最后证据目录 | 结果 |
|---|---|---|---|
| Claude | `test/helpers/session-selection-native-validation.mjs --interactive`；2.1.310 | `C:\Users\YANGSH~1\AppData\Local\Temp\crosschat-native-selection-No68aJ` | passed=true；模型6请求；空白、首条输入、启动 resume、取消 picker、clear、新 B、B输入、菜单 resume A、resize/退出 |
| Codex CLI | `test/helpers/codex-selection-native-validation.mjs`；0.163.0 | `C:\Users\YANGSH~1\AppData\Local\Temp\crosschat-codex-selection-J7swBf` | passed=true；模型4请求；严格 empty A→selected A→empty B→selected B→selected A，标题线程未入星 |

Claude：print ID `8b2350f8-4afd-4938-9d64-9599897b2bc5`，交互 A `862c65cf-873f-4b37-b718-53a51f614fdd`，B `a180e6cd-b10f-4e42-b437-260852fe8821`。Codex：A `01a17795-1e60-7991-9b7c-a1498d749323`，B `01a17795-234c-7a92-9a2f-8e76747fa42b`。

冷启动同版本已有 daemon 的隔离实测证据：`D:\cc-own-cztKHB\evidence.json`；native start/running/stop 已确认。长 TEMP 路径曾触发原生 Unix socket SUN_LEN 限制，改短隔离根后通过；没有安装、bootstrap 或下载。该根内复制的 `.codex/packages/app-server-daemon/current/bin/codex.exe` 已精确删除，证据仍保留。

早先真实 picker 独立连接及自动标题线程误认领问题均已修复后重新验证。Windows fixture 的 loopback 使用 `NO_PROXY=127.0.0.1,localhost`，文本与 Enter 相隔250ms；不要把早期失败当作通过。

## 最终构建 TUI 终端复验

暂停前已收齐 `node test/helpers/tui-tcp-pty-validation.mjs` 的最终结果，工装总退出0。证据根：`C:\Users\YANGSH~1\AppData\Local\Temp\crosschat-tui-tcp-validation-t7u7gT`。

| 场景 | 子场景退出码 | terminalRestored |
|---|---|---|
| tcp-keyboard-resize | 0 | true |
| tcp-selected-session-membership | 0 | true |
| tcp-ctx-interrupt | 0 | true |
| tcp-process-failure | 1（预期异常） | true |

成员场景覆盖指定 node 会话入星、默认取消零写、unsupported rename 禁用、确认绑定 exact ID、精确删册及 resize/退出。曾有一次工装错误假定返回成员页选中首行；产品正确保留第二行，已改工装删除前显式 Home。前一通过根 `crosschat-tui-tcp-validation-KKMe7S` 保留，最终以上表新根为准。

这些终端场景使用受控业务 fixture，真实 broker/node WS 链另由集成测试验证。真实原生选择与真实 broker 并未合成一场双窗口端到端：并发归属和路由由隔离 wrapper + 真 broker 测试，原生窗口选择各自真实验证。未新增真实 SSH/Linux/macOS 或桌面 GUI 端到端验证；桌面通过通用精确管理，不能据此宣称自动跟随 GUI 标签页。

## 暂停时资源与工作区（历史）

- 最终 TUI 工装 exec session 72064 已正常完成，不需再次轮询。
- 可见子代理均已完成，无运行中的子代理；不新增或唤醒代理。
- 只读进程复核未发现上述 native/TUI 工装及短根关联的 node/claude/codex 进程；没有继续测试、部署或修改功能。
- 用户修改、其他聊天的 README/兼容性/清理/研究文档及证据保持原状。曾尝试的 members 模块 Claude 特例已语义恢复，勿为清理换行状态误删其他工作。
- GitHub 如后续需访问，按用户指定逐命令使用 `http://127.0.0.1:7897`，不修改全局代理；公共 API 共享出口额度曾耗尽，raw/page 可访问。

## 2026-10-27 收尾验收

- README、broker、federation、TUI使用说明与按键表均已统一入口、每星属性和重启规则；移除裸 resume 自动归队的现行教学。补充多星成功确认仅写日志、临时最后声明释放、已有永久属性保护及 id8 寻址也需要在线。
- 设计与长期接口明确首条输入/恢复选择、指定 node 的完整身份入星、2秒有界刷新和按操作能力禁用。当时生产 Claude/Codex 原生改名保持禁用，没有用第三 Provider 测试冒充原生实现；后续实现见原生补验。
- 已审阅选择 follower、两家原生事件、wrapper、node/broker claim与属性、精确操作/协议、TUI能力核验和默认composition接线。收尾没有改变已验证的产品代码。
- 已检查本轮相关文档的147个相对链接，均可达；现行教学中旧恢复说法搜索无命中。Wayfinder新增当前规则说明，028等历史票据和旧验收事实原样保留。
- `git diff --check` 通过；换行提示不属于检查失败。TUI续接记录及设计状态已更新为开发验收完成，本轮完成项不再列为活动任务。

基础入星及成员管理的开发验收已完成。原先据此宣布整个批准范围没有剩余项的结论过早：原生改名仍需实际接入和验证，该项已由[后续补验](native-rename-validation-20261027.md)补齐 Codex CLI 及 Claude/Desktop 能力边界。安全与目录权限按用户决定排除；其他工具适配属于已交接的后续计划。没有新生产远端或桌面GUI端到端结论，也没有发布或全局安装。
