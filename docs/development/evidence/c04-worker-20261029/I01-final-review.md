# C04-I01 离线 Desktop 工装核心最终验收

2026-10-30（UTC+8）。root「多工具适配」验收通过，仅关闭I01及其返修子单，C04父项继续未完成。当前worker停写；按用户最新约定，下一单先清空worker上下文，再以独立任务包下发。

## 验收范围与提交

本单交付独立Desktop报告核验、调用方身份绑定与串行生命周期编排：释放未获证明则保留本次已知安装归属并停止后续安装；部分安装、probe和remove失败如实保留原因。Web默认入口、载荷、返回结构和reporter保持。

起点 `7ecde0b139d8bafed3a0008eecdc14d8c3ccbae1`。首轮产品 `1125c90`、R1产品 `d406392`、R2产品 `807443d`，最终产品 **`8a5b61f930e7e4a8af3d6f5f11c74998ee28a78a`**；最终证据 **`00cdbff7f2e9ff4948b21c72357e90f647557e14`**。定向补充基线 `6121bad`、RED `62f260e`、GREEN `8a5b61f`。所有提交仅本地，未push。

原任务书及各轮复审保留为规格、批准范围和历史证据，不再作为活动派单：[初次复审](I01-review.md)、[R1复审与暂停事实](I01-R1-review.md)、[R2复审及定向补充](I01-R2-review.md)、[交付索引](I01-review-input.md)。

## Standards

独立审查通过，无新增发现；原P3错误上下文问题关闭。实现以独立threw标记区分没有异常与抛出undefined等假值，保留真实reason；五类假值、完整归属与停止顺序均有行为断言。正常返回而释放未知仍保留原文案，Web无归属投影，结构和文案保持。未发现需整改的结构问题。

## Spec

独立审查通过，无新增发现；原P2真实reason问题关闭。纯内存复核undefined、0、false、空字符串、null：retainedInstallation.reason和summary.error均为String(value)，身份保留且只执行install/probe。无异常保留原文案；remove假值回归属于同一保证，无越界扩展。此前UUID先验字符串、完整已知失败归属两项也已关闭。

两轴结果：Standards 0项未关闭，Spec 0项未关闭；均无剩余阻断。

## 验证证据

- worker最终一次完整 `npm run check` 退出0：**2565通过、11原有跳过；231文件通过、3跳过**。lint、203模块/682边依赖图、build通过；forks/threads均最多2、最少1，不筛测试、不增skip或放宽语义。完整输出与退出码见 [I01-R2-check.txt](I01-R2-check.txt) 追加部分。
- root在最终产品上独立运行 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`：**35/35通过**；语法检查、固定diff空白检查通过。未重复worker全量检查。
- root对比730e8b4与00cdbff内日志的Git对象字节：原43483字节完整作为现87276字节的前缀保留，追加未覆盖原成功记录。各轮旧原始日志/历史失败不改。
- 定向补充RED为1失败/34通过，真实断言为throw undefined原因丢失；GREEN35通过。root审查者另以无文件/进程注入验证五类假值与Web保留结构。

## 适用边界与下一步

报告合同为本仓库内部合同，字段对账仅证明与调用方记录一致，不抗伪造，也不证明真实Desktop已执行。正式发行物下载/校验、安装器、UI driver、Host自然退出、官方卸载及两类注册清理、干净runner与托管首轮仍未实现或未实测；不得用本次离线结果关闭C04。

Windows本机合成fixture验证，不宣称正式Host/Desktop或Linux/macOS已通过；报告读取边界中未单独动态复现的项目仍按原记录保留，不重开文件替换研究。未安装/启停原生工具、写用户状态/注册表、调用模型、真实试发或触发Actions。worker报告本次独占fixture已清；root复核工作区仅原未跟踪 `docs/代码消息投递.md`，未触碰。

下一项拟为 [C04-I02 安装包获取与校验](I02-task.md)，仅准备独立任务包，**尚未派发**。用户清空worker后，root重新核对真实基线并发出正式任务；不依赖旧聊天或旧角色记忆，通信继续遵守程序typed hint及明确失败后的恢复规则。
