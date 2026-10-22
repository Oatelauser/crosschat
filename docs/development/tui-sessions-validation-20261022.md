# TUI本机会话验收

2026-10-22。用户授权T07，分支`codex/core-refactor-pre-tui`；起点`cf93a33`（1304通过/11跳过），最终产品`4804b25`，最终全仓检查含输入fixture修正`899725b`。正常开发，无时间截止。长期行为见[本机会话规格](tui-sessions-spec.md)，操作说明见[终端界面](../tui.md)。

## 授权与交付

- 用户批准按完整SessionRef精确收编，含符合条件的匿名/同名会话；确认中列明可能启动聚合器。原CLI按名选择和原生聊天行为保持。
- 用户批准broker原子精确删册：同一步匹配完整会话ID、完整机器和工具，目标变化即拒绝，绝不回落名字/前缀。沿用星成员权限，不做旧端兼容/降级。
- 本机sessions默认包含匿名、读完每来源分页、整体替换结果；动态工具/原生状态及命名筛选与输入栏全文筛选独立。错误、部分结果、取消和空筛选可区分；空列表也能查看完整读取信息。
- 表格截断展示，详情保留完整安全元数据/raw状态/采样；y仅给出符合原CLI选择范围与解析规则的采样地址，Y复制完整引用。g为只读原生指引，无聊天代理或启动行为。
- 收编与删册从所属列表发起，枚举星选择、默认取消、双重核验及失败留值。精确引用贯穿应用接口、聚合器身份和broker回执，已发写不明保持待核实且不自动重试。
- Provider差异留在读取/状态/指引/成员能力登记，通用controller/UI无工具分支。应用模块不依赖commands或TUI，CLI共享attach提取保持既有选择行为。
- T08—T12及T14未开工；SSH/TCP业务页面与其余观察/管理资源等待后续指令。

## 自动检查

环境：Windows、Node25.0.0、npm11.6.2、PowerShell7.6.5。普通测试显式清除CROSSCHAT_LIVE，使用临时目录、注入的Discovery/原生依赖及受控本机服务；不读取真实用户会话/钥匙、不写用户剪贴板、不连接真实SSH或TCP目标。

2026-10-22 12:29:04（UTC+8）开始的最终`npm run check`退出0：

- ESLint通过，新增应用/TUI模块继续启用类型导入和Promise规则。
- 运行时图121模块、352边，无环、未解析依赖或跨层违规。
- TypeScript构建通过。
- Vitest **1377通过、11跳过**；106文件通过、3跳过。跳过为既有live项，未用mock结果声称真实原生会话验收。

输出：`%TEMP%/crosschat-t07-check-20261022-final.txt`。首轮1376通过、1失败、11跳过，唯一失败为原输入批次fixture在空ctx集合下期望进入sessions；新上下文绑定规则要求有效连接。修正fixture并断言完整route，21项定向测试通过后重跑全仓；没有修改输入实现或跳过失败项。首轮输出保留为`%TEMP%/crosschat-t07-check-20261022-first.txt`。

受控真实Broker/NodeClient/WS/attach管道验证：普通星成员权限可精确删除离线册位，邻星/同名/前缀目标保持；会话身份变化拒绝，匿名/同名完整引用收编能由权威星册确认；实际WS握手身份在断开后清除。原生来源与投递依赖均为隔离fixture，不发送真实消息。

## 独立审查与失效路径

以下问题均先保存有意义RED，再保存GREEN：

| 行为/风险 | 实施与证据 |
|---|---|
| 分页与取消 | 空页继续、重复cursor停止、逐来源partial保留、未知工具/raw状态、迟到读不覆盖，完整性不冒充空数据 |
| 稳定身份 | 同ID跨工具/同名/短前缀不合并，Y保留完整SessionRef，刷新/返回保留稳定选择 |
| 复制地址 | 名字精确/不区分大小写前缀优先于UUID；复用原解析核对目标，Codex超20条原选择范围禁y，保留Y |
| 表单核验 | 权威字段增加/消失拒写并保留输入，枚举选项变化不得静默换目标，零行i详情可完整复制 |
| 原生隔离 | 显式HOME同时绑定Codex proxy与Desktop SQLite目录，移除大小写变体的外部SQLite覆盖；默认环境行为保持 |
| 身份读取 | 固定argv的异步OS身份读取、有界输出/超时、派生Abort owner，不阻塞输入、不生成机器身份 |
| 跨工具冲突 | 其他Provider返回null且partial/unavailable/cancelled时拒绝收编，只有完整缺席能排除同ID冲突 |
| 启动目标 | 另一星名称遮蔽完整starId时拒绝自动拉起，原CLI的名字优先规则保持 |
| 超时释放 | 原生核验独立signal在超时/finally中abort，parent保留，未决请求不累积 |
| 结果真实性 | attach仅发一次并只读核对星册；精确删除内存已变而落盘失败回PERSIST_FAILED并显示uncertain，不误报成功 |

检查点：`8a4bbb2/72611e0`资源/筛选/UI；`60042d7/542f54b`读取失败；`96d2624`原子删册与表单；`140185d`main接线；`26cc170/b475830/3e35350`应用身份核验；`7fd850c/cb909f8`地址；`a0f23f0/be65951/91ff1d5/c517fc7`原生HOME；`75b28fc/4804b25`最终失效路径。

## Windows真实终端

最终产品成功构建后运行`node test/helpers/tui-sessions-pty-validation.mjs`，三场通过；另运行`node test/helpers/tui-pty-validation.mjs`，原外壳三场通过。ConPTY是真实TTY子进程；来源、剪贴板及册位写入为注入的隔离fixture。

| 场景 | 核对结果 |
|---|---|
| 本机会话键盘 | ctx进入124会话，匿名cursor100，t/s/u动态筛选，第三工具完整raw详情、g/Y、零行i、r刷新完整引用稳定 |
| 精确册位表单 | 星枚举、默认取消；只有adopt/remove两次fake apply，完整Claude ref及star-full-B一致；详情快捷键不触发写入 |
| 窗口 | 112×30→24×12阻止隐藏字段编辑/提交，48×16↔112×30；实际resize事件及mutation计数核对 |
| 取消与异常 | pending读取Ctrl+C确实abort；正常退出0，受控异常退出1，不回显秘密错误原文 |
| 外壳回归 | 原键盘/粘贴/长详情与影响滚动、24×12防误写、无读取Ctrl+C退出、异常恢复全部通过 |

每场核对raw模式、resize/应用信号监听回到基线，恢复主屏、光标和括号粘贴。先用一次无业务Ink mount/unmount建立restore-cursor模块guard基线，再检查TUI不增加残留；不删除其他owner监听。

最终会话证据：`C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-sessions-validation-geKu2s/`，三场同名JSONL事件与`-pty.jsonl`原始终端日志。外壳证据：`C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-validation-Vmrmti/`。此前预跑目录不作为最终构建后的验收证据。

本轮未在macOS/Linux真实终端或真实原生会话上执行live操作；它们不在本次已完成的实测范围。

## 任务清理

已删除T07活动行、说明段落和已满足依赖，临时任务规格转为长期本机会话规格。续接/使用/API/协议和map入口同步，证据保留在本页及提交；其余活动任务继续保留且等待用户指令。全部子代理已停止写入，root统一提交；其他会话的README与研究草稿保持原状。
