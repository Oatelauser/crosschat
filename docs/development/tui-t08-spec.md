# T08 · 本机观察资源

2026-10-22用户授权，按正常流程实施，不设截止日。基线`a29d043`，1377通过/11跳过。root唯一stage/commit，其他会话的README与研究草稿保持原状。现有功能变化先确认。

## 范围与规则

- 本机status/doctor/deliveries/outbox/logs；SSH/TCP业务、维护/服务操作仍属后续任务。
- status按v6组合Provider会话、已有SSH/TCP配置、服务快照、队列/看门狗和本次TUI最近体检。配置不代表认证，快照按时间/PID/当前撤权证据判断；不自动探远端或执行doctor。
- doctor进入/r按需运行现有检查，独立可取消进程执行；复用原判定与逐项解释，不解析CLI整段输出，不自动修复，不改变CLI检查/严重度/退出码。
- deliveries是本机已知通信对摘要；outbox是队列元数据。均不展示聊天正文、不补投、不重新验证rollout，不分配/写入短柄，保留来源错误与未知。按完整ref/端点关联，名字/短ID不足则禁用关联。
- 所有文件读取异步且有界；过大/损坏/不可读不能冒充空。队列只白名单元数据，不传envelope/claim；通信记录沿用当前存储布局，不迁移或修复。
- 日志来源限已知自有文件；可选来源，默认send-log。有界滚动、稳定行身份、重复行、追加/轮转/缩短明确处理；超长边缘行说明不完整，不伪造完整行或可复制值。已知凭证/IPC能力从普通结果隐藏。
- 日志上滚/PgUp/Home暂停，End/Space恢复并到最新匹配行；文字筛选独立且零匹配仍跟随。详情/输入/帮助/选择器暂挂观察，返回按意图恢复；换页、刷新、取消、退出中止owner并拒绝迟到结果。来源没有watchdog日志时明确不可用，不新增文件写入。
- 读操作只在已选本机上下文执行。显式测试HOME同时约束所有子进程、registry/outbox/skills/native来源，普通测试禁止真实用户源与网络探测。

## 共享合同

- `TuiRoute.query`为不可变字符串字典，规范化进入cache key/read；`TuiRow.actionRoutes`按action.id定位相关资源，直接资源命令清关联，Esc恢复来源。
- `TuiResourceAdapter.watch(request,publish)`可选，发布完整有界快照；controller管理signal/代际/跟随意图，Adapter管理轮询和IO。`TuiPage.canFollow`及`TuiSnapshot.following`表达当前页面能力/意图。
- `TuiPage.routeChoices`配合`route-choice`动作复用选择器；`sortable:false`替代日志ID特判。通用UI不分工具或来源协议。

## 所有权

- root：model、日志应用读取/资源、UI/main集成、隔离测试与ConPTY、文档/统一验收。
- tui_controller：controller/registry、关联路由/选择器/跟随生命周期，独立新测试。
- tui_contexts：overview应用/资源、diagnostics必要纯提取/隔离与当前撤权证据，独立新测试。
- t07_sessions：communications应用/资源（deliveries/outbox），异步安全元数据读取与关联，独立新测试。

## 验收与完成

有意义RED保存后GREEN；关联精度/返回定位、只读无补投/写入、局部失败/未知、取消/超时释放、日志重复行/轮转/长行/筛选、字符限制、所有按键及原CLI回归。定向检查通过后npm run check；另做真实Windows ConPTY键盘/跟随/resize/恢复。验收后删除活动项和依赖，规格转长期记录，保留批准及验证证据。
