# C04-I01 独立审查

2026-10-29（UTC+8）。固定范围 `7ecde0b..5d4ba3b`，RED `b906c45`、GREEN `1125c90`。四个变更文件均在白名单内。**尚未验收，下面直接缺口合并为 R1，不接真实 Desktop runner。**

## Standards

1. P2，`scripts/dsh-compat-ci.mjs:144`：发行物身份只做相等比较，未先验证必需值。`artifact.integrity` 与 `report.artifactId` 同时缺失时仍可 PASS。独占 fixture 已复现。违反代码规范 §4“验证所需字段”；本单只需校验内部绑定值，不需要提前实现下载器。
2. P2，`:177`：新 Desktop 报告直接整文件读取、解析，无字节预算。独占 fixture 中 8,389,881 字节的合法 JSON 仍 PASS。违反本单有界读取要求；应在解析前控制预算，超限失败并保持释放未知，不顺带扩大旧 Web 读取整改。

未发现需另行返修的结构 smell；共用串行循环服务两个现有入口，没有扩成平台框架。普通 probe/remove 抛错会停止后续并保留已取得的安装归属。

## Spec

1. P1，`:145–156,249`：instanceId/sessionId 只查格式，期望仅含 installationId/owner；sequence 不绑定本次 runId。违反任务产出1“绑定本次”和产出2“同一安装/原生实例与具体会话”。root 和 Spec 独立反例均观察到：传入与调用方期望不同但格式合法的实例/会话，attempt 仍 PASS；sequence 复用同一合法报告运行 ID，仍推进候选并 compatible。需建立独立调用方上下文并比较，不是要求防伪造。
2. P1，`:214,233`：install 已产生自有资源后抛错，仅留下字符串错误，已知部分安装归属丢失。即使受控 error 携带 installation，summary 仍无 retainedInstallation。违反产出3“保留本次归属”“抛错不绕过必要收口”。预先建立归属或明确结构化失败合同；释放未知仍不得盲卸载。
3. P2，`:175,181`：process 结果明确 `truncated:true` 仍 PASS，返回 process 还丢弃该事实；JSON 语法残缺的现有用例不能证明未截断要求已覆盖。违反产出1“未截断”。
4. P2，`:153`：删除整个 cleanup、保留六项 check，attempt 仍 PASS。sequence 随后会停止，但不能修正 attempt 已输出的错误 PASS。违反产出1“字段完整”及内部报告合同。

未发现越界实现；Web 默认入口、范围与 reporter 保持。不要求本轮实现下载、安装、UI 或任何原生事实证明。

## root 验证与处理

root 实际运行 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`，**23/23 通过**；语法与产品/测试 diff 空白检查通过。现有 GREEN 没覆盖上述反例。root 最小反例还确认 install 中途抛错后的 retainedInstallation 缺失；全部只是注入操作和临时 JSON，无原生工具或用户状态操作，临时根已核验并清理。

worker 一次完整check **2553通过/11原有跳过**、231文件通过/3跳过、203模块/682边、lint/build通过，真实退出0；[原始日志](I01-check.txt)保留，不重复或改写。两轴分别为 Standards 2项、Spec 4项，均需收口。R1只改原两个功能文件与新增开发证据，不新增功能文件、workflow、依赖或用户操作。
