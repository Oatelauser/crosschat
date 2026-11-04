# C04-I02：正式 Windows Desktop 安装包获取与校验

2026-10-30（UTC+8）。执行者 Claude cworker1；root为Codex Desktop「多工具适配」。用户现明确“开始下一个任务”，本单正式启用；收到root标明完整基线SHA的派单消息后直接执行，不要求旧聊天记忆。worker此前报告不能自行执行 /clear；root不追认上下文已经清空，本单仍提供完整独立续接包。

## 授权、基线与读取

仓库 D:/workspace/CC/multichat，branch codex/core-refactor-pre-tui。用户已恢复持续逐单开发；新增非skill功能文件或必需用户操作仍先决策。本单沿用现有功能文件，不新增源码文件、依赖、命令、用户持久状态或用户步骤。开发任务/证据允许新增。原未跟踪 docs/代码消息投递.md 不动不stage。

先读AGENTS.md、docs/development/code-standards.md、本单、docs/research/deepseek-harness-runtime-probe-20261023.md的固定Desktop元数据、scripts/dsh-compat-ci.mjs及其测试与baseline。开工/结束核对真实branch/HEAD/dirty。并行无关提交只核对祖先及白名单，不checkout/pull/reset/clean/stash/amend/push，不回退共享文件归责；显式路径提交，不夹带其它index。

## 本单结果

给后续真实Desktop安装器提供直接可调用的「官方元数据投影 + 流式下载并校验」组件。现有模块已拥有Harness发行物、网络与CI编排职责；本单在其中独立实现Desktop分支，保留Web默认main、npm/packageManager元数据和现有报告/reporter合同。不是新增报告协议，不扩成安装器或UI driver。

白名单仅：

- scripts/dsh-compat-ci.mjs
- scripts/dsh-compat-baseline.json
- test/dsh-compat-ci.test.ts
- 本目录新增 I02-review-input.md、I02-check.txt

其它helper/workflow/package/skill/指南/调度/总表/root审查与旧日志不动。确需新功能路径先说明职责和必要性，不能把无关driver塞进现有模块规避审批。

## 保证

1. 在现有baseline增加独立desktopWindows节，来源为上述固定研究记录：feed https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml；version 0.2.1-rc.2；url https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe；size 289385456；sha512 39POl5osl9PKMqrPXQA52dh/bCV0Z02vOV9cTjOJDHE6gsJwp5bv7lfgB3mVWAKspX7a/w1iTi+8Listdhq45g==。不重新解释可变feed，不自造YAML解析器。旧package/packageManager内容保持。
2. 元数据先按unknown检查：明确Windows x64、字符串版本与已批准>=0.2.1-rc.2 <0.3.0-0窗口；官方HTTPS精确版本化路径（不能latest、query/fragment/凭据、其它主机）；size为正安全整数且<=512MiB；sha512为规范64字节base64。输出供现有Desktop artifact上下文使用的version/url/size/integrity及明确filename；不把Web包当Desktop包。下载公开边界不能跳过这些校验。
3. 流式获取并增量算SHA-512，限制总期限与最多预期size字节，不先Buffer.concat整包。拒绝重定向/非成功响应/无body；Content-Length可缺省，存在时须严格十进制且等于固定size。最终实际字节数和摘要都一致才返回已验证文件路径/身份；记录只证明传输字节与固定元数据一致，不等于Authenticode发布者、安装或Desktop功能已验证。
4. 下载目标由调用方提供本次独占的绝对真实目录；无用户目录/cache/系统TEMP默认值，不自动建全局缓存或状态文件。文件名来自校验过的固定元数据，wx创建，不覆盖原文件。写入/读取/摘要/超时/取消失败都释放自己拥有的body reader、文件句柄、timer/listener，只清本次成功创建的未完成文件；原有文件EEXIST时字节不变。清理失败如实附加报告路径与原因，不替换原始下载错误。
5. 接受AbortSignal或等效明确取消接口；截止覆盖响应头与完整body，取消/超时不返回可安装路径。不盲重试、不跟随URL降级，不启动安装包。允许很小的fetch依赖注入做测试，不建通用下载框架。
6. 本单不接Web main或Actions，不下载/安装/升级/卸载真实工具，不启动Desktop/Host/daemon，不写注册表、协议、用户skill/config/auth，不真实试发/调用模型。实际官方二进制获取留到独立后续步骤；本轮不得声称已验证官方二进制或C04通过。

## 验证与清理

按现有npm/Vitest做业务RED→最小GREEN。新导出缺失本身不算业务RED；可有最小显式占位使业务期望实际失败，GREEN删除占位并在报告说明。无需大规模控制矩阵或覆盖率门槛。

隔离测试至少覆盖：合法固定元数据与拒绝伪装/错类型/窗口/URL/大小/摘要；成功分块写入（字节一致）及无Content-Length成功；错误Content-Length、超量/截断、错摘要、重定向/HTTP错误；响应头或body等待超时及外部取消；已有文件不覆盖；失败后部分文件删除、连接/句柄释放。使用受控网络响应、独占临时目录；不依赖真实外网，不生模型/原生工具进程。保留现有Web/Desktop回归，baseline新节不改变Web默认路径。

合成fixture沿既有系统TEMP策略且用后清理；真实软件缓存遵守用户D盘测试根约定，但本单不做真实下载，也不重建已消失旧测试总根，不重试任何历史blocked-by-policy删除。

先定向本套件及直接受影响回归、node --check、ESLint/build，再一次完整npm run check；forks/threads max2/min1，完整stdout/stderr与真实退出码落I02-check.txt，不过滤、覆写首败、加skip或放宽既有语义。通过后不无理由重跑全量。保存RED/GREEN/证据本地commit。测试临时资源由本次owner清理，禁止扫描/终止用户进程。

## 回报与路由

交付报告给出真实起止基线/RED/GREEN、API与输出、保证→反例及结果、完整check及首败、文件、未测与资源清理。明确没有真实下载/安装/UI/托管证据；不关闭C04，不自行领取下一单或轮询。

固定仓库node dist/cli.js send，正文stdin、保留本条程序typed hint的conversation/tool、显式--delivery steer回传；不要Claude ListAgents/SendMessage。仅遇明确路由失败后才按repo crosschat skill核实root「多工具适配」/codex-desktop接续；queued/parked/unconfirmed不盲重发。收到正式派单后直接执行，无需纯确认；完成停写等双轴复审。

