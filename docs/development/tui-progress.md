# TUI 续接记录

2026-10-22。分支`codex/core-refactor-pre-tui`。T06起点`f03a4ac`，核心基线1114通过/11跳过。

## 当前授权与下一步

- 用户已明确“开始实现T06”，并要求正常开发流程，不赶时间/进度。该项已于2026-10-22完成验收并删除。
- 此前TUI资源已完成验收并删除活动项。用户现授权T11/T12并行，正常开发、不赶时间，涉及现有功能变化先确认。T14仍等待指令。
- 本轮明确批准：新增doctor --json供SSH逐项诊断；无参doctor输出/检查/严重度/退出码保持，远端失败不回落本机，不做混版降级。
- 两项明确获批功能扩展：按完整SessionRef精确收编；broker原子核对完整ID/机器/工具的精确删册，目标变化即拒绝，保留原CLI选择器/权限，不做旧端兼容或降级。
- 读取顺序：本记录 → [活动任务](../wayfinder/tui-implementation-tasks.md)的当前项 → [代码规范](code-standards.md) → [外壳规格](tui-shell-spec.md)及[验收证据](tui-shell-validation-20261022.md)。
- 暂停时停止派单、收齐所有代理状态/文件/检查，保存检查点与待办；未验收任务继续保留。

## 分工与接缝

- root：唯一stage/commit；共享模型、Ink/React展示、统一集成/终端验收与文档。
- tui_controller：`src/tui/app/*`、`resources/registry.ts`及对应测试。框架无关snapshot store、统一登记、固定owner弹层/确认、异步代际。
- tui_text：文本/输入、ConPTY工装、`main.ts`/CLI动态入口及对应测试。
- tui_contexts：只读上下文、偏好、状态登记；独立审查及终端/剪贴板生命周期修复。
- 共享模型在`src/tui/model.ts`；UI通过snapshot/handleKey订阅controller，业务通过注入的read/checkAction/mutate接缝。新Provider不进入通用页面分支。

## 外壳验收（历史）

- 已读v6规格及按键表；源码位置/布局按该稿，旧稿中的底层能力缺口以已验收核心接口为准。
- 共享模型、文本、上下文/偏好、表格、controller、表单、中文状态、展示与lazy入口已落地。外壳验收当时业务adapter尚未启用；当前本机会话已接入，见下文。
- 已独立复核并修复：未决mount退出、复制子进程失败回收、Windows UTF8输入、偏好误写、未知/取消结果完整性、秘密回显、表单cursor与窄屏编辑。
- 合并快速输入与内嵌Enter已由真实Ink hook回归修复；完整帮助换行/滚动完成。完整ConPTY键盘/100×28↔48×16/正常/Ctrl+C/异常恢复首轮通过，增加24×12隐藏表单不得提交场景也通过。工装先建立Ink依赖的模块级restore-cursor退出guard基线，再验证每次TUI资源回归该基线，不删除其他owner监听。
- ctx配置可重新读取并保留partial来源/下一步到只读详情；独立审查修复动态选中偏好、失效context拒绝回落本机、新建结果被筛选隐藏，以及未知kind原型键。
- 完整表单影响/错误滚动、核验状态与错误后字段焦点均已收口。最终`npm run check`：1304通过/11跳过，97文件通过/3跳过；运行时图114模块/317边，无循环或越界。最终ConPTY三场全部通过。T06活动项、依赖与临时任务规格名已清理；无必需待验收项。
- 使用入口和当前可用范围见[终端界面](../tui.md)。其余观察、服务及SSH/TCP资源按活动队列等待后续指令。

## 外壳检查点（历史）

- `78bf202`授权/规格与首组RED；`2e62941`文本GREEN；`44c89f8`上下文/依赖GREEN。
- `f8d5d19`导航/自适应表格；`e681fd0`固定owner表单/完整详情；`4fbb58c`状态登记。
- `429c78b`ConPTY工装；`96e5b2c`展示/动态入口；`09c04cb`生命周期/偏好；`81049c7`中断/新行选择/窄表单；`bd068bd`Windows复制Unicode。
- `3e86b72`输入/帮助；`89f7abb`合并控制键；`474e93d`动态配置；`00bbd13`renderer teardown/确认全文；`4f3d5c4`最后表单滚动/核验RED。
- `a1b8d19`完整表单；`ff2edde`错误后焦点RED；`266463e`焦点GREEN；`108c6c0`极小窗口模式提示，最终全量/ConPTY验收基点。
- 每组新失效路径先保存RED再实施GREEN；最终验证环境、隔离边界及证据路径保留在独立验收记录。

## 本机会话验收（2026-10-22）

- 规格与合同：[本机会话](tui-sessions-spec.md)；完整[验收证据](tui-sessions-validation-20261022.md)。基线`cf93a33`；最终产品`4804b25`，最终检查含输入fixture修正`899725b`。
- 本机默认发现全部分页/匿名、动态工具与raw状态筛选、稳定引用、只读详情/原生指引/零行读取信息和安全复制已接入。共享controller/UI继续使用声明式资源，无Provider分支。
- 精确收编/删册应用接口已接入列表；只读列配置星，写前重新核验完整本机/星/工具/会话身份；原子删册无选择器回落。请求已发但结果不明或落盘失败显示待核实，不自动重试；原CLI选择器和权限保持。
- 已保存：`8a4bbb2/72611e0`首资源/筛选/UI；`60042d7/542f54b`取消/partial读取；`96d2624`原子精确删册协议及枚举表单；`140185d`默认main接线和确认字段保留；`26cc170/b475830/3e35350`精确册位应用层及同ID工具冲突；`7fd850c/cb909f8`地址前缀遮蔽与既有Codex20条选择边界；`a0f23f0/be65951/91ff1d5/c517fc7`显式HOME的原生proxy/SQLite隔离。
- `75b28fc/4804b25`完成独立复核发现的异步机器身份、跨Provider未知、启动选择器遮蔽、读取超时释放和落盘失败回执修复；地址和显式HOME边界也有回归证据。
- 最终`npm run check`退出0：1377通过/11跳过，106文件通过/3跳过；运行时图121模块/352边，无环或越界，lint/build通过。首轮仅一条旧输入fixture缺少有效ctx，补齐连接并验证完整route后全量通过，未跳过失败测试。
- 最终Windows ConPTY本机会话三场及外壳三场均通过，含默认取消、精确目标、小窗禁止隐藏提交、读取取消及正常/异常终端恢复。用注入原生来源及受控本机WS验证，不访问真实用户会话、钥匙、剪贴板或远端。
- 已删除T07活动行/说明及依赖引用，临时规格转长期规格；全部子代理停写，root集中提交。其余任务继续等待用户指令。

## 本机观察验收（2026-10-22）

- 规格：[本机观察资源](tui-observations-spec.md)；[完整验收证据](tui-observations-validation-20261022.md)。基线`a29d043`，最终产品`13189bf`，终端工装`b24071f`。现有CLI补投、检查判定/级别/文本、存储writer和清理保持，本项无额外既有功能变更。
- 五个真实本机资源默认安装：status六项只读组合；doctor按需进程隔离；deliveries通信对摘要；outbox安全队列元数据；logs有界来源选择/跟随。会话页o/l、通信对w/l、队列o携带完整关联，直接命令清范围，Esc恢复原页。
- 共享watch只发布有界完整快照；controller拥有信号/代际/跟随意图，输入/详情/帮助/来源选择暂挂，迟到结果拒绝。日志重复行以offset区分，Windows文件ID无损，普通结果隐藏已知秘密/IPC能力；无watchdog独立日志明确禁用。
- 检查点：`3c0db76`共享合同/导航RED；`cc9398d/d58757a`路由与跟随；`6eecaa4/fee4985/4fd2343`通信与安全关联；`f6fa65b/508ebfd`有界日志；`6fc4b0b/ba7c86a`默认入口与会话关联；`614c32f/2ada827`总览/doctor首组；`bb4b200/fcdc8f8`scoped来源失败；`b834cc6/d0bae93`局部失败/机器身份；`d2286f2/4d39374`无损文件ID；`e74882a/0ae1bf8`真实三字段watchdog锁；`7d70f6d/0ae1bf8`日志链接门禁；`0238cbd/7d71d55/13189bf`默认原生环境与显式HOME隔离。
- 最终`npm run check`退出0：1447通过/11既有跳过，115文件通过/3跳过；运行时图128模块/390边，无环或越界，lint/build通过。Windows ConPTY观察三场、外壳三场、本机会话三场全部通过；来源/剪贴板/写入为隔离fixture，日志使用受控真实文件，不访问真实用户会话或远端。
- root统一提交，各代理均已停写。T08活动行/说明/依赖已删除，临时任务规格转长期规格；T09—T12、T14继续等待指令，无必需待验收项。

## 本机操作与SSH验收（2026-10-22）

- 用户授权T09/T10并行，新增doctor --json明确获批，无参文本、检查、级别与退出码保持。规格：[本机操作与SSH](tui-local-operations-ssh-spec.md)；[完整验收](tui-local-operations-ssh-validation-20261022.md)。基线`35f0ba2`，最终产品`21a1dae`，最终测试预算`84fb8da`，终端工装`6f597c0`。
- services、files、maintenance、SSH清单及远端sessions/doctor默认接入；ctx的选择/指引/检测可用。composition按连接分派，通用controller/UI无Provider或SSH业务分支，原生聊天仍归原生工具。
- 服务同次扫描核对完整PID集合、进程与ready分列、日志绑定实际快照。探测和TUI停机拥有辅助进程与同步扫描子树，取消/超时先回收再返回；已发出的外部停止信号不可回滚，结果待核实。旧background与CLI停机合同保持。
- 维护预览与执行指纹绑定，父链/子树链接、目的硬链接、坏状态和超限范围拒执行；实际结果和未知新尝试分清。卸载仅原本机数据/技能范围，npm不执行，退出不重建已删除数据目录。
- SSH完整发现/匿名/分页、配置版本绑定、同用户指引、认证/PATH/接口错误与可取消体检均接入；失败不回落本机、不降级旧文本。显式home绑定SSH配置与子环境，不声称隔离所有认证来源。
- 检查点：首RED`1d80841`；ctx`36a0e7e/0f86943`、composition`e26724d/9aa9d08`；维护`284c98a/7909363/ab49be1/8add6b5`；服务`362302b/e4683d8/278efc0`；SSH`8de11d0/48ce82e/ef5dcfa`；偏好`0ead30d/09bf16c`；显式SSH配置`f0787b5/f70b294`；探测树`f0787b5/fd3159f`、有界registry`cdf8a52/66e2bdf`、停机树`389c2ee/c05fdb7`。
- 最终`npm run check`退出0：1546通过/11既有跳过，131文件通过/3跳过；149模块/455边，无环或越界，lint/build通过。首轮仅目录预算fixture默认5秒超时，保留全部断言并给该真实文件核验case15秒后全量通过；没有跳过失败用例。
- 最终Windows ConPTY四组共十二场通过，含固定目标起停/维护默认取消/实际结果、SSH匿名/失败/体检取消及三档resize，退出raw/监听/主屏/光标/括号粘贴恢复。工装使用隔离fixture，不起停真实服务或连接真实远端；真实受控扫描子树和worker IPC另由自动测试验证。
- 各代理全部停写，root集中保存。已删除T09/T10活动行、说明和依赖，临时规格转长期规格；AGENTS/map/API/使用说明同步。仅T11/T12/T14继续等待指令。其他会话README与四份研究草稿保持原状。

## T11 / T12进行中

- 当前用户授权TCP浏览与管理，基线`393f1ad`，1546通过/11既有跳过。root唯一stage/commit；其他会话README/研究稿保持原状。
- 规格与批准状态：[TCP本轮规格](tui-t11-t12-spec.md)。已批准只读星快照，普通成员/星管理员仅本星、完整机器ID/成员/安全凭证版本、不返回钥匙，不新增管理审计；现有list-nodes/list-members行为保持。原子版本删除方案等待第二项选择，未获批前不实施相关产品。
- 分工：t09_maintenance只读TCP应用/DTO及纯snapshot builder；t09_services TCP管理/原子registry helper/唯一revision helper；t10_ssh TCP资源及独立测试；root共享presentation/秘密结果态、broker/protocol胶水、composition、统一验收与文档。代理只能编辑所分配文件，RED保存后GREEN，禁真用户IO/生产服务。
- 本轮Selected model is at capacity中断为服务容量提示；已核对三个代理仍运行并从检查点续接，没有重开任务或切模型。
- 检查点：授权/共享RED`0f24857`，revision RED`5dda650`，应用聚合/管理RED`4eb5fd1`，资源RED`ff38e09`，共享presentation/秘密结果GREEN`bacd9cd`（49项定向通过），snapshot运输RED`bef45ef`。root已完成snapshot WS/adminPipe胶水和严格只读台账读取，受控broker/原管理回归13项通过；尚待保存GREEN与全部业务集成/ConPTY。

## 设计来源（原稿）

仓库外原稿：`C:/Users/yangsheng/.codex/visualizations/2026/10/21/01a15d5d-6d04-7b11-9ccb-39611d84b68b/crosschat-tui-v6-requirements.txt`、`crosschat-tui-v6-keys.txt`和49屏评审册。本轮可执行范围已提炼到长期外壳规格；无需每次重载历史稿。
