# C13-I01 桥关闭清理最终验收

2026-10-29（UTC+8）。root 验收通过。本记录收口 [R1 独立复审](I01-R1-review.md)中保留的共享全量待验项；不将 C13 父项或正式 Desktop 生命周期记为完成。

## Standards

独立复审通过。错误追加不能替代主错；不可写 cause、已有 cause 与多个清理原因均保留。测试 fixture 独立持有实际 server，产品 close 拒绝后仍能收口自己的监听。没有新增功能文件、命令或用户必需操作。

## Spec

独立复审通过。首次 close 在同一个 Promise 内逐项尝试 contributor、dependency scope、socket 与自己的登记清理；前项失败不再跳过后项，全部尝试后报告失败。mount 保留原始错误；仅删除本次排他创建的临时文件，EEXIST 不删除外来文件。不保证清理操作自身失败时所有资源仍已释放。

## 验证与集成证据

- 产品提交：`1112f828c879f3a907f9da0cfa50dd79033c3a71`、`4f8b6c28a7f0b9456319b99061f4494681d83e9e`；R1 实际父为 `63eae9f`。
- root 已独立运行语法检查及 5 个定向套件，共 **80 通过**，明细见 R1 复审。
- Bug修复2 提供已完成的整仓 `npm run check`：验证提交 `303e7cecfe47a67ae296eb01dee4923cc32756ab`，退出 0；**2527 通过 / 11 原有跳过，231 文件通过 / 3 跳过**；lint、203 模块 / 681 边依赖图、构建通过。
- root 以 `git merge-base --is-ancestor` 核对 R1 在该验证提交的祖先链内；查验原始日志包含 bridge 32 项、caller-source-providers 14 项及完整汇总。验证提交之后至 I02 提交仅文档/证据变化。
- 全量执行者为 Bug修复2，root 没有冒称独立重跑。执行时 `VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`；未筛测试、放宽断言或新增 skip。本结果不证明默认无限定并发也通过。

共享原始日志为 [final-check.txt](../c14-short-handle-ring-20261029/final-check.txt)，结构结果为 [result.json](../c14-short-handle-ring-20261029/result.json)。root 核对 Windows 工作副本 SHA-256 为 `43f80ccc4353949bcb0cfd0731a8f20280cda43703a61205087dd73e65c2b903`，Git 规范化 LF blob 为 `1629c155c89c93c9386288870dc9ed3f964a07d65ac6cf4f66a2480859ec323c`，均与结构记录一致。

I01 两次完整检查首败仍保留为 `I01-check.txt`、`I01-R1-check.txt`；旧 P01 两份原始 JSON 未替换。不用后续通过抹去失败或扩大原生证据。

## 适用边界

Windows 本机合成 ctx/host 与受控普通回归；不是正式 Harness/Desktop 进程内重放。正式 Desktop、跨进程关闭、外部临时文件替换竞态及极端 Proxy/getter Error 未验；C04 与后续 CI 继续保留。I01 从活动子单移除，C13 生命周期文档另由 I02 收口。
