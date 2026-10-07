# 实地反馈归档（2026-10-07）

三份一手反馈：aio-cube 项目两份 agent 使用报告 + 用户 win/WSL 亲手实测全记录。定性统一按 B2.2 复现实验终裁表述。关联：[联邦 localhost 真机验证](federation-localhost-verify-20261007.md)、[win↔WSL 联通测试](federation-wsl-connectivity-20261007.md)。

## 一、aio-cube 实地使用（两份 agent 报告）

**报告 A**（5 次发送，claude↔claude）：

- 1 次失败（人因）：手抄 reply-hint 里长 conversation ref 抄漏 base64 段 → `CALLER_NOT_IN_CONVERSATION`，按 skill 预案改 `--to` 后成功，之后全程 `--to` 零失败
- 其余全部正常：投递 5/5、异步唤醒即时、无 MESSAGE_TOO_LARGE / RATE_LIMITED；对端 codex daemon 挂着无影响（本次两端均 claude）
- 观察：信封 reply-as 显示名与会话名编号漂移（重启致 27↔73）——名字寻址下无实际影响

**报告 B**：

- `TARGET_NOT_FOUND` ×2，同根因：后端会话中途重启换实例，信封 ref 钉死旧实例 session id——"到货即过期"；两次均按 skill 兜底规则改 `--to` 自愈，轮次连续无损（1→5→7→8→10）
- 未遇到 RATE_LIMITED / MESSAGE_TOO_LARGE / 身份冲突 / codex 锁类
- agent 沉淀的纪律（与 skill 教学一致）：回复优先最新来信的 from-name；`--to` 也失效时跑 status 重寻址；常重启会话建议复用稳定名

## 二、用户亲手实测（win + WSL，联邦验收）

**通过项**：

- 跨机 ssh 链路收发多轮 delivered；win claude 收件腿经 sshd 会话实测可达（AF_UNIX 约束确认仅限 codex 侧）
- human 手敲发起 → `CANNOT_REPLY_TO_HUMAN` 按设计生效（单向），`--to` 兜底自愈
- `NAME_NOT_FOUND` 同码透传 `[via host]` + 远端可用名清单回显，引导清晰
- `SSH_TRANSPORT_FAILED` 两例环境问题自证闭环：`ssh-keyscan -p 2222` 播种非标端口 host key；`wsl -u root` 直写 authorized_keys 解鸡生蛋
- README 风格题词（角色+任务，不含逐字命令）驱动 agent 自主完成 status→send→验收全流程

**发现并修复的真缺陷**：

- **B8**（commit 87a5afe）：`--origin` 只带显示名/id8、完整 id 未过线 → 跨机信封照抄回投必失败。修复 = origin 全 id 过线 + 缺陷回归用例锁定

**误诊与终裁（B2.2，复现实验推翻"盖章方向 bug"预设）**：

- 曾据 ref 解码双 `m=yang` 判"盖章盖错"；复现实验证明盖章代码正确——该对话本为 WSL 本地对话，双 yang 是正确数据
- 跨机回投失败样本终裁均另有根因：**B8 前 id 缺陷 / human 单向 / claude 会话退出之陈旧端点**（status `claude: (none)` 为铁证）
- "跨机 ref 回投不可用属预期"为**错误定性**，不得入档传播；**跨机主路径（双方存活 + 全新对话 + 照抄回信）尚待干净复测点亮**

## 三、工程响应（本批 B3 落地项）

- `TARGET_NOT_FOUND` / `CALLER_NOT_IN_CONVERSATION` 错误文案补 `--to` 自动接续自愈指引与"跨机对端用 ssh 查"提示
- README 联邦节 + 部署折叠节（含全部实测坑）；SKILL.md 三行跨机教学；FAQ 两问（status 本机性 / 稳定命名）
- CI mac 观察位
