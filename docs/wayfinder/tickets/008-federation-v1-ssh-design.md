# crosschat 跨机联邦 v1（ssh + 远端 CLI）设计

label: wayfinder:grilling
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

跨机联邦 v1 怎么落地：本机 agent 向远端机器的 agent 会话投递消息，形态 = `ssh <对端> crosschat send ...`（无 broker、同步语义、远端 CLI 全权复用本机投递栈）。零实现代码，产出设计决策与分批方案。三平台（linux/win/mac）两两全矩阵为硬需求。

须定的决策点：

1. **寻址语法**：`--via ssh:<host>` 与 `--to` 怎么组合？host 直接复用 `~/.ssh/config` 的 Host 别名（crosschat 不建自有配置层，符合"无必填配置文件"约束）还是自有别名？用户/端口/密钥非默认时怎么传（透传给 ssh 的参数面）
2. **远端执行与跨平台引号**：body 走 stdin 而非 argv（避免 win cmd/powershell/bash 三方引号地狱，且不受 argv 长度限制）；远端命令固定 `crosschat send` 还是可配；Windows sshd 默认 shell（cmd/PowerShell）下的命令解析差异——需小型研究验证
3. **回执与错误透传**：远端 delivered/parked/busy 回执、MESSAGE_TOO_LARGE 等错误码经 ssh 原样带回本机；退出码映射；ssh 自身失败（不通/超时/鉴权拒）的专属错误码与 agent 自纠指引文案
4. **同步语义与超时**：ssh 阻塞等待远端结果期间的本地超时策略；远端忙时 parked 回执即返回（不等看门狗投完）——与单机语义对齐确认
5. **跨机回复路径**：信封自带回复命令必须带回程 `--via`（收到的远端 agent 照抄即可回复）——信封模板增量；显示名/会话列表跨机呈现的最小集
6. **maxBodyBytes 可分离性**：本地 16K 检查在 send 入口，联邦时远端检查照样生效——v1 是否根本不需要新上限机制（上限由远端投递路径决定）；"用满 codex 1M"的增强与联邦解耦，单列小项
7. **skill 文案增量**：发送方 agent 怎么被教会跨机投递（信封自带命令照抄原则不变）
8. **部署清单成文**：三平台矩阵一次性步骤（密钥/开关/PATH 坑，地图约束已录）→ README 或独立部署文档
9. **零回归验收标准**：不碰单机 send 默认路径的判据；`--via` 缺失时行为与现在字节级一致
10. **分批方案**：建议形态（如 B1 寻址+远端执行 → B2 回执透传+错误码 → B3 文档+联调矩阵），衔接 subagent 编排模式与零回归铁律

约束（已入地图站定性，2026-10-06）：无 broker、无新监听端口、无新守护进程、无必填配置文件、不发明新鉴权（信任边界=ssh 同用户，机器通道密钥与密码登录共存）；mac 实机验证是 M 腿依赖；embassy 生态互通评估（Q9）**不在本票**范围。
