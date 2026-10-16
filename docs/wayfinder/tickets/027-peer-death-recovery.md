# 对端死亡恢复链：TARGET_NOT_FOUND 报错给可照抄地址 + 两形态教学

label: wayfinder:design
status: open
blocked-by: （无——2026-10-16 现场 drill 复盘：cloudworker12→cloudbroker13 接任场景七步试错）
claimed-by: （待领）

## Question

云端会话 cloudbroker12 退出、cloudbroker13 经 `--extend-session` 接任后，本机 cloudworker12 再问一个问题走了**七步试错**（conversation 失败→裸名失败→help→星名歧义→点名→两段式失败→三段式达）。逐步复盘：每个报错都给对了下一跳，但整链太长——恢复链的最优路径（旧名三段→SUPERSEDED 指路）两跳可达，却没有任何一个教学面指向它。

真查两处病灶：

- `src/commands/send.ts:472` TARGET_NOT_FOUND（本机解析对端死进程）：教学只给 `--to 名`（单机路径）与 ssh 枚举（"跨机对端用 ssh crosschat status 查"）——**tcp 对话被教去走 ssh**；且该点手里就有 ref 的星+机器与会话记录的对端名，三段地址可直接拼出
- `src/resolve.ts:128` TARGET_NOT_FOUND（对端机解析死成员）：教学只说"改用名字投递"，没说名字三段重投会触发 SESSION_SUPERSEDED 指路接任者

另一根源：`--help` 的 `--via` 说明只有机器级形态（`--via tcp:<机器>`），三段直达会话这个跨机投递唯一正解不显眼；而 ssh 跨机合法形态恰是两段式（`--via ssh:host --to 名`）——**形态不对称**是 session 拿 ssh 套 tcp 猜测的根源。

## 方案（四项）

1. **A+ 报错直接给可照抄地址**（两处 TARGET_NOT_FOUND 升级，"报错给可照抄命令"哲学的延续——同 NAME_COLLISION/SUPERSEDED）：
   - send.ts 侧：对话为 tcp（ref 带星+机器）时，教学行拼出 `tcp:<星>:<机器>:<对端名>` 完整三段旧名地址照抄即发，并注明"旧名有接任者会报 SESSION_SUPERSEDED 给出接任地址"；ssh 对话保持 ssh 教学；单机对话保持现 `--to` 教学
   - resolve.ts 侧：教学行补"用会话名三段重投；有 extends 接任者将报 SESSION_SUPERSEDED 指路"
2. **B help 并列两形态**：`send --help` 的 via 说明同时给出 tcp 三段（会话直达）与 ssh 两段（`--via ssh:host --to 名`），标注各自适用——消除猜测源
3. **C skill 恢复配方一句**（会话纪律节）：跨机对端死亡（TARGET_NOT_FOUND）→ 拿旧信封 from-addr 或三段旧名重投 → SESSION_SUPERSEDED 指路接任者 → 照抄接任地址投达；两跳闭环，先 status 点名是下策
4. **D 022 协同注记**：022 多星落地后机器段歧义与星选择面变化，本票教学行与 E/F 展示面随 022 开工时复核（本票不预改）
5. **E status 标注非本星成员**（星域限定措辞，022 防返工）：`status --via tcp:<星>:<机器>` 远端会话行对未入星会话标注（如 `非成员(裸起)`）——根治"预检绿灯、投递红灯"的视图错位（drill 坑 3）
6. **F tcp 报错回显带完整星段**：现 SESSION_NOT_MEMBER 等回显只打 target 丢 selector（星名），被误读为"地址被误拆"（drill 坑 1 复盘：解析其实正确，是显示缺陷）
7. **G 引用续线语义钉死**：c16 能续到重启同名新进程=引用按名字在对端机解析（ambient 味道但限于会话线）——加测试钉成预期行为，防将来被误"修"或误收紧；C 配方写明两失效模式的精确边界（真死→TARGET_NOT_FOUND 走 SUPERSEDED 链；同名活→引用直达不看星籍）
8. **H 裸恢复检测提示**（2026-10-16 拍板：显式优于隐式，不自动续籍）：聚合器扫到"活着的裸会话名字/ID 匹配近期死成员"时打一行提示（adopt/启动式 resume 两条路）——忘了用启动器时系统提醒，不代投、不碰"死的除名不复活"不变量
9. **I 启动器 --resume 透传查验**：`crosschat claude --connect <星> --resume <id>` 一步到位是否可用——透传则教学一句话，没透传则一行级小改

## 明确不做（防过度）

- 单跳 SUPERSEDED（报错时直接查接任者）：extends 知识在 broker 侧，错误路径跨层查询——省一步不值耦合
- 自动改投接任者：静默重定向违背 extends 显式信任语义
- 裸 `tcp:<机器>` 智能消歧：错误已教学；022 后星/机器语义待变，预改白做
- **同 ID/同名裸 resume 自动续籍**（2026-10-16 讨论定案）：违背"死的除名不复活"不变量（018 测过）、多星下不知该续哪颗、且建立在 claude 版本相关的 id 行为上——显式声明（启动器/extend/adopt 三口）是信任模型，痛点由 H 检测提示兜
- 远程 adopt（跨机改对端状态）：安全面新开，不做

## 预算与停止条件

- 规模 S 票 ≤100 行（两处报错文案 + help 文案 + skill 一句 + 测试断言更新）；随下版车，不单独发版
- 停止条件：npm run check 全绿；测试——tcp 对话死进程报错含拼出的三段旧名地址、单机/ssh 对话教学不回归；help 含两形态
