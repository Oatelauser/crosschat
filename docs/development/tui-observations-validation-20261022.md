# TUI本机观察资源验收

2026-10-22。用户授权T08并要求正常开发、不赶时间、既有功能变化先确认。分支`codex/core-refactor-pre-tui`，基线`a29d043`（1377通过/11跳过）；最终产品`13189bf`、ConPTY工装`b24071f`。合同见[观察资源规格](tui-observations-spec.md)，使用见[终端界面](../tui.md)。

## 交付与授权边界

- status、doctor、deliveries、outbox、logs默认接入已选本机；ctx启动不自动运行观察查询或体检。status组合六类已有证据，不把配置当认证，也不探测全部远端。
- doctor复用已有检查、严重度和CLI格式，独立进程拥有探测树与超时。TUI提供逐项解释/只读指引，不自动修复；默认保留原生环境覆盖，显式隔离HOME绑定全部读取来源。
- 通信对/队列提供安全元数据和已有完整引用，不呈现聊天正文、不补投/重试、不生成短柄或修改存储。未知数量、坏/超大来源、近期审计窗口均明确标注。
- 日志来源选择、跟随、暂停、筛选、轮转和全文安全复制使用同一声明式交互。关联路由携带完整会话引用/通信对，命令清范围、返回恢复定位。通用controller/UI不添加Provider分支。
- 原CLI选择器、存储writer、watchdog写入/补投、诊断判定/退出码和清理规则保持。本项没有另行扩展既有功能；SSH/TCP业务与服务维护操作仍按剩余任务等待指令。

## 自动检查

Windows，Node25.0.0、npm11.6.2、PowerShell7.6.5。普通检查显式清除`CROSSCHAT_LIVE`；使用临时目录、注入原生依赖/安全DTO和受控本机子进程/WS。没有读取真实原生会话、钥匙或用户剪贴板，没有连接真实SSH/TCP目标。

最终`npm run check`于2026-10-22 13:59:15（UTC+8）进入Vitest，完整命令退出0：

- ESLint通过，TypeScript构建通过。
- 实际运行时导入图128模块、390边，无循环或跨层违规。
- Vitest **1447通过、11跳过**；115文件通过、3文件跳过。跳过均为既有live项，没有跳过本轮失败测试。
- 输出保留在`%TEMP%/crosschat-t08-check-20261022-final.txt`。

此前准备执行全仓检查时，新增ConPTY脚本缺少`node:url`的URL导入，lint在测试前阻止继续；补齐导入后最终完整命令通过。普通定向失效场景先保存RED再修复，不以重复扩大测试替代缺陷定位。

## 独立审查与回归证据

| 边界 | 已验证行为 |
|---|---|
| 元数据只读 | 当前通信存储/分片只读合并，已有ref核对端点；队列不返回envelope/claim，快照前后文件保持，坏/大文件条数未知 |
| 精确关联 | via记录复用完整ref归对；同名、前缀、跨工具或机器不明的同原生ID不串入本机；多caller队列不扩大关联 |
| 来源局部失败 | 节点日志目录坏掉仍保留可读投递日志；partial配置显示已观察数/未知，不能将损坏配置显示成确数零 |
| 日志身份 | Unicode/CRLF按字节定位；重复文本ID不同；追加保留身份；替换/观察缩短换代；Windows大文件ID使用BigInt无损值 |
| 日志边界 | 默认64KiB/最近1000行，超长边缘片段不提供复制；只接受登记来源，读取前拒链接和特殊文件；已知秘密/IPC信息隐藏 |
| 诊断来源 | 显式HOME读取有界registry/outbox/watchdog/skills；坏/超大来源安全失败，原CLI默认读取/判定保持；子进程IPC形状/严重度校验 |
| 实际watchdog格式 | 当前writer三字段锁正常识别；只返回PID/心跳，owner token不进入DTO，原文件不变 |
| 默认环境 | 默认main保留原生home覆盖；显式home默认隔离；受控fork回传fake环境验证，不探测真实原生源 |
| 取消与owner | 切页/上下文/非列表模式中止watch，迟到publish不覆盖；未配合读可取消；doctor取消/超时回收真实受控探测进程树 |
| 零行和帮助 | i允许零行，帮助共用动作登记，来源选择可查全文/复制；不能复制不存在的引用，未实现动作显示原因 |

检查点详见[续接记录](tui-progress.md)。日志链接用例最初尝试临时文件symlink，本机Windows无此权限；最终注入lstat链接元数据并保留真实临时文件字节验证门禁，未声称实际创建了Windows文件符号链接。macOS/Linux特殊文件不在本轮真实终端实测范围。

## Windows真实终端

最终产品构建完成后运行三组ConPTY工装，共九场通过；运行期间没有并发build改写dist。真实TTY子进程验证输入、输出和终端恢复；原生发现、status/doctor数据、剪贴板和写入接口为注入fixture，日志读取使用临时真实文件。

| 工装 | 最终证据目录 | 结果 |
|---|---|---|
| `tui-observations-pty-validation.mjs` | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-observations-validation-4d9zJu/` | 全链键盘/resize退出0、ctx无读Ctrl+C退出0、受控异常退出1 |
| `tui-pty-validation.mjs` | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-validation-dNsJlz/` | 原外壳键盘/resize、Ctrl+C与异常恢复三场通过 |
| `tui-sessions-pty-validation.mjs` | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-sessions-validation-ncoPBE/` | 原会话筛选/册位表单、读取取消与异常恢复三场通过 |

观察主链验证：ctx→sessions→status→sessions→deliveries→outbox→deliveries→logs，逐次核对完整SessionRef/pairId；已保存续话ref、镜像路径和完整Unicode长行复制；来源选择器详情；Space暂停/恢复、上滚暂停、End最新；零匹配期间后续匹配行继续出现；重复行offset/追加身份稳定、文件轮转新身份；doctor取消及r重跑；100×28↔24×12↔48×16窗口。

每场验证raw、resize和应用信号监听回到Ink暖机基线；主屏、光标、括号粘贴恢复，不删除其他owner监听，不回显私密fixture内容。事件和原始终端输出为目录内同名`.jsonl`与`-pty.jsonl`。

首轮观察工装在等待复制提示时失败，但注入clipboard事件已收到完整1236字Unicode值：立即恢复的日志快照会更新notice。工装改以实际复制事件及完整值验收，随后三场通过；没有把瞬时提示当成持久通知承诺。首轮目录`crosschat-tui-observations-validation-HvTHAa/`，预跑通过目录`...-Uk8Twn/`，均保留且不充作最终构建证据。

本轮未执行真实原生会话/远端live操作或macOS/Linux实际终端验收；未把mock结果描述成这些环境已验证。

## 任务清理

T08活动行、说明和依赖引用已删除，临时任务规格转为长期观察规格；AGENTS、map、API、使用与续接记录同步。各代理均停写，由root集中提交。T09—T12、T14保留并等待用户指令。其他会话的README修改和四份研究草稿保持原状。
