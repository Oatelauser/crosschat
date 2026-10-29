# C14-W06 检查与改动记录

2026-10-29（UTC+8）。branch `codex/core-refactor-pre-tui`，起 `6b4f03a0a5840efc3a520e7c42d4036afdcf9c4c`，止于本单独立本地新提交（未 amend/push，哈希见派单回执）。任务书 [W06-task.md](W06-task.md)，前置验收 [W05-final-review.md](W05-final-review.md)。

本单只改既有隔离测试的等待方式，不改产品行为：`src/**`、Vitest 配置、其它测试、W05 代码与历史证据、skill、总表/调度、原未跟踪 `docs/代码消息投递.md` 全部未动。root 那份被 `blocked by policy` 的 D 盘 W05 缓存日志不属本单，未触碰、未换机制重试。

## 改动

### 1. `test/tui-main-observations.test.ts`（首个 native environment case）

```diff
-      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
+      // The first render of a cold process loads contexts, ink and the composition; 1s is a load-sensitive default.
+      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce(), { timeout: 5000 });
       expect(mocks.discovery).toHaveBeenCalledWith({});
       expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ home: io.home, nativeEnvironment: 'inherit' }));
     } finally {
       io.signals.emit('SIGTERM'); await active;
       homeProbe.mockRestore(); syncBuiltinESMExports();
     }
-  });
+  }, 10_000);
```

保留：`mocks.discovery` 空参断言、`mocks.overview` 的 `home`/`nativeEnvironment: 'inherit'` 断言、`finally` 里的 SIGTERM、`active` 等待、`homedir` spy 与 `syncBuiltinESMExports` 还原。该文件其余两个 case 的 `waitFor` 与全部断言未改。无 sleep，未加 timeout 数值镜像断言。

### 2. `test/core-diagnostics.test.ts`（真实内置隔离子进程取消 case）

```diff
       controller.abort();
-      const outcome = await Promise.race([
-        settled,
-        new Promise<string>((resolve) => setTimeout(() => resolve('still waiting for blocking probe'), 500)),
-      ]);
-      expect(outcome).toBe('AbortError');
+      // The owner awaits taskkill /T /F and the probe exit before rejecting; the API promises no fixed latency.
+      expect(await settled).toBe('AbortError');
       expect(() => process.kill(probePid!, 0)).toThrow();
```

并在 case 收尾加 `}, 10_000);`（Vitest 默认 5s，改为 10s 总预算阻止无界挂起）。

保留：`AbortError` 语义断言、`process.kill(probePid!, 0)` 必须抛错（probe 确已死亡）、marker 就绪的有界轮询（3s）、`finally` 里对自有 probe 的 `kill` 与 `await settled`、临时目录 `rmSync`。未删断言、未 skip/retry、未把整包串行化。

## 检查

| 命令 | 结果 |
|---|---|
| `npx vitest run test/tui-main-observations.test.ts test/core-diagnostics.test.ts` | 12/12 通过（2 文件）；首例 1019ms，诊断取消例 670ms |
| `npx eslint test/core-diagnostics.test.ts test/tui-main-observations.test.ts` | 通过 |
| `npm run check`（本单唯一一次全量） | **退出 0**：lint、check:imports、tsc build 通过；**2503 通过 / 0 失败 / 11 跳过**（2514）；文件 230 通过 / 3 跳过。全量日志见 [W06-check-20261029.log](W06-check-20261029.log) |

全量里两例实测：TUI 首例 580ms（热进程），诊断取消例 911ms——后者超过旧的 500ms race 上限，正是 W05 那次失败的直接原因；去掉 race 后同一条 `AbortError` 断言照样成立。

负控制前后各跑一次同样两文件，恢复后均为 12/12。

## 负控制（自身未提交变更，用后已还原并核对字节）

| 控制 | 临时改动 | 结果 | 还原 |
|---|---|---|---|
| A 取消结果伪造成成功 | `settled = pending.then(() => 'resolved', () => 'resolved')` | 失败：`expected 'resolved' to be 'AbortError'`（`test/core-diagnostics.test.ts:133`） | `diff` 空，字节一致 |
| B 环境路径期望改错 | `nativeEnvironment: 'inherit'` → `'isolated'` | 失败于第 71 行 `mocks.overview` 断言，证明等待之后的三条断言确实执行 | `diff` 空，字节一致 |

两轮都未改产品取消语义或用户进程；控制 A 里 `finally` 仍按原有路径 `kill` 掉自有 probe。

## 进程与临时目录归属

- 备份与控制文件放仓库外 `/tmp/w06ctl`，用后删除。
- 控制后核查：无残留 `node.exe` 且命令行含 `setInterval` 的 probe 子进程；系统临时目录无 `crosschat-diagnostic-tree-*` 残留；测试自建根由各自 `afterEach`/`finally` 按绝对路径删除。
- 未创建 `D:/cc-own-*`，未启动真实 Codex 或原生用户会话，无安装/升级/卸载。

## 未决

- 本单范围内无未决项。两处等待仍受机器负载影响，只是不再以 1s / 500ms 作为语义上限；若将来全量复现超时，应先看是否为产品侧真实退化，而不是继续抬数字。
- 短柄/ref 恢复未实施（按派单排在本单检查收口之后）。
