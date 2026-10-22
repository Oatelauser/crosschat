# TUI TCP浏览与管理验收

2026-10-22。用户授权T11/T12，要求正常开发、不赶时间、现有功能变化先确认。分支`codex/core-refactor-pre-tui`，基线`393f1ad`（1546通过/11既有跳过），最终产品`f64d95b`、终端工装`2cc1aa6`。合同见[TCP规格](tui-tcp-spec.md)，入口与完整资源按键见[终端界面](../tui.md)。

## 交付与批准

- TCP上下文只读本星；本机stars列本机broker托管星。机器、成员册、凭证分别展示，星默认机器列表，v切全星会话、Enter下钻机器。会话引用包含完整机器ID，匿名默认包含，未知工具/原始状态保留。
- 册内成员与节点可发现范围分开；完整发现最多三节点并发、读完分页，单源失败保留其他结果。机器列表每两秒串行刷新只读快照，选择不跳，输入/详情/帮助/秘密结果期间暂停，退出释放旧查询。
- 增删改从对应列表发起，确认固定完整目标/权限/影响，默认取消。秘密仅在显式发钥后进入专属结果，复制/关闭不再次生成；关闭丢弃owner并清当前画面，普通详情、偏好与安全错误不持有秘密。
- ctx增加已有连接入口；TCP私密JSON导入只追加当前格式的新星，成功后重新读取ctx并选择实际新增行，不联网、不启动服务。相同星替换、旧形状迁移不在范围。
- 用户分别明确批准：本星只读`star-snapshot`（无秘密、新读不记管理审计）；删除同一步核验`expected`完整目标版本；原审计追加完整`starIds`以稳定归属。三项均已落地，原CLI不传expected的选择器和原list审计规则保持，不做旧端降级。

## 自动检查

Windows、Node25.0.0、npm11.6.2、PowerShell7.6.5。普通检查清除`CROSSCHAT_LIVE`，使用临时目录/配置、注入effects和受控本机socket；不访问真实用户会话、钥匙或剪贴板，不登录真实SSH目标，不起停用户服务或部署新版。

最终`npm run check`在产品`f64d95b`上退出0，2026-10-22 16:11:00（UTC+8）进入Vitest：

- ESLint、TypeScript构建通过。
- 运行时图164模块、520边，无循环或跨层违规。
- Vitest **1647通过、11既有跳过**；149文件通过、3文件跳过（共152文件、1658用例）。
- 原始输出：`%TEMP%/crosschat-t11-t12-check-20261022-final2.txt`。

此前全量在`448accc`已1641通过/11跳过；其后独立复核发现工厂可传入大于3的发现并发，以及冷态静态台账被实时partial一并挡住。两项均先补RED再修复，最终全量如上。未通过跳过测试或减少边界断言收尾。一次定向命令未限制目录而匹配外部文档副本测试，随后均按`npx vitest run --dir test ...`运行，未修改外部项目。

## 行为与失效边界

| 范围 | 证据 |
|---|---|
| 本星与权限 | 实际受控broker的WS成员/挑战星管及adminPipe返回同形快照，完整机器ID可区分相同mid8；不泄露钥匙/相邻星；新快照不刷审计，旧list仍记原审计 |
| 只读权威 | 损坏台账拒绝读取，不触发旧repair/.bak；坏/缺status不猜活性、不错误打开管理插座。冷态presence保持unknown，静态完整性另由staticComplete表达 |
| 冷态管理 | 真实只读应用与管理预检组合验证有效静态台账可预览已有星修改/加星，坏数据和远端partial拒绝；该测试注入写effects，执行端另独立核验真实热冷路径 |
| 完整发现 | 匿名/第三测试Provider、重复页游标、机器内完整分页、全星最大三并发、同原生ID不同机器、节点失败/离线、取消和迟到结果；册内读取不擅探原生忙闲 |
| 原子撤权 | 实际受控WS/adminPipe验证被替换凭证拒绝、label不前缀回落、新版本确认后立即撤销实际连接；删星影响变化拒绝，重新确认只删目标星，相邻星不受影响 |
| 事务与收尾 | 严格新读同一步比较revision、删除，保留未知静态字段；唯一wx临时文件、父链/目标链接与硬链接保护。星已删除而次级node配置清理失败时仍执行连接收尾并报uncertain，不声称回滚 |
| 管理边界 | 热IPC回执超2MiB立即收口，不冷回退；认证迟到连接取消后释放；已发出写入取消显示待核实，不自动重试。新增星使用权威DTO的实际行ID |
| 接入与身份 | 发钥前核对接收机可达host，校验返回配置的星/端口/钥匙一致性；多钥绑定同机不冒称一次撤钥删除整机；收编只取本机完整SessionRef，删册沿用原子精确接口 |
| 显示名与日志 | 只修改当前机器的全局/本星配置，不冒称改远机。管理审计按完整starId筛选，旧无标识行明确无法归属，不按复用名字猜测 |
| 私密导入 | 真实临时文件验证新增/追加保留原字段、同星替换拒绝、确认后变化、损坏/超限、父链链接/硬链接、rename失败清临时文件、取消前不造目录；安全DTO不带原始JSON |
| 共享展示 | page.presentation统一列/动作/帮助；result owner清理复制、错误与秘密不泄露；导航重读权威ctx后选中新增项；默认composition按本机/SSH/TCP及星作用域分派，不失败回落本机 |

本轮关键RED/GREEN包括：共享结果与presentation`0f24857/bacd9cd`；snapshot运输`bef45ef/1e28a94`；原子registry`095dad6/12895c9`及运输`71e3e00`；审计`8babcc6/feed51a`；配置导入/导航`05e14af/7d6ae2e/bc48033/dfa6d81`；默认组装`8b18e62/c88c878`；IPC边界/新星选择`191b4ba/3830fcd`；并发上限`16e21a9/e203b37`；冷态静态预检`ce92b66/f64d95b`。其余定向记录保留在提交历史。

## Windows真实终端

最终构建后，TCP、外壳、本机会话、观察、本机操作/SSH五组共十五场通过。每组正常/取消退出0、受控异常退出1；ConPTY host退出0，raw模式及自有监听返回Ink暖机基线，主屏、光标和括号粘贴恢复。

| 工装 | 最终证据目录 |
|---|---|
| TCP | `C:/Users/yangsheng/AppData/Local/Temp/crosschat-tui-tcp-validation-zXvHWx/` |
| 外壳 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-validation-Ja5jNH/` |
| 本机会话 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-sessions-validation-ZEoQfd/` |
| 观察 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-observations-validation-0dBlvx/` |
| 本机操作/SSH | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-operations-ssh-validation-wRNtpX/` |

TCP主链实际覆盖本机ctx→stars改名默认取消/明确确认→机器列表选择/自动刷新→全星发现含所属节点→下钻机器与完整SessionRef→只读详情屏蔽写键→返回恢复→固定机器删除取消/确认→24×12隐藏表单不得提交→48×16/100×28恢复→发钥一次性结果复制/关闭清屏→普通成员权限禁用。仅有明确确认的rename-star、remove-node、generate-node-key三个注入effect。ctx空闲Ctrl+C场无业务读取；异常场验证完整终端恢复。

TCP首轮`...-a2lFIs/`在清屏断言失败：原始输出确有2J清屏后H回首，但ConPTY在两者之间插入`?2026h/l`同步输出控制码。仅将工装改成允许这两种控制码，仍要求2J后H且清屏后不重绘秘密；最终工装node语法与ESLint通过，最终`...-zXvHWx/`三场全部重跑通过。中间两次`...-1mgxES/`、`...-9kKLsh/`也通过，但最终证据以zXvHWx为准。产品未因此改动或重建。

ConPTY使用实际构建产物/controller/资源/Ink与Windows终端；业务来源、剪贴板和管理写入使用隔离fixture。真实协议行为由受控本机broker/WS/adminPipe测试另行验证，不能声称生产服务或真实远端live通过。本轮没有macOS/Linux终端实测；未并发build改写验收中的dist。

## 限制与后续

秘密清屏限当前终端画面及本次owner，不能擦除外部终端录像或OS剪贴板。配置导入确认绑定可观察的原bytes/文件身份并在rename前复核，不承诺与无锁旧writer建立跨进程绝对CAS。原CLI无expected时行为保持；本轮无旧端适配和自动升级。

本批必需检查已全部完成。T11/T12活动行、说明及已满足依赖已删除；临时规格转长期规格，AGENTS、map、使用/API/协议与续接记录同步。代理全部停写，root集中保存；其他会话README修改和四份研究草稿未纳入本次提交。

本批TCP开发验收与既有终端回归不代替整体最终验收。后续用户已授权并完成该验收，最后活动队列已删除，见[整体最终验收](tui-final-validation-20261022.md)。
