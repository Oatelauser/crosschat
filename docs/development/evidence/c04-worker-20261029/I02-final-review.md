# C04-I02 安装包获取与校验组件最终验收

2026-11-02（UTC+8）。root「多工具适配」完成产品双轴复审、验证核对和归档，组件产品验收通过；一处合成fixture删除受自动审批阻断，按下文保留，不声称清理全部完成。I02及返修不再作为活动开发单；本轮停止，root/worker等待用户通知，不派下一项。C04父项未完成。

## 范围与提交

在既有scripts/dsh-compat-ci.mjs中提供独立Windows x64 Desktop元数据投影与流式下载校验；scripts/dsh-compat-baseline.json增加固定Desktop节。严格版本窗口、官方精确URL/文件名、字节上限及SHA-512校验；wx创建，不覆盖已有文件；短写、取消、截止及清理失败不返回可安装路径。成功仅证明传输字节与固定元数据一致。

初始基线`dc983f7f3711a113bdb6d62b2777dafbb2e5ee2b`。首轮产品c2a2e2f，后续4476f33、9699354、3c15675、9b72442；最终产品**33f9c05**，最终fixture修正**6648c91**，最终worker证据**219a35cda91f8ccf453151fb5cb61c2e48e6be4f**。均为本地提交，未push/amend。

本轮固定复审`c813d4e...238f582`（RED04ae24a、GREEN33f9c05、证据238f582）；收尾固定复审`238f582...219a35c`，后者没有产品改动。之前的规格、各轮RED/失败与复审均作历史证据保留，不再作活动派单：[交付索引](I02-review-input.md)、[R3复审与补充范围](I02-R3-review.md)。

## Standards

独立审查0项未决代码发现。迟到句柄使用独立lateFile状态，由一个owner执行close/remove；主收尾只消费结果，不再重复删除、虚报partial，替换文件字节受回归保护。迟到响应cancel未落定立即报告，最终释放reader锁。

补充复审发现的fixture和证据问题也已关闭：gate释放及收束等待移入finally，原行为断言保留；原摘要明确标注，新raw保留完整输出。临时翻转断言的预期失败日志包含GATE_RELEASED_IN_FINALLY，证明失败路径仍收尾，翻转和标记未留在源码。未另报结构smell。

## Spec

独立审查0项未决代码发现。收尾期间外部取消/总截止直到最终裁决都有效；有限共享收尾预算耗尽时，不重开预算交付。迟到响应“未到/取消未落定/已落定”分别处理；迟到文件成功收口不报残留，close/remove失败或未核实均可定位。假值/冻结异常沿cause链保留原始原因和必要报告。

root及Spec审查者重做纯内存门控：100ms总截止、响应150ms到达、cancel挂起，返回错误已带undecidedResources；释放gate后body.locked=false。原双删除反例及成功清理不虚报反例均通过。未发现范围扩张；Web默认入口、I01合同和原报告路径未改。

两轴分别计数：Standards 0项未关闭，Spec 0项未关闭；组件产品可验收。下列清理限制单独保留。

## 验证与证据边界

- root在219a35c上独立运行`npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`：**54/54通过**；产品语法、固定产品/测试diff空白检查通过。收尾无产品改动，没有再跑一次全量。
- worker最终完整npm run check退出0：**2584通过、11原有跳过；231文件通过、3跳过**，lint、203模块/682边依赖图、build通过。[原始记录](I02-R3-supplement-raw.txt)F段为finally修正后完整输出；C段为修正前同为2584/11的完整输出，两次均保留。worker自报forks/threads max2/min1，但raw未保存环境值，root不追认已独立验证其实际并发上限。
- raw同时保留RED 3失败/51通过、GREEN54/54、finally后定向和预期反证。E段失败是故意翻转测试断言，不计作产品首败；不得删除或将摘要冒充原始输出。
- I02-R3-supplement-check.txt为原人工摘要，字节未改；SHA-256为`b11842a5f1ee3aa7c31de739927116d061b2e3c73185c35424a599606d44216b`。新增raw SHA-256为`9973cb93ba15374b07e7e48a32cbfbe07a5dddf61c00ac38c3dc6a078a5d110ed`。更早输出只能按已存证据核对，不补造；旧日志的颜色控制符/尾空格原样保留，代码diff检查单列。

## 资源收尾与被拒删除

worker报告当轮注入、gate与句柄已恢复；root测试已退出，纯内存探针不产生文件/原生进程。工作树仅原未跟踪docs/代码消息投递.md，本轮未动未stage。root只按本任务fixture前缀查目录，不扫描/终止用户进程。

root另发现一处残留：`C:/Users/yangsheng/AppData/Local/Temp/crosschat-dsh-ci-test-ijFbEi/owned-desktop-download/deepseek-harness-0.2.1-rc.2-win-x64.exe`，创建时间2026-10-30T10:04:47Z。只读核对根和子目录无链接，目录仅有该文件；文件45字节，逐字节等于测试常量“controlled official desktop installer fixture”，并非真实安装包。

对该绝对目录的带父目录/前缀/链接/内容核验的PowerShell Remove-Item请求，被自动审批在执行前拒绝，返回仅为**blocked by policy**，未给更细理由。未换机制、未让worker代删或重试，复查文件仍在。此残留保留待用户后续决定，不记为已删除；先前历史D盘被拒清理也未触碰。

## 停止边界

本轮没有实际下载官方二进制、验证签名/发布者、安装或启动Desktop/Host、写注册表/协议/用户配置、调用模型、真实试发或触发Actions。正式获取、签名、安装器、UI driver、自然退出、官方卸载、两类注册清理、干净runner与托管首轮仍无本单验收证据；C04保持未完成。

按用户要求，产品验收及记录已收口，受阻清理如实留存；后续开发和下一功能任务等待用户明确通知。
