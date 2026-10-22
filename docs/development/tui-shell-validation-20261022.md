# TUI外壳验收

2026-10-22。用户授权任务T06，起点`f03a4ac`，最终产品验证基点`108c6c0`，分支`codex/core-refactor-pre-tui`。按用户要求正常开发，无时间截止；未实施后续业务资源。

## 交付与边界

- 单npm包，Ink8/React19按需加载；新增`crosschat tui`。普通CLI帮助/版本及`tui --help`、无效参数经阻断TUI加载的真实ESM loader回归通过；非TTY在读配置/加载Ink前退出。
- ctx只读本机/已有SSH/TCP配置，支持重新读取，来源失败为partial，完整错误和下一步进入只读详情。记忆显式选择，不自动进入、认证、探测或修复配置。
- 连续表格、命令补全并筛选完整字段、Unicode显示格硬上限、未知原生状态中文加raw、详情/帮助全文滚动、完整值复制、稳定选择/返回。
- 资源/按键/能力共用登记，通用页面无Provider分支。共享表单固定连接/目标，双重核验、默认取消、核验状态、完整影响/错误滚动、失败留值、新结果选择和已发请求取消待核实。
- 会话、status/doctor、服务、SSH/TCP真实资源仍显示尚未启用；TUI不代理原生聊天。现有核心功能未扩大，CLI原有分支保留。

## 自动检查

Windows，Node25.0.0、npm11.6.2、PowerShell7.6.5。普通检查显式移除`CROSSCHAT_LIVE`，配置/用户目录和进程均使用隔离fixture。

2026-10-22 11:44:11（UTC+8）运行`npm run check`，退出0：

- ESLint通过，新增应用/TUI代码启用类型导入和Promise规则。
- 运行时依赖图114模块、317边，无循环或边界违反。
- TypeScript构建通过。
- Vitest 1304通过、11跳过；97文件通过、3跳过。跳过项属于既有live验收，未用它们声称真实资源已接入。

完整输出：`%TEMP%/crosschat-t06-check-20261022-final.txt`。基线1114通过/11跳过，本次增加190项通过场景；数量不作为验收替代。

关键失效路径已先RED后GREEN：挂起mount退出、剪贴板失败子进程回收、Windows UTF8复制、快速输入与Enter合并、秘密回显、迟到读取/写入、失效context不得误作本机、配置刷新偏好误写、原型名称kind、长错误后编辑焦点、新建结果被筛选隐藏。

剪贴板编码另通过真实`powershell.exe`受控函数验证中文、emoji、组合字符及字面shell字符的完整输入；替换了Set-Clipboard输出目标，未改用户真实剪贴板。

## Windows真实终端

最终执行`node test/helpers/tui-pty-validation.mjs`，退出0。ConPTY创建真实TTY子进程；临时HOME、静态Provider/资源、假的剪贴板/业务写接口，不访问真实会话或连接远端。

| 场景 | 实际动作与证据 | 结果 |
|---|---|---|
| keyboard-resize | 同一输入批次`:s`/`j`+Enter；粘贴q不退出；SSH身份未认证；完整ID筛选/返回；长详情滚动复制；长影响滚到IMPACT-END；确认只写固定目标 | 子进程0、host0 |
| 窗口变化 | 100×28→24×12→100×28→48×16→100×28；24×12下粘贴/确认不得提交隐藏表单，取消后正常表单仅提交1次 | 实际resize事件及mutation计数通过 |
| read cancel | pending只读请求Ctrl+C触发AbortSignal，界面仍可切回ctx并正常退出 | 通过 |
| ctrl-c | 无读取时Ctrl+C退出 | 子进程0、host0 |
| process-failure | 受控uncaughtException，秘密错误原文不回显 | 子进程1、host0 |

每场核对raw恢复、输入/resize/应用信号监听归还、cursor显示、bracketed paste关闭及退出alternate screen。Ink依赖restore-cursor首用会安装一个模块级退出光标guard；工装先以无业务Ink mount/unmount建立该基线，再断言TUI会话不增加残留。未删除其他owner监听或修改node_modules。

最终证据目录：`%TEMP%/crosschat-tui-validation-7muc7z/`，含三个`*-pty.jsonl`原始终端/输入日志及对应fixture JSONL。ConPTY自测还验证80×24→40×12、中文😀输入和dispose只回收自有子进程。

本次真实终端覆盖Windows ConPTY；未声称其他操作系统或真实SSH/TCP业务链已验收。后续资源任务继续独立验收。

## 任务清理

已删除T06活动行、说明段落、批次和剩余任务依赖；临时任务规格转为长期外壳规格，证据保留于本文与提交。剩余T07—T12、T14等待后续指令。
