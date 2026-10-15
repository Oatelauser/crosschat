# StarJoiner.stop() 重连窗口挂起竞态

label: wayfinder:design
status: closed
blocked-by: （无——随 1.6.2 发版前修复，用户 2026-10-15 拍板"修完再发"）
claimed-by: （主会话自领）

## Question

021 实施时发现（预存形状，018 批二引入）：`StarJoiner.stop()` 若落在聚合器**重连窗口**（pipes 映射暂空、superviseStar 在 sleep 重试循环里），重连完成后 superviseStar 在新管道 `waitClose()` 上永等——`stop()` 等全部 supervise settle → 启动器退出挂起（`crosschat claude` 子进程退出后包装器进程不退）。

## 方案

stop 信号与等待点 race：`stop()` 置 stopped 时 resolve 一个 stopped promise；superviseStar 内所有长等待点（`pipe.waitClose()` 与重连 sleep）与其 `Promise.race`，stopped 即收线返回——stop() 不再依赖管道自然关闭才能 settle。

## 预算与停止条件

- S 票 ≤80 行（含测试）
- 停止条件：npm run check 全绿；新增测试——stop 落在重连窗口限时返回不挂起；既有 021 断连静默测试零回归

## Resolution

**2026-10-15 实施关票**（主会话自领直修：~25 行 + 回归测试）。`stoppedSignal` promise 构造器创建、`stop()` 首行 resolve；superviseStar 唯一无界等待点 `pipe.waitClose()` 改 `Promise.race([pipe.waitClose(), this.stoppedSignal])`——重连循环其余等待点（ensureAggregator 8-30s 重试、1s sleep）本就有界且循环头检查 stopped。回归测试：杀聚合器→工装自动拉回→stop 落重连窗口 5s 限时断言（修复前该路径在新健康管道上永等）。check 717 全绿。随 1.6.2。
