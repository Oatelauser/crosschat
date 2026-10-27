# 启动器入星错误提示修复与验证

2026-10-23（Asia/Shanghai）。

## 用户要求与范围

用户反馈“入星 cloudstar（attach 自动，异常见日志）”无法区分正常提示与报错，要求正常时不显示该预告，失败时显示错误并给出具体日志文件路径。本次按该明确要求实施，不再重复确认。

本次只调整入星诊断。最初报告的同目录多开、`--rm` 现场现象和 skill 安全规则没有在本次修改中宣称修复。

## 当前行为

- Claude、Codex、OpenCode 共用的启动器不再打印正常入星预告；真实异工具同名预警保留。
- 入星失败统一向 stderr 输出具体原因、已知错误码、适用星名和实际 `launcher.log` 的完整路径，同一错误写入该日志。覆盖配置读取、星选择、会话探测超时、聚合器启动、接任校验、attach 拒绝和后台异常。
- 实际日志写入器会创建缺失的目录；若无法写入，终端保留原错误并明确说明“日志写入失败”及路径，不声称日志已保存。
- 成功确认及重连仍只写日志；成功日志故障不使已入星会话断开或误报失败。原生会话、永久/临时册位、退出清理与其他星的生命周期保持原规则。
- 当前使用和验证说明已同步到 [broker.md](../broker.md)。历史票据和验收证据保留原状。

## 验证

- RED：`npm test -- test/session-star-logging.test.ts`，新增两项均失败，分别暴露错误未给出实际日志路径、日志不可写时未报告写入失败。
- GREEN：`npm test -- test/session-star.test.ts test/session-star-logging.test.ts test/claude-wrapper.test.ts test/codex-wrapper.test.ts test/opencode-wrapper.test.ts`，5 个文件通过，56 项通过、2 项原有跳过。
- 最终 `npm run check` 退出 0：lint、运行时依赖图、TypeScript 构建和全量 Vitest 通过。201 个文件通过、3 个原有跳过；2093 项通过、11 项原有跳过。依赖图 184 模块、584 边，无循环或越界。
- 独立只读审查未发现阻断本次范围的问题。

测试使用隔离目录、注入的原生扫描及受控本机 broker/NodeClient。实际日志测试把 home 绑定到私有临时目录，验证了首次创建、真实错误落盘和不可写路径；普通检查清除了 `CROSSCHAT_LIVE`。没有启动真实原生会话、发送生产消息、读取生产凭据或连接远端。

本次更新仓库源码及本机构建，没有安装或发布 CLI，也没有升级远端 Linux 上的 crosschat。

后续同目录匿名并发修复、`--rm` 两种顺序回归与最终统一检查见 [2026-10-26 补充验证](claude-concurrent-launcher-validation-20261026.md)；不改变本记录当时的实施范围与验收结果。
