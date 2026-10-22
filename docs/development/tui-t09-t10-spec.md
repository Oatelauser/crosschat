# T09 / T10 · 本机操作与SSH

2026-10-22用户授权两项并行实施。基线`35f0ba2`，1447通过/11既有跳过。正常开发、不赶时间，现有功能变化先确认。root唯一stage/commit，其他会话README与研究草稿保持原状。

## 范围和已批准变化

- T09服务列表合并broker固定项、可确认配置节点和快照；a启动、Ctrl+D精确停止、l日志、Enter/d只读、y标识、i来源信息。实际进程+新PID/时间戳/状态确认ready，不把spawn当成功；同星防双开/内挂占用复用原判断。launcher不是独立服务，不虚构起停。
- 文件页只读元数据与完整路径，m进入维护。维护提供保留规则清理、强制清理、安装/更新skills、卸载本机数据；列表Enter先预览完整目标/范围，默认取消，提交重核计划。保留既有清理规则、安装失败停止次序、卸载逐项继续及旧CLI输出/退出码。npm卸载不执行，仅提供现有收尾指引。
- T10列已配置SSH Host别名，Enter进入该SSH上下文完整会话发现；a选择已自动发现的已有别名，不新增持久清单或写SSH配置；t只检测选中目标，D远端doctor，g同用户配置/回程指引，y地址，d详情，i读取信息。
- 用户明确批准doctor --json：远端逐项检查/说明/指引，复用已有结构结果及运行时校验。无参文本、检查判定与退出码保持；exit1且有效JSON表示诊断已完成但存在错误，认证/PATH/接口失败不冒充结果，不做旧端降级或本机回落。
- ctx的a/g/t接到真实可用的选择/指引/检测；TCP配置导入和管理仍属后续任务，不顺带实现。

## 抽象与所有权

- root：共享model/controller/ctx呈现、registry/main/UI、集成与ConPTY、文档/全量验收。
- t09_services：应用本机服务read/check/execute、只读inspect隔离、必要guard内部提取、资源services及独立测试。commands/serve仍保留旧导出/行为，稳定目标与revision防止确认后换对象；原字面selector不足以精确停机时禁用，不扩成停全部。
- t09_maintenance：应用维护list/preview/execute、必要安装/卸载业务提取与隔离worker、files/maintenance资源及独立测试。只传operationId与已确认fingerprint，执行端重算原计划，不接受UI提供任意路径。
- t10_ssh：SSH应用/资源、sessions上下文小扩展、doctor JSON CLI及纯逐项formatter复用、相关测试。root main按context分派，通用controller/UI无SSH/Provider业务分支。

## 生命周期与隔离

- 操作从所属列表发起；详情只读，表单固定连接/目标/影响，失败保留输入，成功返回原列表并保留选择。写后取消仅停止等待，结果待核实，不声称回滚或自动重试。
- 同步扫描和维护IO离开输入循环；隔离owner有超时、取消、IPC unknown验证与finally回收。读取不触发启动/清理/安装；服务启动后的真实子服务不因取消等待被杀。
- SSH固定命令/argv、BatchMode、输出上限、超时与owned子进程回收；连接配置删除/改变后拒绝旧目标。完整引用绑定SSH上下文，原生指引明确在目标同用户环境执行，不代原生会话聊天。
- 显式测试home同时隔离LOCALAPPDATA、原生目录和子环境；普通测试不读真实会话、密钥，不起停真实服务、不清理用户数据、不安装用户skills或运行npm卸载、不连接真实远端。

## 验收

先有意义RED保存后GREEN。各片定向行为/失效测试、旧CLI回归、独立审查通过后npm run check；最终构建后真实Windows ConPTY覆盖本机操作预览/取消/结果、SSH绑定/错误/取消/长字段/resize及旧链回归。验收后分别删除T09/T10活动行/说明/已满足依赖，临时规格转长期记录，保留批准和证据；T11/T12/T14继续等待指令。
