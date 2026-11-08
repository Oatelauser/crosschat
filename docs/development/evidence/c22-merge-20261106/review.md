# PR #6 合入与 main 普通 CI

2026-11-06执行，2026-11-08完成证据整理。用户第二次选择A，批准PR #6转ready、合入、等待main普通CI，随后运行一次四目标原生增强workflow。

- [PR #6](https://github.com/Oatelauser/crosschat/pull/6) 已转ready并合入。固定候选为 `ae99b507b2ab16075eef42ce3b73b3e044d78d3a`；[merged.json](merged.json) 独立核对PR的closed/merged、main ref、提交双亲及tree，不依赖缺失的API `merge_commit_sha`。
- 合入提交 `cba0e71133ae6d4c47af8dba0068ca03c939f679`，双亲为原main `7229efb17cb047205eb79b9df15f27edd71f4231` 与上述候选。tree `c1e8a2f182c9e49349242a10b14973872f8001a8` 与候选一致。
- [main普通CI 42151469051](https://github.com/Oatelauser/crosschat/actions/runs/42151469051) 为该合入提交的push事件、attempt 1，三个job逐一completed/success；macOS也核对了实际job结论。

| Job | 平台 | 通过/原有跳过 |
| --- | --- | --- |
| 127675463005 | Ubuntu | 2901/16 |
| 127675463241 | macOS | 2901/16 |
| 127675463355 | Windows | 2906/11 |

三份 `job-*.txt` 保留实际checkout、Node22.23.4、lint/build、206模块/699边无环无越界及246文件通过/3跳过的原始记录。[main-run.json](main-run.json)、[main-jobs.json](main-jobs.json) 保留完整回执。此前草稿普通CI42150057110的证据不被本次覆盖。

已批准的一次原生运行结果另见[首轮四目标报告](../c22-native-hosted-20261106/review.md)。没有发布或新增定时；这次合入授权不自动扩展到后续修复分支。
