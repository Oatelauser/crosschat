# 命令总表

九个命令的完整旗标面。一句话地图见[第1课 1.3 命令总览](../tutorial/lesson-1/03-command-map.md)；本页是逐命令的旗标与语义全量。

## send

```bash
crosschat send --to <名> | --conversation <cN|mc1_|mc2_> [--body <文本>]
               [--max-body-kb <KiB>] [--max-turn <N>]
               [--via ssh:<别名> | tcp:<星>:<机器>:<会话>] [--file <路径>]
```

| 旗标 | 语义 | 备注 |
|---|---|---|
| `--to <名>` | 收件人：全名精确 → 唯一前缀 → id8（codex 未命名） | 与 `--conversation` 互斥 |
| `--conversation <cN\|ref>` | 续话：短柄或完整引用，照抄信封 hint | 同名即续的替代路 |
| `--body <文本>` | 正文 inline | 缺席则读 stdin（管道首选） |
| `--max-body-kb <KiB>` | 本条提额 | > 环境变量 > 默认 16KiB；非法静默降级 |
| `--max-turn <N>` | 本条轮次预算 | 进信封 turn="N/M" |
| `--json` | 单行 JSON 回执 | 机器可读 |
| `--via` / `--file` | 跨机形态 | ssh/tcp 语义见[第2课](../tutorial/lesson-2.md)/[第3课](../tutorial/lesson-3.md)；单机 `--file` 不存在（USAGE 拒绝） |

回执三态 delivered / queued / parked 皆 exit 0；错误码见[错误码总表](error-codes.md)。

## status

```bash
crosschat status [--json] [--conversations] [--claude|--codex] [--name <子串>]
                 [--all] [--via tcp|ssh] [--via tcp:<机器>] [--stars]
```

裸跑 = 三段式摘要；任一过滤旗标 = 明细视图；`--conversations` = 逐对总览（`--via` 限跨机过滤）；`--stars` = tcp 星内明细（[第3课](../tutorial/lesson-3.md)）；`--via tcp:<机器>` = 远程枚举（tcp 专属）。互斥规则：`--claude/--codex` 不与 `--conversations`；裸 `--via` 仅配 `--conversations`；`--stars` 仅配 `--json`。

## doctor

```bash
crosschat doctor
```

无旗标。三级严重度：✅ / ⚠️（合法状态与提示，如未装 codex、daemon 未跑、skill 旧了）/ ❌（退出码 1）。分组树：环境 / tcp·<星> / 其他。详见[环境搭建·doctor 自检](../preface/04-env-setup.md#doctor-自检)。

## install-skills

```bash
crosschat install-skills [--dir <根目录>]
```

把协议教材整树复制进 `<根>/.claude/skills/crosschat` 与 `.codex/skills/crosschat`（默认根 = 用户主目录）。幂等覆盖，不删除多余文件；doctor 会与安装源递归比对。

## claude / codex（启动器）

```bash
crosschat claude [-n <名>] [--max-body-kb <KiB>] [--max-turn <N>] [--connect <星> …] [原生参数…]
crosschat codex  [           同上旋钮             --connect <星> …] [原生参数…]
```

原生参数（含子命令）原样转发；claude 侧自动注入接收开通设置（用户自带 `--settings` 报 SETTINGS_CONFLICT），codex 侧零设置注入；两旋钮剥离后写进子进程环境变量（非法值当场报错，与 send 侧静默降级有意相反）；对族身份变量随启动清洗。`--connect`/`-n` 星成员语义见[第3课 3.5](../tutorial/lesson-3/05-join-address.md)。

## serve / clean / uninstall

| 命令 | 一句话 | 详表 |
|---|---|---|
| `crosschat serve` | tcp 星的起停/入网/收编——跨机传输形态 | [第3课 3.4](../tutorial/lesson-3/04-star-setup.md)（旗标全量待 tcp 专家表） |
| `crosschat clean [--force]` | 清 tcp 收件残留 + 回收 30 天未动的对话分片；`--force` 全清免确认 | 本页下段 |
| `crosschat uninstall [--yes]` | 删 `~/.crosschat` 全部状态与两侧 skill（serve 在跑时拒删） | — |

clean 细节：默认懒规则——收件/断点文件超 5 天删、收件总量超 512MiB 从最旧删起、分片 30 天未更新回收（恰好 30 天仍保留）；执行前打印将删明细。

<!-- serve 旗标全量表（--port/--name/--gen-key/--list/--remove/--connect/--detach/--adopt/--member-remove/--stop/--rm）：待 tcp 专家补 -->
