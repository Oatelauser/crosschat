# Desktop 工装进程快照竞态验证

2026-10-23。TUI 全量验收过程中，既有 `opencode-desktop-fixture.test.ts` 的真实 Windows 占用检查得到 `unknown`，原断言期望 `occupied`。该轮记录为 2033 通过、1 失败、11 既有跳过；单独运行原 suite 的 13 项全部通过。

原全量日志只保留状态差异，没有保留 `inspection.error`，因此不能断言原失败一定来自下面的具体错误，也没有据此笼统增加超时或 retry。

## 确定可复现的机制

既有 helper 读取整机 CIM 快照，并对每个包含 Windows 8.3 短路径的可执行路径进行 `realpath`。其他隔离工装的临时进程可能在采样之后退出并删除程序文件；此时即使其路径不在本工装 root 内，`ENOENT` 也会把整次检查降为 `unknown`。

受控原生探针启动两个独立临时 run：owned-run 中 `ping.exe` 保持运行，other-run 中短路径临时 exe 被实际 CIM 采样后退出并删除。仅在内存包裹同源 helper 的 OS 边界观测，无全局进程终止和业务修改。修复前结果：

```text
transientOutsideOwnedRoot: true
ownedStillAlive: true
state: unknown
error: ENOENT ... realpath ...other-run/unrelated.exe
```

该机制与并行临时 exe 生命周期相符，已得到确定复现；原全量的唯一具体错误仍受上述日志限制约束。

## 最小修复

只改测试 helper 的路径解析失败分支：遇到 `ENOENT` 时，对快照中的确切 PID 执行零信号存活检查。只有明确的 `ESRCH` 才忽略已退出的过期行；PID 仍存在、权限拒绝、其他未知错误和其他文件错误都保留 `unknown`。没有增加查询重试，没有将未知状态视为安全清理，也没有放宽原真实 `occupied/clear` 断言。

独立三项 OS 边界回归先以 `8dfffc8` 保存 RED，再修改 helper：已退出短路径行可忽略；仍存活但缺少路径保持 unknown；存活核查遭 EPERM 保持 unknown。测试断言只发送零信号、CIM 只读取一次。

## 复验

- `npm test -- test/opencode-desktop-fixture.test.ts test/opencode-desktop-process-race.test.ts`：2 个文件、16 项通过，退出 0。
- 对应 helper 和新测试 ESLint：退出 0。
- 同一受控原生快照探针在修复后：`ENOENT` 仍实际发生，owned 进程仍活，结果正确为 `occupied`，且列表包含该确切 owned PID。所有自有进程退出、已验证临时根移除。

本项只修测试工装；产品源、原工作区、真实远端和安装环境均未修改。整体并行验收以 root 后续统一检查为准。
