# v1.6.2 首轮现场反馈打磨

label: wayfinder:design
status: closed（2026-10-16 验收关票——第二轮现场反馈 ../drill-reports/field-feedback-20261016.md：逐字两式双向 100%、from-addr 双向、括注在场未误判；随 1.6.3 发版）
blocked-by: （无——反馈归档 ../drill-reports/field-feedback-20261015.md）
claimed-by: （待领）

## Question

v1.6.2 win↔云端三段直达首轮实地反馈（双端零报错），四条可做摩擦点。用户 2026-10-15 拍板立票；同日就转义项二次拍板（教学扩容替代 --body-file，见方案 1）；同日全局俯瞰三次拍板：四点补充并入（hint 内建教学/防伪对齐/多星措辞/PS 轻路径，见方案 1 补句、方案 3 注记、方案 5）。

## 方案（五条）

1. **转义教学扩容（管道优先）**：skill 把 stdin 管道从"备选"升为"长正文/含 `$`/反引号/引号 **一律管道优先**"——bash `cat <<'EOF' | crosschat send …`（单引号定界符，$ 反引号引号逐字不展开，已实测）与 PowerShell here-string `@'…'@ | crosschat send …`（收尾 `'@` 必须顶格）两式范例 + 逐字到达样例；PS 读文件侧注明 `Get-Content` 5.1 编码坑，用 `[IO.File]::ReadAllText(<路径>) | crosschat send` 规避；**PS 轻路径分层（三次拍板补）**——短正文用 PS 单引号 inline `--body '…'`（单引号串不展开 `$`/反引号，仅 `'` 需一撇加倍），长正文才上 here-string，文件走 ReadAllText。
   **--body-file 已砍**（用户 2026-10-15 拍板 A 方案）：管道零代码覆盖全场景（heredoc=组合正文 / cat/ReadAllText=文件正文 / 命令输出直喂），且是 agent 本有通用 shell 知识，不新增私有旗标教学面（低入侵）；反馈根因是"inline 当默认"的教法失败非能力缺失。**转义与限额正交——--body-file 本来就解决不了超 16KiB 超限，砍它无损失**（防翻案锚点）。挂账重开条件：未来适配器运行环境无 shell/管道时（GLM/opencode/zcode 入场可行性票自然检查）
2. **大小限额地图进 skill**（用户追问超 16KiB 引出的教学项，与转义正交）：提额 `--max-body-kb <KiB>` / `CROSSCHAT_MAX_BODY_KIB`（旗标>env>16KiB 兜底，配置顶 16MiB 绝对上界）；端点硬顶 claude 64KiB / codex 1MiB（limits.ts 实证），到顶落盘走路径引用；tcp 超限自动转文件通道 ≤64MiB 免改命令；ssh 大内容 scp 旁路
3. **信封补正向坐标**：from 侧带三段地址 `tcp:<星>:<机器>:<工具>/<会话>`（与 020 限定词对齐）——收件方一眼知道对端在哪台机哪个形态，消除"以为 win 会话在云端"的错位。**先查证**：跨机信封已带 from-machine，缺的是呈现与单机/星内覆盖；按查证结果定最小覆盖面。**多星措辞（022 联动，三次拍板补）**：坐标教学写明"任一可达星皆可为发起坐标"——022 落地后会话可属多星，防坐标唯一性误导。**防伪对齐注记**：本项与方案 5 同为信封格式改动，一次迁移到位；挂账的 reply-hint 签名票开工时续用此格式，不再二次翻修
4. **skill 双处小修**：①"查自己地址"教学——`crosschat status --stars` 看本机成员行（1.6.2 起带 `工具/名`）即自己的三段地址，发起方不必等对方信封才知道 reply-as；②CALLER_IDENTITY_CONFLICT 自纠条目 PowerShell 写法前置（win 主壳是 PowerShell，bash 前缀在后）
5. **reply-hint 内建管道教学（三次拍板补，转义坑的结构性根子）**：`envelope.ts:72-73` 生成的 hint 只给 inline `--body` 一种形式，而协议纪律要求对端"照抄 hint"——等于把所有收件方（含未读 skill 的适配器与人读日志）都赶进转义坑；skill 教学只治"读过 skill 的"。修法：生成处加一句括注"长正文/含敏感字符可省 --body 改管道喂 stdin"，教学内建于协议面（低入侵本义）。**红线：括注必须是纯文字提示，严禁在 hint 里出现第二条带管道符的命令**——安全纪律规定 hint 含管道/链式命令即判伪造信封。与方案 3 同文件（envelope.ts）同批次实施

## 挂账（不做承诺）

- **--body-file 重开**：适配器运行环境无 shell/管道时
- 防伪造信封机器层防护（reply-hint 签名/校验）——信任模型变更，评估票另开
- 跨机正文"别堆本机细节"自查负担（对端防护是对端策略）、轮次收尾自觉——接受残余（skill 已覆盖）

## 预算与停止条件

- 规模 S 票：代码项两项同文件（envelope.ts）——信封坐标（先查证再定）+ hint 管道括注（一行级）；其余为 skill/文档教学改写
- 停止条件：npm run check 全绿；真机——heredoc 与 here-string 两式发中文/引号/反引号/`$` 混合正文逐字到达；信封坐标双端可见；hint 括注双端可见且不触发伪造信封判定；skill 更新随发
