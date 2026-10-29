# C13-I01-R1 独立复审与集成状态

2026-10-29（UTC+8）。**桥清理实现及定向行为/规范复审通过；共享全量仍未通过，I01 暂留集成待验，不作整仓验收或 C13 完成声明。** 独立文档收口可继续，不阻塞对方短柄线。

## 固定范围

I01 产品首交付 `1112f828c879f3a907f9da0cfa50dd79033c3a71`，父 `b1d7a4d`；R1 产品交付 `4f8b6c28a7f0b9456319b99061f4494681d83e9e`，实际父 `63eae9f`（worker回报所称父 `9816b45` 是其写作时观察，并非提交实际父；此处以 Git 对象为准）。并行短柄提交不计入本单 worker diff。只修改既有 bridge.js、既有 dsh-bridge.test.ts 和本单检查证据；没有新增功能文件或改变用户操作。

## Standards

独立 agent 复审通过，原两项 P2 收口。`withCleanup` 无法追加 cause 时安全聚合，保留原错误、已有 cause 和全部清理原因。fixture 用 node:http mock 持有实际 server，逐项尝试 effects 后独立关闭 listener，并检查残留；不再依赖已拒绝的产品关闭 Promise 收尾。worker 保存受控旧产品 RED 与开关取消后的实际兜底观察，不把静态设计当执行证据。

## Spec

独立 agent 复审通过。temporaryOwned 仅在排他创建成功后置位，open/EEXIST 失败不会删除外来 tmp；原有实际落盘 tmp 在 link 失败后仍清理。首次关闭逐项尝试、同 Promise、插件/子scope边界、替换登记及借用 Agent 保护保持。只读 cause、已有 cause 和多项清理原因均有回归。

## root 验证

最终实现上 `node --check integrations/dsh/bridge.js` 通过；5个定向套件共 **80通过**：bridge32、providers14、confirmations21、service11、state-lock2。没有运行真实 Harness、用户配置、模型或消息投递，没有修改共享产品文件归责。

R1 完整 check 首败保留在 I01-R1-check.txt：4失败/2523通过/11跳过。具体为 dsh-send 仍期待旧 c数字格式、maintenance 两项保留/预览预期、core-code-standards 的5秒超时。root 当时看到另一个会话正在修改 dsh-send/maintenance 及信封文档，不据此认定其最终结果；该线归 Bug修复2。core-code-standards 隔离通过只说明有负载因素，不抹掉全量首次失败。

完整集成检查待对应线给出稳定树/窗口后收口，届时不需要再改桥或重复故障注入。旧 P01 两份证据及首轮 I01-check 保留，不用新通过替换旧失败记录。仅 Windows 合成 Host 回归，不外推正式 Desktop/三平台；外部进程替换 tmp、Proxy/异常getter等未覆盖边界仍如 worker 报告。

## 接续

用户已授权持续派单，不因普通实现细节再次询问。I02 仅在已有指南、合同、设计中写清现有手工生命周期及固定源码事实，不新增步骤/默认目标/功能文件；新自动安装、默认目标、卸载联动等仍须用户决定。通信短柄线不重新领取。I01 集成项继续记录，不能随派新单静默当作已通过。
