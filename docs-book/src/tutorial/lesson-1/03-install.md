# 1.3 安装

安装的目标只有一个：跑完本节，`crosschat doctor` 给出全绿或只有警告的自检报告。doctor 是 crosschat 自带的环境体检——装得对不对、缺什么、下一步该干什么，它一条命令说清。

## 装 Node.js

crosschat 是 npm 包，先要 Node.js **22 或更高**。去 [nodejs.org](https://nodejs.org) 装 LTS 版（写作时为 22.x），装完验证：

```console
> node --version
v25.0.0
```

✅ 判据：版本号 ≥ 22。Linux 一行带过：`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`，或用你发行版的 Node 22+ 包。

## 装 claude CLI

```bash
npm install -g @anthropic-ai/claude-code
```

装完要过账号墙：浏览器登录 Anthropic 账号（或配 API key），按 [官方文档](https://code.claude.com/docs/en/setup) 走。最小验证：

```console
> claude --version
2.1.301 (Claude Code)
```

## 装 codex CLI

```bash
npm install -g @openai/codex
```

同样过账号墙（ChatGPT 账号或 API key，见 [官方文档](https://developers.openai.com/codex/)）：

```console
> codex --version
codex-cli 0.160.1
```

codex 还有一个属于它自己的常驻件——app-server daemon（crosschat 给 codex 投递靠它）。现在不用手动起，doctor 会替你查、缺了会告诉你怎么补。

只装一家可以吗？可以。纯 claude 机器、纯 codex 机器都是合法形态——doctor 对"另一家没装"只给警告不给错误，后面用到哪家再装哪家。

## 装 crosschat 与 skill

```bash
npm install -g @oatelauser/crosschat
crosschat install-skills
```

第一条装 CLI；第二条把协议教材（skill）装进 claude 与 codex 的技能目录——**不装 skill，agent 收到消息不知道怎么回**。这是低入侵设计的一半：crosschat 不改 agent 的题词，协议用法由 skill 就地教给每个会话。安装是幂等的，重复跑只会覆盖成同一份内容：

```console
> crosschat install-skills --dir C:\Users\you\AppData\Local\Temp\crosschat-book-demo
installed: C:\Users\you\AppData\Local\Temp\crosschat-book-demo\.claude\skills\crosschat
installed: C:\Users\you\AppData\Local\Temp\crosschat-book-demo\.codex\skills\crosschat
```

（上面用 `--dir` 装进了临时目录演示；不加参数默认装进你的用户主目录，输出形似 `installed: C:\Users\you\.claude\skills\crosschat` 两行。）

验证版本：

```console
> crosschat --version
1.6.4
```

## doctor 自检

用途：一条命令体检全部依赖——Node 版本、两个 CLI、daemon、skill 一致性、身份环境、发件箱。任何一项 ❌ 都会让退出码变 1，所以它也是后面写脚本、装新机时的标准自检。

```console
> crosschat doctor
环境
  ✅ Node v25.0.0 (≥22)
  ✅ claude CLI C:\Users\you\AppData\Roaming\npm\...\claude.exe；可路由会话 4 个
  ✅ codex CLI 0.160.1
  ✅ codex daemon 0.160.0
  ⚠️ claude 侧 skill 与安装源不一致（SKILL.md、references/advanced.md、references/errors.md）；重跑 crosschat install-skills
  ⚠️ codex 侧 skill 与安装源不一致（SKILL.md、references/advanced.md、references/errors.md）；重跑 crosschat install-skills
  ✅ 无双身份残留
tcp · cloud-broker
  ✅ 节点条目可解析
  ✅ broker 可达（118.196.47.9:7777）
  …
其他
  ✅ 发件箱空（无暂存消息）
结论: 10 项通过，2 项警告，1 项错误
```

（实录摘自写作机器：tcp 星的几行是第3课的内容，你装完大概率没有这一段；⚠️ 是 crosschat 升级后 skill 没重装的真实样子——照提示重跑 `install-skills` 即绿。）

隐式发生什么：三级严重度各有含义——**✅ 通过；⚠️ 警告（合法状态或需要你顺手做的事，例如 codex 没装、daemon 没跑、skill 旧了，都只提醒不拦你）；❌ 错误（这项功能现在用不了，退出码 1）**。最容易遇到的一条：`⚠️ codex daemon 未运行；要用 codex 通道时先执行: codex app-server daemon start`——照抄执行就好：

```console
> codex app-server daemon start
{"status":"started","backend":"pid","pid":35652,...,"cliVersion":"0.160.1","appServerVersion":"0.160.0"}
```

doctor 与 status 是一对搭档，各答一个问题：**doctor 答"环境为什么通/不通"**（依赖、版本、配置——查的是因），**status 答"现在有谁、消息到没到"**（名单、对话、滞留——查的是果）。环境报 ❌ 先 doctor，行为奇怪先 status；两条命令入口处都会顺手补投滞留消息（[1.5](05-mechanism.md#一条-send-的旅程)）。

装完立一个习惯：**以后起会话用 `crosschat claude` / `crosschat codex`，不裸敲 `claude` / `codex`**。它们原样转发你熟悉的一切参数，只多做了两件事：让这个会话能收消息（裸启动的 claude 收不到，原因 [1.5 claude 腿](05-mechanism.md#claude-腿注册表与管道)讲），以及清理容易打架的身份环境变量。第一课到此，装备齐了——[1.4 第一次对话](04-first-chat.md)开始说话。
