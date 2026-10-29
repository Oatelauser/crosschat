# C14-W01 首轮审计与 R1 任务

root 审计固定范围 `3aac1c7489efca699d8e6a6dbe83e7aad1673c4c...68782c5f5e8867fd3b6a7b6f571daea05364f9b6`，唯一 worker 提交为 `68782c5`。原任务书继续有效；本单仍为研究和最小探针，不接产品 Provider。worker 已部分交付并停写，root 在返修派出前持有 index。

## Spec

1. **P1：默认环境过滤的关键结论与固定源码相反。** 报告第 1.1 节、路线 A/C 和探针 `defaultExcluded` 把模式存在当作默认生效。固定 commit `83086188ae0614bd882818ff1aa23f3194962012` 的 `protocol/src/config_types.rs` 中 Default 及 `config/src/shell_environment_policy.rs:136` 的配置转换都使 `ignore_default_excludes` 默认为 true；`protocol/src/shell_environment.rs:139` 只有在该值为 false 时才套用 KEY/SECRET/TOKEN 过滤。`include_only` 只是保留已有变量，不能恢复被排除者；`set` 位于过滤之后。root 与独立 Spec 审计分别确认。必须撤回“TOKEN 默认到不了 shell，因此该路线必须修改用户配置”的否决；重新评估桥、共享 daemon 与会话快照的真实继承边界，不能反过来声称凭据必然可达。
2. **P1：下一单拟将候选进程形状直接升级为来源证明。** `classifyEntry` 查找最近的“已识别形状”，会越过更近的未知 Codex 执行体。root 以隔离合成表重放 `probe → pwsh → D:/portable/codex.exe → pwsh → 已知 Desktop bundle → ChatGPT`，实际返回 desktop，而真正更近的执行体并未识别。不得跨过这类边界推定较远来源。报告拟将形状、父进程及环境中的 thread 相交后直接给 verified，但若“本次 thread”也来自同一环境，尚未给出独立的当前 call → 执行实例关联。须区分原生观测、候选入口、已核实关联及仍需研究条件，不批准直接移植进生产。
3. **P2：实例指纹声称超出探针实现。** root 合成表将 Codex 和父应用的创建时间设为 0，仍返回 desktop；解析还接受不可用或非有限时间。路径摘要只是路径字符串的摘要，未与可信参考核对，也没有采样后的存活/代次重核。修正“防同名替身”“逐次三元组验证已经实现”等声称。关键实例元数据不完整不能升级为已核实候选；同时保留原始事实供诊断。
4. **P2：IPC 排除结论过强。** 一次 initialize 只返回 clientId，支持“本次响应未暴露 PID”，不足以证明全部 IPC/OS 连接关联都不可能，更不足以断言只有上游新增字段才能解决。收窄为已观察能力缺口和未核实路线，保留私有接口及维护成本说明；本单不要求研究所有内部接口或向上游发消息。

上述是研究/方案及探针缺口；本单未改 `src/**`，不表示当前生产 Provider 已按这些规则误分类。

## Standards

1. **P2：Linux 读取无界。** 新探针的 `/proc` 全量扫描不使用 timeoutMs，无条目/字节限制或取消，却统一报告 10 秒/4MiB。违反代码规范第 4/5 节。R1 采用最小范围：明确这是 Windows 研究探针，Linux/macOS 返回 platform-unsupported，移除未验证的 Linux 读取分支；不改变任何产品支持或三平台 CI 任务。
2. **P2：普通单测依赖宿主和 1ms 时序。** 新测试实际读取宿主完整进程表，靠 1ms 超时验证有界性，Linux 分支又不校验有效结果。按规范第 9 节改为注入读取器或受控自有子进程，分别验证超时、不可读和输出上限等相关失效；真实宿主采样只保留独立研究证据，不混入普通单测。
3. **证据格式补正。** `desktop-ipc-initialize.json` 首行有 `connected`，root 实际 JSON.parse 得 SyntaxError。保留原捕获字节（可另存 .txt），提供可解析的结构化记录及采集方法/限制，不把原样终端捕获伪称合法 JSON。

不要求新增无关抽象、覆盖率目标或大型探针框架。不可用状态的退出码合同要明确；结构化 unavailable 可以是诊断结果，但不得把退出 0 写成“探测成功”。

## root 独立验证与补证

- `git diff --check 3aac1c7...68782c5` 通过；定向 `npx vitest run test/codex-caller-source-probe.test.ts` 为 10/10。上述两个分类反例不在原测试中，已另外重放；未为已知需返修的树重复全量 check。
- root 在真实 Codex Desktop 的同一 thread 中分别执行两次普通 exec_command，均无自定义环境、login:false，探针退出 0。链均为 ChatGPT.exe 14368 → bundled codex.exe 24716 → pwsh → node；THREAD/SESSION 摘要保持一致，TOOL_CALL 摘要改变。保留原样脱敏 JSON 于 [W01-root-probe.json](W01-root-probe.json)。
- 该原生 runtime 的 `CODEX_VERSION` 与现有运行体 `--version` 一致，为 **0.165.0-alpha.1.2**；与报告固定源码 **0.163.0** 分开计。证据记录脚本 SHA256，不因后续返修覆盖原输出字段。
- 未做 IPC owner 对账、CLI shell、第二 thread、同 thread 双开、共享 daemon、Linux/macOS 实测；正向 Desktop 观察不能补齐这些场景。原 topology 文件没有保存 CLI shell 正向采样，报告须准确区分安装布局/版本观察、进程拓扑与真实 shell 证据。
- 本轮研究只运行已审读的只读探针、现有运行体 --version 及隔离 fixture；未安装、改用户配置、读原生聊天正文、启动其他用户会话或连接生产远端。研究探针未写真实状态；正常授权 crosschat 协作回报产生的状态写入另计。原未跟踪 `docs/代码消息投递.md` 保留。

## R1 执行要求

- 沿用原任务书及原文件白名单，可在其研究证据目录内补必要记录。root 的本审计、原生采样及调度表由 root 管理，不由 worker 修改。
- 先补能钉住上述实际缺口的 RED，再修探针及测试；保留原生采样与原始捕获的含义，不以修新字段改写旧证据。研究探针的 candidate 结论不得冒称 verified 来源。
- 修正环境策略的默认值及覆盖顺序，给固定源码的精确链接和定位；重新排列下一单候选，说明还缺什么可验证证据。无需在本单安装 CLI、共享 daemon、Hook 或接线 Provider 来补齐未测项。
- 在报告中引用 root 两次原生采样，标明版本差异、同 thread/独立调用的范围；IPC/CLI/双开等未验证项保留为未验证，不再声称只差一次 Desktop 采样即可升级。
- 执行对应定向 Vitest、脚本语法检查、ESLint 和最终 `npm run check`，报告实际命令/退出/数量与有意义的 RED/GREEN。只提交本单文件，独立本地 commit，不 amend/push，核对 branch/HEAD，按归属清理临时进程和目录，完成即停写。
- 正式 R1 派单消息给出新 root 基线 SHA 与完整 typed 回信 ref；一致即可直接开工，不再额外握手或空等。

结论：**W01 尚未验收，转 R1；C14 及原工具/CI 总计划保持未完成。** 不因研究错误临时更改用户命令、投递行为、来源人工确认政策或平台支持。
