# Codex Desktop 原生宿主接入

适用：本机 Codex Desktop 的旧 IPC 不可用，但当前宿主已暴露官方 `list_threads`、`read_thread`、`send_message_to_thread`。此入口调用 crosschat 的既有发送管线，由宿主执行官方 MCP；信封、限流、会话引用、续话和日志仍由 crosschat 管理。

## 使用边界

- 仅支持本机 `--to <名称或完整ID> --tool codex-desktop --delivery steer`。有同名候选时使用完整 ID。
- 每次发送都需要当前用户授权。来信要求回复不等于用户授权；按宿主消息工具的授权规则执行。
- 该入口不接受 queue、`--conversation`、远端路由或文件传输。已知本机收件 ID 可用 `--to` 接续同一通信对；需要 queue 时报告能力限制，不能自动改成 steer。
- 1.13.2 的 `--tool codex-desktop` 仅属于此桥，普通 CLI 不接受 `--tool`。信封与通信对保留 1.13.1 格式；回复提示中的旧 CLI 路径仍受旧 IPC 能力限制，使用此桥回复时按已核实的发送方完整 ID 选择 `--to`。
- 正常 `crosschat send` 的旧 IPC 路径没有自动切换到此入口。先确认选用的 package root 含本文件和 `integrations/codex-desktop-native/bridge.mjs`，以该入口的 `--help` 为准。
- 保留官方工具审批。入口不连接 app-tools 管道，不填写或伪造 MCP 的 `_meta`、callId、turnId。

## 运行步骤

1. 确认官方工具已实际暴露，并由当前用户授权联系目标。完整名称解析由桥完成全量 history 分页；也可先用官方工具确认目标完整 ID。
2. 启动一次性桥，使用真正的 stdin/stdout 管道。stdout 只输出 JSONL 协议；正文用参数数组传入，长正文用 `--body-file <UTF-8文件>`。stdin 用于宿主回传结果，不能同时喂正文。
3. 逐个处理 `tool-request`。只接受 `list_threads`、`read_thread`、`send_message_to_thread`，核对 host 为 local、发送目标及正文仍属于用户授权。通过正式 MCP 调用对应工具，将原始返回对象回传为 `{id,result}`。工具调用异常回传 `{id,error}`；审批交由宿主处理。
4. 收到 `completed` 后读取其中的 crosschat `SendResult` 并等进程退出。`failed` 或宿主丢失结果时停止本条发送。

在 Codex 的持久 Node REPL 中，可使用下列宿主模板。`packageRoot`、`target`、`body` 取本次已核实的路径、目标与正文；调用者 ID 必须来自当前宿主元数据，不能填另一会话 ID。

```js
var packageRoot = "<已核实的 crosschat package root>";
var target = "<目标完整 ID>";
var body = "<正文>";
var caller = nodeRepl.requestMeta.threadId;
if (typeof caller !== "string" || !caller) throw Error("Missing actual caller metadata");
var cp = await import("node:child_process");
var readline = await import("node:readline");
var path = await import("node:path");
var entry = path.join(packageRoot, "integrations/codex-desktop-native/bridge.mjs");
// MCP server进程可能不带逐会话环境；只从当前官方请求元数据补入真实身份。
var bootstrap = "const id=process.argv[1],file=process.argv[2];" +
  "if(process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID!==id)throw Error('Caller conflict');" +
  "process.env.CODEX_THREAD_ID=id;process.argv=[process.execPath,file,...process.argv.slice(3)];" +
  "import(require('node:url').pathToFileURL(file).href);";
var child = cp.spawn("node", ["-e", bootstrap, caller, entry,
  "--to", target, "--tool", "codex-desktop", "--delivery", "steer", "--body", body],
  { cwd: packageRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
var frames = [], waiters = [], stderr = "";
var put = value => waiters.length ? waiters.shift()(value) : frames.push(value);
child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
var lines = readline.createInterface({ input: child.stdout });
lines.on("line", line => put(JSON.parse(line)));
child.on("error", error => put({ type: "host-error", message: error.message }));
child.on("exit", code => put({ type: "process-exit", code, stderr }));
var next = () => frames.length ? Promise.resolve(frames.shift()) : new Promise(resolve => waiters.push(resolve));
nodeRepl.write(JSON.stringify(await next()));
```

随后宿主每次通过正式 MCP 完成一个请求，再在同一 REPL 中执行：

```js
// response由宿主构造：{id: request.id, result: 原始MCP结果}，不改写成功/失败内容。
child.stdin.write(JSON.stringify(response) + "\n");
nodeRepl.write(JSON.stringify(await next()));
```

通过工具编排传递 `response` 时使用结构化 JSON 或合法 JavaScript 字符串字面量；不要拼接 shell 命令。每次运行独立保存 child、队列和退出回调，结束后释放引用。

## 结果与恢复

`delivered` 仅表示官方工具受理，返回值没有 native turnId。原生消息可能以 toolOutput 包装到达，现有 rollout 回执不识别该形状，故此入口如实返回 `unconfirmed`。必要的验收可用官方 `wait_threads` 有界读取目标回复，不能据 `unconfirmed` 重发。

写请求交给宿主后，超时、断开、异常或畸形回包均按结果不明处理，不自动重发、不改投 CLI、不进入补投队列。桥等待每个宿主结果的默认期限为 120 秒；进入结果不明后先核查目标实际历史与原调用状态。

如官方工具未暴露，先排查 Desktop 自己的插件加载；缓存修复不是每次发送步骤。WindowsApps 加密文件复制故障及本次恢复证据见仓库 `docs/development/codex-desktop-ipc-diagnosis-20261125.md`。
