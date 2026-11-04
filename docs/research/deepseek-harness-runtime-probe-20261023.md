# DeepSeek Harness：真实 runtime 与 mock 模型验证入口

2026-10-23，Asia/Shanghai。只读调研，未安装或执行上游程序，未下载桌面二进制，未使用真实模型凭据。本记录给后续接入提供可重复的验证入口，不代表 Harness 已通过 crosschat 验收。沿用官方固定源码 `687f282e8625c6b8d11ff58211a90524be2e4317`；不覆盖 2026-10-22 的历史研究。

## 当前可固定的发行物

| 对象 | 本次查询结果 | 使用边界 |
|---|---|---|
| 官方 GitHub release | `dsh-v0.2.1-rc.2`，2026-10-17 发布，提交 `687f282e8625c6b8d11ff58211a90524be2e4317` | 仍为预发布；README 明示会发生破坏兼容的变更。 |
| npm CLI | `@deepseek-ai/dsh@0.2.1-rc.2`；`latest`、`next` 均指向该版本；bin 为 `lib/bin.js` | 可在独占目录按精确版本安装，直接以 Node 执行该入口，无需全局安装。 |
| Windows Desktop | 官方 production nightly feed 给出 `0.2.1-rc.2`、289385456 bytes | 使用 feed 中的版本化 URL 和 SHA-512，不以可变的 `dsh-latest-*` 地址作为固定基线。 |
| macOS Desktop | 官网提供 Apple silicon DMG；发布文档也定义 mac-x64 target | 官网列出入口不等于本机完成对应平台实测。 |
| Linux | npm CLI/Web 可作为候选测试入口；源码配置有 AppImage target | 官网未列 Linux Desktop 下载；不能据源码 target 宣称已发布或验证 Linux Desktop。 |

来源：[官方 releases](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)、[固定 README](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.md)、[npm 精确版本元数据](https://registry.npmjs.org/@deepseek-ai/dsh/0.2.1-rc.2)、[官网](https://www.deepseek.com/en/harness/)、[发布 target 与固定下载说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/publishing/README.md)、[打包 target 配置](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/electron-builder-config.mjs)。

本次通过 registry/官方 feed 只读查询得到的固定信息：

```json
{
  "npm": {
    "name": "@deepseek-ai/dsh",
    "version": "0.2.1-rc.2",
    "tarball": "https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.2.tgz",
    "integrity": "sha512-tvY+yhfKRifthbqPe/OK0AYxM5ZkvqfYq/jMYgJcEUxiRRL1Vwra3Ti5TB6AXgSWQdiPHYh/Vp6SJa9yHwMNuw=="
  },
  "desktopWindows": {
    "feed": "https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml",
    "version": "0.2.1-rc.2",
    "url": "https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe",
    "size": 289385456,
    "sha512": "39POl5osl9PKMqrPXQA52dh/bCV0Z02vOV9cTjOJDHE6gsJwp5bv7lfgB3mVWAKspX7a/w1iTi+8Listdhq45g==",
    "releaseDate": "2026-10-17T09:22:23.750Z"
  }
}
```

只查询了桌面 EXE 的 HEAD：HTTP 200，长度与 feed 相同。尚未校验文件实际内容、Authenticode 签名或安装后 runtime descriptor，因而不把上面的 metadata 当作已验证二进制证据。npm 精确版本元数据没有返回 `engines` 或 `gitHead`；源码 release commit 与实际 npm/桌面内容的对应关系还需在获取发行物时核实。

## 启动与依赖

官方仓库要求 Node `^22.19.0 || >=24.0.0`，源码开发使用 `pnpm@11.28.5`；官方运行指引是 `npx @deepseek-ai/dsh web`，源码路径为 `pnpm install`、`pnpm run build`、`pnpm dsh web`。没有必须使用 Bun 的要求。直接使用正式 npm 发行物可避免为本次接入重建上游整个前端、Electron 及原生构建链。[根 package.json](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/package.json)、[开发环境说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/development.md)、[CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/package.json)。

`dsh` 是统一 launcher。`web`、`headless`、`sdk`、`sdk-minimal`、`acp` 各为 profile，首次使用自动初始化。`web --no-open --host 127.0.0.1 --port <port>` 可以保持真实长驻 runtime、不打开浏览器。launcher 的 `--profile`、`--patch` 必须在应用参数之前。[CLI 命令与 profile](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/README.md)、[准确参数顺序](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/reference/README.md)。

Desktop 自带 Electron、Node/pnpm 及生产依赖，不依赖系统全局 CLI。它独占 `$DSH_HOME/profiles/desktop`，npm CLI 拒绝启动及管理这个 profile。插件管理要通过 Desktop 的 Plugins 页面，或完全退出 Desktop 后使用安装内的 `resources/runtime/cli/bin/dsh.cmd plugin --profile desktop ...`；无需把该命令注册到 PATH。[Desktop runtime 与插件所有权](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#bundled-command-runtime)。

## 模型 mock：直接驱动正式模型适配器

原生 `deepseek-official` route 使用 Messages 协议。`DEEPSEEK_BASE_URL` 或插件 `baseURL` 可指定 loopback HTTP 根；请求追加 `/v1/messages`，根已以 `/v1` 结尾时复用该段。API-key 模式发送 `x-api-key`。例如设 `DEEPSEEK_BASE_URL=http://127.0.0.1:<port>/v1`、`DEEPSEEK_API_KEY=mock-key`，模型端可以完全留在 CI 当前 runner。[Messages endpoint 规则](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-deepseek/README.md#endpoint-and-wire-format)、[key route](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-deepseek-api-key/README.md)。

上游已有无真实 key 的 `llm-mock-server` 源码：`pnpm run mock:llm`，支持 text、tool call、断流、stall、429/5xx 和请求捕获。但它没有可安装 bin，且不列在正式 CLI 的运行依赖里，不能假设安装 `dsh` 就能直接执行该 mock。维护成本较低的做法是让 crosschat 现有 Node HTTP fixture 实现所需 Messages 子集；以固定上游 mock 为行为参考。[官方 mock 入口及约束](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/test-support/llm-mock-server/README.md)、[CLI 依赖清单](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/package.json)。

官方 mock 的实际 SSE 顺序是具名 `event:` 加 JSON `data:`：`message_start` → `content_block_start` → 零到多个 `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`。文字 delta 为 `text_delta`；工具块为 `tool_use`，参数分片为 `input_json_delta/partial_json`，最终 `stop_reason: tool_use`。以源码为准；README 部分故障表仍沿用 `[DONE]` 的描述，不应照搬成 OpenAI Chat Completions chunk。[mock SSE 实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/test-support/llm-mock-server/src/index.ts)。

Windows 默认工具为 `pwsh`，POSIX 默认 `bash`。Windows 可以先发 `pwsh` 工具调用，参数形如 `{"description":"Read native session identity","command":"Write-Output $env:DSH_SESSION_ID"}`，下一次模型请求检查真实 `tool_result` 后返回带本次 nonce 的 ACK。实际 fixture 必须从此次请求的 `tools` schema 核实工具名称/参数，不把“模型文字说执行了”当成功。[pwsh 工具契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/tool-pwsh/README.md)、[默认 shell 平台选择](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml)。

交互 profile 的凭据文件优先于启动环境，其次是项目 `.env` 与 Harness-home `.env`。因此必须以空的隔离 DSH home 和独占工作区启动；不能依赖覆盖一个环境变量来遮住用户已保存的真实 key。headless profile 会禁用交互 credentials/account 组件。[凭据优先级](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/credentials/credentials-local/README.md)、[headless 组合](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/cordis.patch.yml)。

## 隔离、技能与原生身份

建议为每次运行创建带 ownership receipt 的独占根，并由 child `env` 设置以下路径；不修改父进程或全局用户变量：

| 项目 | fixture 选择 |
|---|---|
| `DSH_HOME` | `<run>/dsh-home`；profile、sessions、credentials、settings、storage 均在其下 |
| `DSH_AGENTS_HOME` | `<run>/agents-home`，隔离共享用户 AGENTS/skills 根 |
| `HOME` / `USERPROFILE` / Windows home drive/path | 同一个 `<run>/profile`，保证 Node 与原生 shell 的 home 一致 |
| `APPDATA` / `LOCALAPPDATA` / `XDG_*` / temp | 各自指向本次 run 内目录 |
| npm/pnpm user config、cache/store | 空的本次配置文件及缓存目录，避免读取用户 registry 凭据或创建全局缓存 |
| 工作区 | `<run>/workspace`，放置本次 `.git` 根标记与 fixture skill，避免技能/指令向外发现 |
| 凭据及预加载环境 | 不继承真实 `*_KEY`、`*_TOKEN`、`NODE_OPTIONS`、`NODE_PATH` 或其它工具身份；只给 mock 值和运行所需白名单 |

其中 Harness home 与共享 agents home 的优先级均为显式配置 → 环境变量 → OS home 下的默认目录；二者是分开的。[home-paths 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/util/home-paths/README.md)。官方 Desktop runtime smoke 也隔离 HOME/USERPROFILE、APPDATA/XDG 和 package-manager 配置，但本次还应补上共享 agents 根。[上游 smoke 的环境隔离](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/smoke-runtime.ts)。

技能可置于 `<workspace>/.agents/skills/crosschat/SKILL.md` 或 `$DSH_HOME/skills/crosschat/SKILL.md`；要求 YAML frontmatter 有 `name` 与 `description`。发现根还包括项目 `.dsh/skills`、自定义目录及 `$DSH_AGENTS_HOME/skills`。只发现根的直接子目录，不递归查任意嵌套 skill。读取 catalog/加载 body 需要实际运行的 skill provider/工具，复制文件本身不等于验证已发现。[技能发现规则](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/skill/skill-filesystem/README.md)。

原生 shell-env 对每次模型 shell 调用构建可信 `DSH_*` 快照：`DSH_HOME`、`DSH_SHELL=1`、真实 `DSH_SESSION_ID`，以及可用时的 `DSH_PROFILE`、`DSH_PROFILE_DIR`。执行器会丢弃继承的同名 namespace，不能靠给 launcher 注入伪造 session ID 证明身份。验收应让模型调用真正 `pwsh/bash` 执行 crosschat 发信，再核对接收方看到的完整发送 ref。[原生环境契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/shell-env/README.md)。

## 最小重复验证路径

以下是建议的实施顺序，均尚未执行：

1. 固定 npm 版本和 integrity，在本次 root 下局部安装正式 `@deepseek-ai/dsh`，保存实际依赖锁及 Node/OS 版本。不做全局 `npm install -g` 或 Desktop PATH 注册。
2. 在同一 runner 启动 loopback mock，先验证真实 `dsh --profile headless` 一次文字/tool round trip。直接调用局部 `lib/bin.js`；所有环境通过 spawn 的 `env` 传递。该阶段只证明模型 transport 与 shell 可运行。
3. 用正式 `dsh --profile web --patch <fixture.yml> --no-open --host 127.0.0.1 --port <owned-port>` 启动真实长驻 runtime，加载生产 bridge。插入插件可使用受控绝对路径/file URL；不改上游代码。patch 的 `config` 是完整替换，不能当深合并。[外部插件与 patch 语义](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/README.md)。
4. 用测试专属驱动插件/官方 API 创建两个真实 Agent；crosschat 通过生产 bridge 发现完整 ID，投递 idle、queue、steer，并让真实模型 shell 调用 crosschat 回信。测试驱动只创建/观测对象，不承担生产投递逻辑。
5. 按 session/nonce 选择 mock 响应；标题等辅助请求单独识别或显式关闭。用受控模型等待点验证 queue/steer 的实际 step 边界，验证超时、重复 request、目标消失、插件卸载、运行进程退出，不依赖 sleeps 猜测状态。
6. 每次结果绑定新 run ID、进程退出码、完整 tool/runtime 版本、桥 schema、实际 UI/runtime 覆盖范围与清理结果。fixture 自己的新鲜证据缺失、进程超时或 teardown 不确定均不能用旧 PASS 填补。

该顺序先取得 CLI/Web 的真实 runtime 证据；SDK/headless 的新建会话通过，不能冒充已 attach 用户正在运行的 Web/Desktop 会话。Desktop 仍需要独立正式包实际 UI、插件安装、重启及卸载验证。

fixture 可设置 `DSH_TELEMETRY_DISABLED=1`；默认 base 也有 `session-log-deepseek` request metadata 与辅助标题请求。前者随 Messages 到本地 mock，不是另一条推理通道；若为缩小 fixture 禁用，应记录与默认配置的差异。不要调用 web_search、账号登录、更新下载或工具自主安装。[默认组合与 telemetry 开关](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml)、[session-log metadata](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-log-deepseek/README.md)。

## Desktop 与清理的实施阻点

`DSH_DESKTOP_USER_DATA_DIR` 是官方开发 launcher 消费的变量，最终变成 Electron `--user-data-dir=<path>` 参数；正式 main 没有读取这个变量。正式包是否接受该 Electron 参数、是否正确隔离所有 browser 数据，还须实际验证。[开发 launcher](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/dev.ts)。

正式 main 启动会调用 `app.setAsDefaultProtocolClient('dsh')`，因此仅隔离 DSH/HOME/APPDATA 不能保证没有 Windows registry/OS protocol 副作用；该行为无正式包 opt-out。安装器也声明 `dsh` scheme。[正式 main](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/src/main.ts)、[打包 protocol 配置](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/electron-builder-config.mjs)。

Windows 官方卸载器清理 Electron userData/product/updater cache，但明确保留 Harness home 的 sessions/settings/credentials/plugins；被锁住的残留不会令卸载失败。它也不负责撤销用户手动安装的 `dsh` 命令 PATH 注册。关窗可能只是隐藏，不能当作 Host 已退出。[卸载源码](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/installer/uninstall.nsh)、[原生残留处理](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/installer/uninstall-data.h)、[Desktop 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#closing-the-window-and-quitting)。

本机前一轮已有自动审批拒绝清理的记录。后续不能通过新 CI helper、原生脚本或其它 registry API 绕过拒绝。建议当前先做局部 npm/Web runtime；桌面正式包生命周期放干净 CI runner 或另一个明确隔离的用户环境。无论在哪个环境，都要保存安装前 baseline，正常退出本次精确 app/Host PID，执行本次官方卸载器，再根据 ownership receipt、绝对路径、哈希和前后差异清理本次文件；失败保留证据并明确列出残留。该建议是本项目的验证策略，不是上游保证。
