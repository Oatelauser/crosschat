# TUI本机会话规格

2026-10-22用户授权并完成验收，见[验收记录](tui-sessions-validation-20261022.md)。本页保留长期交互与接口合同。

## 行为

- 本机sessions复用DiscoveryService安全DTO，默认包含匿名和当前来源可发现的非归档会话，不改变旧CLI/send默认扫描范围，不读取聊天正文。
- 每Provider分页100，沿cursor读完；重复cursor/取消/来源失败有明确不完整信息。整个刷新原子替换，读取期间保留旧列表及稳定选中；PgUp/Dn继续翻连续表的屏幕页。
- 工具/状态选项由未过滤集合及Provider登记产生；t/s通用选择弹层，u切所有/仅命名。与统一输入全文筛选独立，按route恢复。无星scope时b说明不可用。
- 每行用完整SessionRef生成内部key，短显示值不作寻址。详情为带采样时间的完整安全元数据；未知状态保留raw。g仅展示Provider登记的原生操作/寻址指引，不运行原生聊天或冒用身份。
- y仅复制确有现有寻址支持的采样地址，缺身份/歧义/不支持时禁用并说明；按现有名字精确→名字前缀→ID规则验证目标，Codex超出原CLI20条选择范围时禁用。Y复制完整SessionRef。零行仍可用i查看完整读取信息/来源错误及下一步。
- a和Ctrl+D仅从列表发起，明确选择已配置星，固定完整星/机器/工具/会话身份，预检与确认前重核，失败留值；不终止或删除原生会话。

## 两项获批变化

1. 新增按完整SessionRef精确收编的应用接口；支持符合既有入星条件的匿名/同名会话。复用已有attach和权限，确认中明示可能启动聚合器；原CLI按名行为保留。
2. 新增原子精确删册模式，由broker同一步核对完整会话ID、机器和工具；目标变化即拒绝，绝不回落名字/前缀。星成员权限保持，原CLI选择器行为保留；不做旧端兼容或降级。未核实本机身份/Provider或跨工具ID冲突不得盲写。

## 接缝与核验

- `src/tui/resources/sessions.ts`负责安全DTO的分页聚合/转换；Provider差异通过状态、原生指引及成员能力登记，通用UI不分工具。
- `src/application/discovery/local.ts`只组合来源，不在构造时扫描。默认尊重原生环境，显式HOME同时绑定Claude目录、Codex proxy和Desktop SQLite来源。
- `src/application/session-membership/*`提供listTargets/check/apply，返回安全结果。机器标识为可取消/有界OS读取，不生成身份；每个原生核验读取有自己的取消owner。
- 收编只允许已证实的本机原生引用；其他Provider的null仅在complete时表示不存在。实际broker/在线聚合器身份必须与完整星/机器匹配，启动选择器存在名字遮蔽则拒绝；明确撤权不绕过暂停。attach只发一次，再以权威星册确认。
- 原子删册的目标消失/身份变化返回拒绝；已发写取消、丢回执或内存改变而落盘失败返回待核实，不自动重试。旧CLI名字/前缀选择规则保持。
- 通用model扩展：row facets、detailViews、copyValues和actionAvailability；page filters/detailViews/actionAvailability；filter动作和通用choice；动态表单fields带options。旧静态Adapter和测试保持有效。

## 验收

匿名跨页、空页继续、第三Provider/未知状态、同ID/同名/短前缀、来源局部失败、取消/迟到、刷新/返回、地址与引用区分、详情无写入口、权限/固定目标/删册竞态、普通CLI回归；临时HOME和注入Discovery，测试不读取真实会话或连接用户服务。行为/规范检查后npm run check，另做真实ConPTY键盘/选择器/resize/取消/退出恢复。证据保留在独立验收记录。
