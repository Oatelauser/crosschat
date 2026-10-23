# macOS CI修复与验收

2026-10-23（Asia/Shanghai）。用户要求修复并解释1.11.0发布时macOS观察位的三项失败。本轮基于`v1.11.0`（`06eb77b`），工作区`D:/workspace/CC/multichat-fix-macos-ci`，分支`codex/fix-macos-ci`；原工作区并行进行的OpenCode改动未纳入本轮。

## 根因与范围

| 原失败 | 已执行的根因证据 | 修复范围 |
|---|---|---|
| session-star双星attach未全部生效 | 真实macOS诊断中，两路径均118字节、前103字节相同；第一星监听成功，第二星`EADDRINUSE` | 仅macOS测试夹具改用`realpathSync('/tmp')`下私有目录，并在启动前检查Unix路径预算；双星测试在finally停止joiner |
| revocation-pause撤权后邻星额外spawn | 真实macOS诊断alpha路径115字节、beta114字节、前103字节相同；同样第二星监听`EADDRINUSE` | 同一测试根路径修复，原标签、撤权/邻星断言及等待预算保持 |
| owned-stop超时回执时scanner仍存在 | 原macOS CI在回执后立刻`kill(pid,0)`为true；真实POSIX压力20轮6次复现，同PGID且状态Z，100ms后消失 | 修复自有辅助进程组的完成条件；Windows taskkill和外部服务停止业务保持 |

libuv明确记录Unix管道路径可能被截断，见[官方pipe文档](https://docs.libuv.org/en/v1.x/pipe.html)。前两项由过长测试路径引出，未修改产品IPC命名/协议；实际部署仍须遵守操作系统路径限制，本轮不扩展长路径能力。

第三项中，旧实现向整个POSIX组发送SIGKILL后，只等待owner退出；owner退出不能证明后代已完成系统回收。新回归要求成功回执、取消、超时和无回执退出均核实自有组，清理失败不能冒充已释放。只探测固定PGID，不扫描或结束外部服务；原CLI、目标PID选择、写后不明回执语义不变。

## RED/GREEN反馈

- 原发布CI：[`39885389684`](https://github.com/Oatelauser/crosschat/actions/runs/39885389684)，macOS job`120192257716`为3项失败及2个后续异步错误；Windows/Ubuntu通过。
- 本轮诊断RED：`431590c`，真实macOS运行[`39887356717`](https://github.com/Oatelauser/crosschat/actions/runs/39887356717)。仅跑原两星失败目标，均失败并记录路径字节和真实监听错误；另5次owned-stop单独运行通过，记录其竞态性质，不拿单次通过否定原失败。
- socket夹具GREEN：`539dbf1`，本机38项定向通过、ESLint通过；真实macOS运行[`39887974090`](https://github.com/Oatelauser/crosschat/actions/runs/39887974090)两原失败目标及5次owned-stop检查均通过。
- 进程组稳定RED：`9352a0b`，`npx vitest run --dir test test/local-service-owned-process.test.ts`实际执行7项，7项按预期失败。可控OS边界覆盖延迟组消失、持续存在、EPERM/EIO、缺退出事件、owner已退出后的组身份与无回执错误；没有真实PID信号。原真实fork/scanner回归保留回执当刻的存活断言。
- 进程组GREEN：`9d5de25`，相同7项全部通过；连同`local-service-owned-stop`及`local-service-inspection`共3文件19项通过。原真实POSIX fork→execFileSync扫描子进程压力20轮由6次回执后残留变为0次；Windows taskkill参数、成功判据与等待保持。
- 真实macOS修复复核：[`39888687928`](https://github.com/Oatelauser/crosschat/actions/runs/39888687928)全部步骤通过：两原socket目标、3文件19项进程回归，以及原真实扫描超时目标连续5次通过。不是仅用可控OS边界用例代替实际进程验收。
- 本机`npm run check`退出0：151文件通过/3既有跳过，1664项通过/11既有跳过；运行时依赖图与lint/build通过。完整输出在本工作区忽略的`macos-fix-check-20261023.log`。新增7项不增加新的跳过项。

## 进程组完成边界

- owner仍存活时只向固定PGID发送一次SIGKILL，之后仅用signal0探测；只有ESRCH表示消失，EPERM/EIO等返回cleanup失败。
- owner退出与组消失共用约1秒清理预算，缺退出事件或组持续存在均有界失败；临时exit listener在finally释放，轮询不留下timer。
- owner已经意外退出时不向可能失去身份锚点的旧PGID再次发杀信号；组仍存在则保守返回cleanup，组已消失则保留原无回执错误。新测试验证“不再发杀信号”，不冒称复现了真实PGID重新分配。
- cleanup失败覆盖先前结果/超时，避免宣称进程树已释放；停止外部服务的信号不回滚，不改CLI、目标PID选择、Provider或管理协议。

## 当前验证状态

定向真实macOS和本机全量检查已通过；标准三平台CI待PR触发后记录最终结果。临时macOS复现工作流和一次性ps诊断已移除；既有CI矩阵及macOS观察位策略保持。验收记录保留，完成后不创建或保留活动任务队列。
