# C14-W00：提交基线前 doctor 测试隔离修复

2026-10-29（用户端时间）。root 分发并验收，执行者为本机 Claude 会话 `cworker1`。此单是 C14 本地提交基线的测试维护子单，不改 doctor 产品行为。

## 开始条件与文件范围

工作区 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，当前 HEAD `0a45bb9d9eaea961d5c2e2ad11f53f1fcb4ce3e5`。开始先回报真实目录、branch、HEAD 和其他正在写入的任务；匹配即可执行，不匹配则报告、不得自行 checkout。当前大量 dirty 为已有 C14 工作，必须保留。

只修改 `test/doctor.test.ts`；可只读 `src/application/diagnostics/deps.ts`、`checks.ts`、`render.ts`、`src/watchdog.ts`。不改 `src/**`、不读写真实 `.crosschat`、不停止真实 watchdog、不安装工具、不碰其他测试和文档。用户允许本地 commit、不 push；本单由 root 完成单独提交，worker 不 stage/commit，避免共用 index 竞争。

## 实际失败及方向

root 重新执行 `npm run check`：lint、202模块/677边检查、build通过；2415测试通过、11原有跳过、1失败。失败位于 `test/doctor.test.ts:206`，`reports parked outbox items as auto-drain pending` 期望“看门狗未运行”，实际得到“看门狗运行中”。

`makeDeps()` 声明全部探针已隔离，却未提供 `DoctorDeps.watchdogRunning` 和 `outboxDir`。`collectDoctorDiagnostics` 在存在 parked fixture 时回落真实 `defaultOutboxDir()/watchdogStatus()`，因此依赖宿主状态；展示的 mailbox 路径也落到用户目录。不得通过关闭宿主进程、删除 lockfile、放宽字符串断言或改生产默认逻辑修测试。

## 开发步骤与验收

1. 读 `AGENTS.md`、`docs/development/code-standards.md`，核实上述真实调用链与已有注入接口。
2. 在 `makeDeps` 内注入确定的 `watchdogRunning: () => ({ running: false })` 及平台正确的合成 outbox 路径，沿用已有 `join`，保留单例 override 能力。无需新建目录或访问文件。
3. 保留 parked 数量、非失败级别等已有断言。补一个明确注入 running=true 的行为用例，证明同一隔离接缝也能展示运行状态；对 mailbox 路径断言使用平台 `join` 而非 Windows 反斜杠硬编码。可用 spy 核实注入探针被调用，不镜像实现或删除失败测试。
4. 运行 `npm test -- test/doctor.test.ts`、`npx eslint test/doctor.test.ts`、`git diff --check -- test/doctor.test.ts`。root 统一跑最终 `npm run check`，worker 不并行 build 或启动全仓检查。既有 root 失败为 RED 证据，本单不得声称改动前已新增用例RED。
5. 完成后停止写入，清理自己的辅助文件/进程（预期本单无临时安装），把报告回发原聊天，显式收件 `--tool codex-desktop`，保留 conversation/ref。若已安装命令不支持新参数，可用仓库 `node dist/cli.js send`，不得因回执不明重复发送。

报告必须包括：`C14-W00`；仓库/branch/HEAD；修改文件及精确差异；根因与产品行为是否变化；实际检查命令/退出码/测试数量；未测或失败项；临时资源与清理；其他 dirty 不属于本单；明确“已停写，等待 root 审计提交”。不擅自开始 W01 或其他任务。
