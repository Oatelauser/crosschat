# C22 增强托管候选：2026-11-06

2026-11-08整理：用户第二次选择A的范围已履行，[PR #6合入及main普通CI](evidence/c22-merge-20261106/review.md)通过，main为cba0e71。[一次原生四目标42152027504](evidence/c22-native-hosted-20261106/review.md)已结束：Linux11/11通过并移出活动；Windows、macOS Intel/ARM各9/11后在终端表单就绪处失败，四目标资源均正常回收。修复代码fa34b22已本地完成，3项RED/GREEN、36定向、Windows正式11项与完整2909通过/11原有跳过已验，见[修复候选](dsh-enhancement-terminal-readiness-20261106.md)。修复分支未推送，托管修复/另三目标仍保留；未再触发原生Actions、未改定时或发布。下一外部步骤为具体修复分支推送/草稿PR及普通CI决定，旧授权不重复询问。25父项/11CI索引及原负责人保持。

以下为初始候选及当时外部决定的历史快照，原始证据保留；后续合入、首验失败和修复以上述记录为准。

2026-11-06用户选择A后已完成：候选ae99b50推送、[草稿PR #6](https://github.com/Oatelauser/crosschat/pull/6)创建、[普通CI42150057110](https://github.com/Oatelauser/crosschat/actions/runs/42150057110)三job实际success（Windows2906/11，Ubuntu与macOS2901/16）。源head/测试合并对象双亲和原始日志已核对，见[外部结果](evidence/c22-hosted-20261106/review.md)。推送/草稿/普通CI授权已履行，不重复询问；PR保持draft，main7229efb未改，合入和原生四目标Actions仍待单独决定，增强托管原生/其它平台/Desktop/物理跨机未追认。


当前本地候选已实现；没有推送、PR、新原生 Actions、合入或定时变更。旧的通信和从零 workflow、src/integrations 与产品命令均未改。用户已允许按任务分工，本轮由主会话实现 runner 和集成，两名 subagent 实现报告合同、平台接缝及交叉审查。

## 候选行为

- 新增独立 `.github/workflows/dsh-enhancement.yml`，仅 `workflow_dispatch`，四目标为 Windows x64、Linux x64、macOS Intel、macOS ARM；固定 Node 22.23.4、POSIX Python 3.12 和安装前真实 PTY 自检。只读权限，矩阵不 fail-fast，不自动取消旧运行；每格单独 always 上传 evidence，保留21天。
- 新 runner `scripts/dsh-enhancement-ci.mjs` 固定官方 Harness **0.2.1-rc.5** 与 pnpm 11.28.5 的已留证 URL/SHA512 SRI，先验包再用既有 npm 隔离安装策略（20分钟预算、ignore-scripts）。不查询 latest、不套 rc.2 baseline、不自动重试，不生成兼容回归 Issue。
- 使用既有11项正式增强场景，单次运行创建新 UUID 并绑定完整 source commit、实际 OS/arch/Node/版本与 scope。只有完整有序检查、正常子进程退出和全部资源释放证明一致，才允许返回 passed 并移除自有安装根。报告缺失、错 run、异常进程、超时或释放不明均为 infrastructure，保留任务根。
- 两个逻辑节点仍读取各自原生 profile，测试 TCP 状态目录使用本轮自有 `root/n0`、`root/n1`；run/node/star 的96位摘要标签沿生产已有 attachLabel 接缝传入。启动前和启动后均验证四条真实管道隔离，POSIX 路径最多103 UTF-8字节。不更改生产管道命名，也不创建新的用户运行时数据账本。
- POSIX 终端除应用 raw/listener 恢复、进程退出码外，还必须提交真实 host 的 `cleanup.groupReleased=true / forced=false`。缺失或曾强停不得通过；Windows不伪造该字段。

## 本地证据

1. [RED/GREEN与总证据](evidence/c22-dsh-hosted-candidate-20261106/validation.json)。初始缺接口 RED 为新合同/runner/平台入口的编译失败；另有实际嵌套路径预算 RED 和 POSIX 强停误通过的运行断言 RED。提交链 `890aa81 → 3bbe965 → 0f61b95 → 5ff8b33 → 14d2c2f` 保留，不将工装失败当产品回归。
2. [33项最终定向](evidence/c22-dsh-hosted-candidate-20261106/final-targeted-green.txt)：fresh run与子进程、严格报告、路径预算及手动四目标工作流均通过。
3. [Windows正式 wrapper 结果](evidence/c22-dsh-hosted-candidate-20261106/local-native-first/attempt.json)：源 `0f61b95`、新 runId，11项正式npm/Web场景通过，两个独立Node/Host与两个ConPTY均自然释放，故障代理恢复/关闭、运行根删除通过。重用已验证保留的官方rc.5依赖，**没有重新下载/安装**；不能称本地已验证新 runner 完整安装生命周期。之后 `14d2c2f` 仅增加 POSIX 分支释放校验及其测试，Windows既有正式证据由最终合同再次核验，未冒充该提交的重新原生运行。
4. [最终全量](evidence/c22-dsh-hosted-candidate-20261106/final-full-check.txt) 使用固定 Node22.23.4、Vitest最多2 workers，退出0：2906通过/11原有跳过、246文件通过/3跳过；lint/imports/build通过。

同机逻辑node不计物理跨机；Windows正式wrapper通过不计Linux/macOS、正式Desktop、rc.2/其它版本或托管首验通过。scope仍不包含浏览器UI或真实模型智能。原C22增量第五轮临时目录已由用户删除，代理只读核实不存在；原始失败与审批拒绝保留，清理缺口已关闭。

## 下一步与外部决定

只读核实远端 main 仍为 `7229efb17cb047205eb79b9df15f27edd71f4231`，没有本分支远端引用。可审阅范围为当前分支相对该main的原C21/C22本地工装、证据和本次独立增强候选；没有产品源代码改动。

下一外部步骤需用户批准：推送 `codex/dsh-enhancement-validation-20261105`，创建针对main的草稿PR，并检查既有普通CI；不含合入、原生Actions或定时授权。

新手动workflow需要先进入默认分支才能接收 `workflow_dispatch`，不能承诺仅推送该新文件就能在分支独立首验。依据：[GitHub官方手动运行文档](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。草稿PR后再根据普通CI和用户决定处理main注册/四目标首轮；本轮不改既有workflow来绕过该条件，也不自动启用周更。C22托管验证及各平台父项仍开放，C00跨机范围与其它负责人不变。
