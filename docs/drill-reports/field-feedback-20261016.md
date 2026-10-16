# v1.6.3/1.6.4 第二轮现场反馈（转义与恢复链）

日期：2026-10-16 · 参与端：win cloudworker12（claude）↔ cloud cloudbroker12/13（claude）

## 通过项（024/025 验收依据）

- **正文逐字无损**：bash 单引号 heredoc 与 PS here-string 两式，win↔cloud 双向，`$VAR`/`${VAR}` 未展开、反引号未执行、引号/反斜杠/中文破折号全保真——**100% 通过**
- **from-addr 正向坐标**：双向可见、自洽（含坑 4 的预期值勘误：本机星内注册名是 yang 不是 win）
- **PS 5.1 管道 BOM**：实测发现（正文首部 U+FEFF），`$OutputEncoding = New-Object System.Text.UTF8Encoding $false` 一行修，教学已随 1.6.4 入 skill
- **hint 括注**：主会话两封实收信封均带括注且未触发伪造判定；跨机往返未被误判
- **doctor 分组树**：win（多星：cloud-broker 可达 + wsl-star 不可达一眼可辨）/WSL/云端（单星）三形态全过；结论行与退出码语义不变

## 四坑（产出 027 票 + broker.md 修正）

1. **报错回显丢星段**：SESSION_NOT_MEMBER 回显只打 target 不打 selector，`tcp:cloud-broker:cloud:claude/x` 显示成 `tcp:cloud:claude/x`，被误读为"四段式无效语法/地址被误拆"——解析其实正确（parseTcpViaSpec 无误），纯显示缺陷 → 027-F
2. **掉籍不可预检**：会话裸重启（/resume）后星籍失效，但 `status --via tcp:<星>:<机器>` 列活进程绿灯，投递才撞墙——预检与投递标准错位 → 027-E（标注非本星成员）
3. **方式 2 文档过度断言**："resume 保号 → 资格不丢"建立在 claude 内部行为上，实测打脸——已改"聚合器扫描跟随"（8a68b71）
4. **会话引用是稳定通道**：三段名投递因掉籍失败时 `--conversation` 续线直达（不看星籍）——最有价值发现，语义钉死为预期行为 → 027-G/C

## 关键机理结论（讨论定案）

- 成员键=会话 ID，名字只是句柄；入星是启动器的一次性声明，裸 /resume 恢复上下文不恢复声明
- 除名双责任方：正常退出=包装器 detach，异常死亡=聚合器扫描除名
- **显式优于隐式**：同 ID/同名裸 resume 自动续籍被否决（违背"死的除名不复活"不变量、多星歧义、依赖 claude 版本行为）——痛点由检测提示兜（027-H）
- 恢复三口：启动式 /resume（日常回访正解，`crosschat claude --connect <星>` 代替 `claude`）、--adopt 收编（不重启会话）、--conversation 续线（不管星籍）
