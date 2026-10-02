# codex 0.160.0 `thread/inject_items` 开窗注入实测报告

- 日期：2026-10-02
- 环境：Windows 11 Pro for Workstations；CLI 0.160.0（npm 包装，真实二进制 `C:\Users\yangsheng\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`）
- 方法：隔离 CODEX_HOME（`D:\tmp\codex-inject\home`，已删）自管 daemon + 自建线程 + 隐藏 TUI 开窗 + WebSocket 双连接活体实验；全部 spawn 均剥离 `CLAUDE_CODE_MESSAGING_SOCKET/TOKEN/SESSION_ID`
- 用户 daemon（0.157.1，pid 15408）、用户线程、`~/.codex`：零接触（config.toml 只读复制过 token，未改动）

## 结论：✅ 可开窗注入且模型处理——但通道必须是 **daemon control socket 的 WebSocket**，不是自建 app-server 进程

写者锁在 0.160.0 的真实语义是**进程级 thread-store 锁**，不是连接级：

| 通道 | TUI 开窗时 resume | TUI 开窗时 inject_items | TUI 开窗时 turn/start |
|---|---|---|---|
| 经共享 daemon control socket（WS 第二连接，与 TUI 同一 app-server 进程） | ✅ 放行 | ✅ `{}` 成功、落 rollout、模型可见 | ✅ 接受，模型正常回 |
| 自建 app-server 进程（`codex exec resume`） | ❌ `thread-store conflict: already has an active writer` | —（进不去） | — |

**multichat 的"关窗约束"可以废除**：开窗线程照常 resume / inject / turn，消息会被模型处理。且 `thread/inject_items` 甚至不是必需的——第二连接直接 `turn/start` 携带输入即可完成"投递+处理"；inject 的独特价值是**追加历史不触发 turn**（schema 原话 *"without starting a user turn"*），适合"先补上下文再统一驱动"。

## 实验矩阵

1. **版本基线**：CLI 0.160.0。隔离 home 下 `daemon start` 自动安装 0.160.0 daemon 包并拉起（`managedCodexVersion: 0.160.0, appServerVersion: 0.160.0`）——CLI 与 daemon 能力一致；用户侧 daemon 仍是 0.157.1 管安装，**接入前需 `codex app-server daemon update`（或 stop+start）升级**。
2. **schema**：`ThreadInjectItemsParams = {threadId: string, items: any[]}`，描述 *"Raw Responses API items to append to the thread's model-visible history."*；方法描述 *"Append raw Responses API items to the thread history without starting a user turn."*；Response 为空对象。**无 writer/权限前置**。item 必须是合法 Responses API item（`type` 必填、`content` 必须序列）。
3. **核心 A（开窗注入）**：隐藏 TUI `codex resume X` 附着（rollout 出现 `thread_settings_applied`）→ 同 daemon WS 第二连接调 `thread/inject_items`：
   - v1 `{"type":"message","role":"user","content":[{"type":"input_text","text":"..."}]}` → `{}` 成功
   - v2 content 传字符串 → `items[0] is not a valid response item: invalid type: string ..., expected a sequence`
   - v3 缺 `type` → `items[0] is not a valid response item: missing field 'type'`
   - 注入项落 rollout（`response_item` role=user），**不自动开 turn、不广播任何通知**（挂机连接 0 事件）→ TUI 不会实时刷新
4. **对照 B（写者锁）**：开窗时 WS `thread/resume` → **成功**（同进程多连接共享 thread-store）；同刻 `codex exec resume`（自带 app-server 进程）→ `Error: thread/resume: thread/resume failed: thread 01a0fbda-... already has an active writer (code -32600)`，日志原文 `failed to initialize thread persistence: thread-store conflict`。0.159.3 的"resume 被拒"定案实为**跨进程持久层锁**，0.160.0 未放松也未收紧。
5. **对照 C（关窗常规路径）**：杀 TUI 后 WS resume/inject/turn/start 全部正常（模型回 `CLOSED-OK`）。**注意**：`codex exec resume` 在关窗后仍被拒——daemon 把线程留在 loaded 列表（status=idle、`thread/loaded/list` 可见，`thread/unsubscribe` 无济），跨进程 headless 只要线程还在 daemon 里就进不去。
6. **模型处理判定**：开窗注入两条（INJECT-OPEN-V1/V1b）后第二连接 `turn/start`，模型回复原文：
   ```
   TURN-START-OK
   INJECT-OPEN-V1
   INJECT-OPEN-V1b
   ```
   → 注入的是**模型可见的待处理历史**（下次 turn 生效），非死档案；inject 单发不触发 turn，turn/start 才驱动。

## 精确 RPC 形状（前次 proxy 零输出的根因已破）

daemon control socket 是 **WebSocket**（HTTP Upgrade + 每条 JSON-RPC 一个 text 帧），`codex app-server proxy` 只是裸字节管道——裸 JSONL 不是握手，直接被踢（os error 10054）。信封**无 `jsonrpc` 字段**：

```jsonc
// 升级请求（经 proxy stdin）
"GET /probe HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: <b64>\r\nSec-WebSocket-Version: 13\r\n\r\n"
// 之后每帧一条：
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"mcp-bridge","version":"..."}}}   // → 返回 codexHome 等
{"method":"initialized"}                                                                       // 通知
{"id":2,"method":"thread/resume","params":{"threadId":"<uuid>"}}
{"id":3,"method":"thread/inject_items","params":{"threadId":"<uuid>","items":[{"type":"message","role":"user","content":[{"type":"input_text","text":"..."}]}]}}
{"id":4,"method":"turn/start","params":{"threadId":"<uuid>","input":[{"type":"text","text":"..."}]}}
```

同线程请求按 threadId 串行（协议映射 `serialization: thread_id`）：turn 进行中的 inject 会在 turn 结束后落盘（实测 INJECT-BCAST 排到了 turn 之后）。

## multichat 接入建议

1. **通道**：`CODEX_HOME` 定位 control socket（`<CODEX_HOME>\app-server-control\app-server-control.sock`），spawn `codex app-server proxy` 做管道，其上实现 ~80 行 WS 客户端（或直接用本次实验的 `ws.py` 骨架）。
2. **投递两档**：
   - 只补历史/带外上下文 → `thread/inject_items`
   - 完整"发消息并要回答" → 直接 `turn/start`（无需 inject；开窗关窗皆可）
3. **前置**：用户 daemon 升 0.160（`codex app-server daemon update`）。
4. **可见性取舍**：WS 通道对 TUI **无实时刷新**（无广播）；要"用户在窗口里看到消息并自动开 turn"，`codex queue`（前次报告已证 2 秒内自动消费）仍是首选；WS turn 是"外部驱动、窗口不显示"的控制面。两通道并存：queue=可见投递，WS=结构化控制。
5. **风险**：`canAcceptDirectInput`/多连接并发 turn 的语义（两个连接同时 turn/start 同线程）未测；TUI 对外部 turn 的最终渲染未验证（隐藏窗口无法截图）。

## 清理清单（全部已执行）

- 探针线程 `01a0fbda-f492-7ae1-8599-d53c3e43ff42`：`thread/delete` 成功（`thread/list` 归零）；副产物线程 `01a0fbe0-9a2b-...`（未持久化虚线程）随 daemon 销毁
- 隐藏 TUI（pid 4272）：Stop-Process 确认退出
- 隔离 daemon（pid 8016/7352）：`daemon stop` + 补刀，`Get-Process codex` 仅剩用户自己的 0.157.1 daemon（15408）
- `D:\tmp\codex-inject\`（home/config 含 token 副本、schema、脚本、日志、work）：整目录已删
- `~/.codex`：未改动（config.toml 仅读取）；无 git 操作、无仓库代码改动
