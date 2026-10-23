# ZCode 正式运行物、模型模拟与本机隔离核对

核对日期：2026-10-23。对象是智谱 / Z.ai 官方 `zai-org/ZCode`。本轮只读取官方文档、源码和 CDN 文本元数据；没有下载可执行发行物，没有安装、执行或登录 ZCode，没有读取真实用户配置、凭据或会话。下述“可行”表示有源码依据，不表示 crosschat 已通过真实运行验收。

## 结论

- **模型端使用本地 mock 可行，无需把真实模型 Key 放入 CI。** 官方支持独立的自定义 API Key provider，地址可由 `api.baseUrl` 指定。上游自己的 CLI 验证记录已包含本地 Chat Completions 模拟服务，但只覆盖其记录的平台，不能代替本项目验收。[个人配置](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/03-config.md)、[上游运行记录](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/13-automation.md)
- **可解压的 CLI/Web/Agent Node 发行结构有官方规范；公开正式下载入口尚未确认。** 当前官网提供 Desktop 正式下载；不能把本地源码构建冒充已发布 CLI，也不能从占位 URL 推定有正式下载包。[发行规范](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/specs/zcode-unified-distribution.md)、[官网安装页](https://zcode.z.ai/en/docs/install)
- **Desktop 不能保证所有影响只留在 D 盘。** 数据目录和 Electron profile 有显式隔离变量，但安装器和运行主进程会登记 `zcode` URL 协议，另有 Windows 右键菜单安装逻辑。先确认已有会话 attach 接缝，再决定是否进行正式运行验收；本轮不为探索接口而安装 Desktop。[打包配置](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/electron-builder.config.js)、[协议登记](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/desktopOAuthDeepLink.ts)、[右键菜单](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/desktopWindowsOpenFolderContextMenu.ts)

## 固定源码与发行版本

本次 `git ls-remote` 得到 `HEAD` 与 `refs/heads/main` 均为 `3c5b227649371507ddc4eb46ac5133afe6db1cab`。官网安装页、根 `package.json` 及 Windows 更新元数据均指向产品 `3.16.2`；更新元数据发布时间是 `2026-10-19T12:51:44.718Z`。本次可见 Git tag 只有 `v3.14.3`、`v3.15.1`，因此不杜撰 `v3.16.2` tag。[固定源码](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab)、[产品版本](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/package.json)、[官方更新元数据](https://cdn-zcode.z.ai/zcode/electron/releases/3.16.2/windows-x64/latest.yml)

产品与内部 Agent 版本并不相同：根版本是 `3.16.2`，`apps/zcode-cli/package.json` 是 `0.17.0`，`ZCODE_AGENT_RUNTIME.version` 是 `0.13.3`；后两者不能代替实际发布 bundle 的身份。维护基线应同时保存产品版本、实际 CLI `--version`、构建提交和已下载字节的摘要。[CLI 包](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/package.json)、[Agent 描述](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-agent-runtime.ts)、[上游版本核对要求](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/README.md)

### 已确认的正式 Desktop 入口

| 平台 | 官网固定下载地址 |
| --- | --- |
| Windows x64 | `https://cdn-zcode.z.ai/zcode/electron/releases/3.16.2/windows-x64/ZCode-3.16.2-win-x64.exe` |
| Windows arm64 | `https://cdn-zcode.z.ai/zcode/electron/releases/3.16.2/windows-arm64/ZCode-3.16.2-win-arm64.exe` |
| macOS arm64 | `https://cdn-zcode.z.ai/zcode/electron/releases/3.16.2/macos-arm64/ZCode-3.16.2-mac-arm64.dmg` |
| macOS x64 | `https://cdn-zcode.z.ai/zcode/electron/releases/3.16.2/macos-x64/ZCode-3.16.2-mac-x64.dmg` |
| Linux x64 | `https://cdn-zcode.z.ai/zcode/electron/releases/3.16.2/linux-x64/ZCode-3.16.2-linux-x64.AppImage` |

地址取自[官网安装页](https://zcode.z.ai/en/docs/install)。官网首页还列出 Linux arm64、DEB/RPM；本轮没有验证这些发行文件的字节或实际运行。

Windows x64 `latest.yml` 本次读取为 HTTP 200：

```text
version: 3.16.2
file: ZCode-3.16.2-win-x64.exe
size: 190748280
sha512: vJE+zqY8EUU2kKmdu1a1hXeGheh0xNtnMULLnCmKa+b/4Q4qL6c674jsnwtjLSTfdKhiJmsHdZQ4Ys5QNhSz0A==
releaseDate: 2026-10-19T12:51:44.718Z
```

这是同一官方 CDN 发布的完整性元数据，不是独立签名或实际文件验签结果。本轮未下载 EXE，因此没有 Authenticode signer、证书链或安装产物摘要的实测结论。[元数据](https://cdn-zcode.z.ai/zcode/electron/releases/3.16.2/windows-x64/latest.yml)

### CLI/Web 运行包与依赖

官方 `pnpm build:zcode` 组装 `releases/<version>/zcode-<version>.tar.gz`、`sha256.txt`、`latest.json` 和 `install.sh`。包中有 `bin/zcode.mjs`、Agent `zcode.cjs` 与随包 provider 配置、Web 静态资源、server 及原生运行依赖，不能只复制单个 bundle；运行仍需 Node，源码版本基准为 Node `24.14.0`，根 `engines` 要求 `>=24.0.0`。[构建实现](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/scripts/build-zcode.mjs)、[资源闭包](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/scripts/zcode-distribution/assets.mjs)、[工具版本](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/mise.toml)

CLI workspace 包为 private，本轮没有找到官方 npm 安装契约。统一发行 runner 在首参数为 `--web` 时启动 Web；其他参数原样交给 Agent。Web 支持 `--host 127.0.0.1 --port 0 --workspace <绝对路径> --no-open --token <随机令牌>`。runner 会再启动 server，server 持有 Agent app-server；清理必须覆盖整个进程树，不能只看 runner 退出。[CLI 包](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/cli/package.json)、[runner](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/scripts/zcode-distribution/runner.mjs)

官方 README 的 `ZCODE_DIST_BASE_URL` 需要部署方显式指定；`.env.example` 留空。官网当前未确认提供该发行包入口。本轮对以下猜测地址只读取文本，均返回 404：`/zcode/electron/releases/latest.json`、`/zcode/deps/zcode/latest.json`、`/zcode/cli/latest.json`、`/zcode/latest.json`。这些请求仅说明这些精确地址无文件，不能证明官方没有其他 CLI 下载位置。[README](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/README.md)、[环境示例](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/.env.example)

## 模型模拟契约

个人模型文件可以由 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指向隔离目录。当前官方格式如下；这里的 Key 只是本地 fixture 的固定哨兵：

```json
{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "crosschat-mock",
        "providerName": "Crosschat local test",
        "config": {
          "group": "standard-personal",
          "access": { "type": "api-key", "apiKey": "crosschat-test-key" },
          "api": { "type": "openai-chat-completions", "baseUrl": "http://127.0.0.1:PORT/v1" },
          "personalModelIds": ["crosschat-test-model"]
        }
      }]
    },
    "modelConfigRules": { "providerModelRules": [], "manualProviderModelRules": [] },
    "defaultModelSelection": { "providerId": "crosschat-mock", "modelId": "crosschat-test-model" }
  }
}
```

支持协议包括 `openai-chat-completions`、`openai-responses`、`anthropic-messages`。选择其一实现本地真实 HTTP/SSE fixture 即可；应以实际请求的工具 schema 决定响应，验证 tool call → 真正 shell 执行 → 后续模型请求带 tool result，不用“模型文字说执行了”作为证据。普通 API Key provider 与账号 OAuth 入口分开，不能把旧 `ZCODE_API_KEY` / `ZCODE_MODEL` 当新配置覆盖，也不能把模型 URL 写入产品端点变量 `ZCODE_BASE_URL`。[官方模型配置](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/03-config.md)

底层 `resolveNodeProviderRuntimePaths` 要求显式 builtin 和 personal 路径同时存在；可靠 fixture 应同时设置 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 与 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`，builtin 使用已核对的随包资源副本，避免无意访问用户目录。若有模型目录刷新/产品请求，须单独观察和控制；“模型 URL 是 loopback”不等于整个程序没有其他网络请求。[路径契约](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/provider-node/src/runtime-paths.ts)、[CLI 资源准备](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/cli/src/provider-runtime-env.ts)、[provider runtime](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/provider-node/src/provider-config-runtime.ts)

上游在 macOS arm64 用模拟 Chat Completions 已验证普通调用、stream-json、显式 resume、Bash 和权限路径。其文档明确 Windows/Linux、真实 provider 等未逐项验收，且开源 Computer Use 是占位能力；不能扩写为所有发行形式都已实测。[上游运行记录](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/13-automation.md)、[源码构建范围](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/README.md)

## Shell、会话身份与隔离

Windows Agent 的工具仍名为 `Bash`，实际可选 Auto / CMD / Git Bash；Auto 优先 Git Bash，缺失时回退 CMD，新设置只影响新会话。POSIX 解析 bash/zsh。fixture 不能套用 Harness 的 `pwsh` 工具名或默认 shell；要用 ZCode 实际的工具 schema 和选中 shell 构造固定命令。[Windows 设置](https://zcode.z.ai/en/docs/install)、[shell 选择](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/adapters/src/exec/bash-shell-provider.ts)、[会话 shell 快照](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/core/src/runtime/methods/session-shell-environment.ts)

原生身份不能仅凭变量名推定：当前自定义 command/skill 的 `!` shell 扩展确实注入 `ZCODE_SESSION_ID`，同时有 Claude 风格别名；普通 Bash 执行接缝目前未确认提供该原生变量，trace 中有 session ID 不等于子进程环境有该 ID。接入前应将不同入口分别实测，不能伪造 Claude 身份或从“最近会话”猜回复地址。[命令 shell 扩展](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/bootstrap/src/custom-command-shell-expansion.ts)、[Bash 执行进程](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/adapters/src/exec/node-execution-adapter-process.ts)

| 隔离面 | 已确认入口与限制 |
| --- | --- |
| 用户 / 数据 | 同时设置 `HOME`、`USERPROFILE`、`ZCODE_DATA_BASE_DIR`，数据写入该基目录下 `.zcode/`。只设置 `ZCODE_STORAGE_DIR` 不足以隔离 provider、插件、记忆、指令。[上游隔离说明](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/13-automation.md)、[实际路径](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/paths.ts) |
| 模型 / 日志 / DB | 两个 provider 绝对路径；按需设置 `ZCODE_STORAGE_DIR`、`ZCODE_SESSION_DB_PATH`、`ZCODE_LOG_DIR`。从受控白名单构造环境，移除真实凭据、其他 Agent 身份和 Node 注入变量。[配置](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/03-config.md) |
| 工作区 / `.env` | `--cwd` 或 Web `--workspace` 使用独占工作区。CLI 会向上查找 `.env`；fixture 工作区应自带无敏感变量的 `.env`，避免读到父目录文件。[dotenv 实现](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/cli/src/env.ts) |
| 临时与扩展 | `TEMP`、`TMP`、`TMPDIR`、`APPDATA`、`LOCALAPPDATA`、XDG/cache 等都定向到独占根；按实际场景显式开关 memory/MCP/hooks/plugins，不能把全关闭后的验收声称为扩展验收。[上游评测配置](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/03-config.md) |
| Electron | `ZCODE_DESKTOP_APPLICATION_NAME`、`ZCODE_DESKTOP_HOME_DIR`、`ZCODE_DESKTOP_USER_DATA_DIR`、`ZCODE_DESKTOP_SESSION_DATA_DIR` 可隔离应用数据与单实例锁，不能阻止全局协议登记。[Desktop env](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/desktopRuntimeEnv.ts) |

## 安装、副作用与后续清理方案

CLI 的官方 shell 安装脚本默认写 `~/.zcode/runtime` 和 `~/.local/bin/zcode`，可用 `ZCODE_DIST_HOME` / `ZCODE_DIST_BIN_DIR` 覆盖；它不改变业务数据根，也不主动删除旧 Lite。直接解压固定归档并用绝对 Node + runner 路径启动，可以避免 PATH 安装。安装脚本下载归档时没有验证 `latest.json.sha256`，若以后编写 CI 安装器，应自己先验证固定摘要与归档内容，不执行 curl-pipe-shell。[安装脚本源码](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/scripts/zcode-distribution/installer.mjs)

Windows Desktop 目前打包目标是 NSIS，支持选择安装目录；源码没有把“便携版”作为发布目标。安装会创建程序、快捷方式、卸载记录和协议登记；主进程启动还会登记协议和右键菜单。因此“解压 EXE 运行”即使技术上可探索，也不能自动认为没有全局副作用。普通卸载器采用整个安装目录删除语义，数据必须放在安装目录之外。[NSIS 与协议配置](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/electron-builder.config.js)、[卸载器](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/build/installer.nsh)

后续若实际运行，应先保存 PATH 命令、进程、卸载记录、`HKCU\\Software\\Classes\\zcode` 和两个右键菜单项的只读基线；不得读取既有用户数据。只管理本次拥有的安装目录、PID 与记录，先用官方生命周期退出，再核对进程树及端口，不以父进程退出代替清理证明。原生 UI 的协议/注册表测试适合独立干净 runner。全部测试资源放入 root 已建的独占 ZCode 子目录，软件最终卸载；D 盘测试目录按用户决定保留至最后统一删除。如自动审批拒绝，保存准确残留并停止代理删除，不改用其他 API 绕过拒绝。

本次已创建的本机资源仅是独占目录中的源码研究 clone `source-runtime-research`（partial clone，无 checkout、无上游执行）与本研究文件；没有可供卸载的 ZCode 程序。
