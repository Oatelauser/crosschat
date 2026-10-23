# 实际 ZCode Desktop 3.15.3 的只读入口核查

核查日期：2026-10-23。用户主动启动其原有 `D:\soft\ZCode`，并新建“测试会话”；本次没有安装、启动、停止或修改该软件，也没有连接会话、发送消息、开启调试器、读取个人配置、凭据或聊天历史。此记录补充 [官方当前源码合同研究](zcode-native-contract-20261023.md)，不把当前 `main` 的 3.16.2 当作已安装程序。

## 实际包身份

从随程序分发的 `resources/app.asar` 纯读 ASAR header / 指定文件字节，得到：

| 来源 | 值 |
| --- | --- |
| `package.json` | `@zcode/desktop`；`version: 3.15.3`；入口 `out/main/index.js`；production flavor |
| `out/metadata/build-meta.json` | `appVersion: 3.15.3`；`buildCommitId: d7ca8bee`；`buildTime: 2026-10-13T08:36:30.450Z` |
| `resources/app.asar` SHA-256 | `3FB4104DDCD79E9808EEDE75192299A22057BD9C336E15B9C2BB1825B4120283` |
| `resources/glm/zcode.cjs` SHA-256 | `31965CE1D5D4A808EF156784F67996DE42CCAB335591D2386A61EA8F6F506A54` |

只将包内 40 个 `out/main/*.js`、`out/host/*.js` 和 build metadata 复制到已授权 D 盘测试子目录 `zcode-20261023-c66c19af74be4408a3707cb9fffd3987/installed-3.15.3-static` 供搜索；没有执行这些 JS。原包与安装目录未写入。

## 实际入口证据

1. `main-index.js` 含 `createWebRemoteControlSharedHostAttachments`。本地路径仍从已有 Window Host map 取 UtilityProcess，创建 `MessageChannelMain`，发送 `AttachServicePort` 与 `clientMode: web-remote-replayable`；attachment ID 仍为 `shared-host-attachment-*`。已有 Desktop Host 的连接点与当前源码研究相同，是 Electron Main 内部端口调度，未出现可供外部进程直接连接的公开本机聊天 endpoint。
2. `host-chunk-WG6TEDKG.js` 的 `resolveBundledWorkspaceZCodeAgentCommand` 返回 `process.execPath`、参数 `[zcode.cjs, app-server, --stdio]`、`ELECTRON_RUN_AS_NODE: 1`。这确认桌面聊天实际由 Host 持有子 Agent 的 stdio；另起同路径 CLI 不会自动取得现有 Host 的 owner。
3. `host-index.js` 里 `/api/server-info`、`/ws`、`/api/rpc-host-capability`、`/ws/host` 出现在 `resolveServerRemoteEndpoints`，构建的是连接外部 Source Server 的客户端 URL。不能将“包内有 `/ws` 字符串”解释成当前 Desktop 开启了本机聊天 WebSocket。
4. 扫描 main/host 中的 listener 位置，确认存在 media/resource HTTP、CUA socket rendezvous 和 off-peak mock server 代码。这些是特定功能 transport，没有找到将它们用于任意 conversation 发现/发送的合同。
5. `main-index.js` 中固定 `remote-debugging-port=9229` 受 `!app.isPackaged` 条件限制。调试端口也不是聊天适配合同；本次未启用或附着调试器。

结合 root 对当前进程树的只读检查——当时 main/Host/Agent 树下没有 TCP listener——本次仍未确认一个可让 crosschat 直接附着该“测试会话”的公开本机入口。进程瞬时状态不能证明所有启动配置永远没有 listener，因此此结论保持“本次没有确认”，不扩大为不存在任何可能。

## 实际包的原生调用身份

静态读取 `resources/glm/zcode.cjs`，定位到保留函数标记 `createExecutionRequest`。普通 Bash request 仍仅在 `trace` 放 `sessionId`，没有向该 request 的 `env` 增加原生会话 ID。`createShellExpansionEnv` 则为自定义命令扩展设置 `ZCODE_SESSION_ID` 与 Claude 别名，和当前源码研究一致。

因此，即使用户已经打开真实桌面并创建会话，也不能假定普通模型 Bash 调用天然带有 `ZCODE_SESSION_ID`，更不能把同名环境变量猜作可信原生身份。

用户随后回报，已在“测试会话”通过普通 Bash 执行五变量 `Boolean(process.env[k])` 诊断，结果全部 `false`，见[原样输出与证据边界](../development/evidence/zcode-20261023/desktop-bash-identity-user-report.json)。它只说明该 Bash 子进程中五个变量不存在或为空，不能检测宿主环境、trace、其它变量或其它工具入口；代理没有直接观测执行。这个结果支持当前普通 Bash 路径没有可用的已测身份变量，不代表 ZCode 没有内部会话 ID，也不代表无法设计显式身份传递。

## 对接入决定的影响

用户打开真实程序使版本和拓扑有了本机证据，但没有消除两个合同缺口：已有 Desktop owner 的公开外部 attach，以及普通工具调用的可信会话身份。当前没有采用修改应用包、调试器注入、读取私有用户文件或另开 app-server 来冒充完整原生适配。

后续若官方提供明确的本机 attach / Host 扩展接口，再基于真实包与本地模型 mock 做自动验收较符合低维护目标。当前静态调查不算会话发现、idle 唤醒、queue/guide 或双向聊天测试通过。

## Bot Channel 的实际包补查

实际 3.15.3 的静态 `host-index.js` 包含 generic Webhook Adapter、固定 provider 构造表和 `handleProviderCallbackResponse`，所以不能把“官网只公开微信/飞书”误写成产品内部没有 Webhook。所复制 main/host 文件未找到 `/api/bots` 或 `createHttpServer` 字符串；这只是静态检索结果，不证明所有启动方式永远没有该入口。结合当次进程树监听检查，仍未确认可从外部调用的现有 Desktop Webhook ingress。

当前 3.16.2 固定源码另确认：Webhook 接收 `botId/userId/text` 等，按绑定 Bot 上下文的 activeTaskId 路由，未直接接受任意 `sessionId`；HTTP 路由注册在独立 server。该源码结论不作为用户 3.15.3 的实际投递验收。Hook、MCP、UI Plugin 和 Webhook 的能力/限制汇总见[决策检查点](../development/zcode-integration-checkpoint-20261023.md)。
