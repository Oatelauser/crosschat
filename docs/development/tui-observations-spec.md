# TUI本机观察资源规格

2026-10-22用户授权并完成开发验收。基线`a29d043`，1377通过/11跳过；最终产品`13189bf`。证据见[本机观察验收](tui-observations-validation-20261022.md)，操作与完整按键见[终端界面](../tui.md)。现有功能变化先确认。

## 范围与规则

- 本机status/doctor/deliveries/outbox/logs；SSH/TCP业务、维护/服务操作仍属后续任务。
- status按v6组合Provider会话、已有SSH/TCP配置、服务快照、队列/看门狗和本次TUI最近体检。配置不代表认证，快照按时间/PID/当前撤权证据判断；不自动探远端或执行doctor。
- doctor进入/r按需运行现有检查，独立可取消进程执行；复用原判定与逐项解释，不解析CLI整段输出，不自动修复，不改变CLI检查/严重度/退出码。
- deliveries是本机已知通信对摘要；outbox是队列元数据。均不展示聊天正文、不补投、不重新验证rollout，不分配/写入短柄，保留来源错误与未知。按完整ref/端点关联，名字/短ID不足则禁用关联。
- 交互循环中的文件读取异步且有界；doctor的原同步探测在独立进程中执行，scoped读取同样有界。过大/损坏/不可读不能冒充空。队列只白名单元数据，不传envelope/claim；通信记录沿用当前存储布局，不迁移或修复。
- 日志来源限已知自有文件；可选来源，默认send-log。有界滚动、稳定行身份、重复行、追加/轮转/缩短明确处理；超长边缘行说明不完整，不伪造完整行或可复制值。已知凭证/IPC能力从普通结果隐藏。
- 日志上滚/PgUp/Home暂停，End/Space恢复并到最新匹配行；文字筛选独立且零匹配仍跟随。详情/输入/帮助/选择器暂挂观察，返回按意图恢复；换页、刷新、取消、退出中止owner并拒绝迟到结果。来源没有watchdog日志时明确不可用，不新增文件写入。
- 读操作只在已选本机上下文执行。显式测试HOME同时约束所有子进程、registry/outbox/skills/native来源，普通测试禁止真实用户源与网络探测。
- 默认启动保留用户原生环境覆盖；`nativeEnvironment:'inherit'`仅将crosschat配置home绑定给诊断依赖。显式隔离home默认`isolated`，移除外部原生数据目录覆盖。当前watchdog锁按现有三字段格式读取，只保留PID/心跳，不返回owner token。

## 共享合同

- `TuiRoute.query`为不可变字符串字典，规范化进入cache key/read；`TuiRow.actionRoutes`按action.id定位相关资源，直接资源命令清关联，Esc恢复来源。
- `TuiResourceAdapter.watch(request,publish)`可选，发布完整有界快照；controller管理signal/代际/跟随意图，Adapter管理轮询和IO。`TuiPage.canFollow`及`TuiSnapshot.following`表达当前页面能力/意图。
- `TuiPage.routeChoices`配合`route-choice`动作复用选择器；`sortable:false`替代日志ID特判。通用UI不分工具或来源协议。

## 应用模块与边界

- `application/observations/overview.ts`组合安全发现、上下文、服务、队列、watchdog与会话内诊断缓存；`diagnostics`拥有超时和整个进程树。
- `application/observations/communications.ts`提供通信对、队列元数据与共享归对；文件JSON上限2MiB，审计只读最近有界窗口，不调用存储writer或短柄生成。
- `application/observations/logs.ts`只接受登记来源，拒绝链接/特殊文件；默认64KiB/最近1000行。`queries/logs.ts`共享有界字节窗口，保留旧tail返回契约，以无损文件标识、代次和字节offset区分重复行及观察到的轮转。
- `tui/resources/*`只接收DTO并声明动作；main默认安装真实本机资源，显式adapters（包括空对象）仍为唯一来源。新Provider不进入通用controller/UI分支。
- 文件若在两次观察之间截断后又增长得更大，仅靠文件身份/大小不能确认该过程；显示当前采样尾窗，不声称完整文件历史。

## 验收

关联精度/返回定位、只读无补投/写入、局部失败/未知、取消/超时释放、日志重复行/轮转/长行/筛选、字符限制、所有按键及原CLI回归均纳入隔离测试。最终npm run check及Windows ConPTY键盘/跟随/resize/恢复通过；活动任务与已满足依赖已删除，批准与检查点保留在验收记录。
