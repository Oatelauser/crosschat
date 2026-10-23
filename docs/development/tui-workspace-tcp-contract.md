# TUI 工作区 TCP 管理合同

2026-10-23。用户已批准整机原子移除、在线远程修改对端本星名称；不做旧端降级。本合同以 [broker WS 协议](../broker.md) 为基础，扩展原管理面，不引入其他服务。

## 接线

- 应用 `remove-node`：`targetId=TcpMachine.id`、`values={}`；预览读取完整机器及本星全部已绑定节点凭证，绑定集合版本。多钥也一次确认，不逐把循环。
- 应用新增 `rename-node`：`targetId=TcpMachine.id`、`values={name}`；空串清除此星覆盖，回落对端全局默认。仅在线、完整目标、本机 broker 主或本星管理员可用。普通成员拒绝。原 `set-show-name` 保留本机 global/star 合同。
- 两项继续返回 `TcpManagementResult`，确认版本变化拒绝，已发送后缺回执/取消显示 uncertain，不自动重试；UI 不把确认弹层与详情混用。

## 整机移除

- 新管理操作 `remove-machine`：本机插座 `{op,starId,machineId,expected:{machineRevision}}`；WS `admin-op` 使用同名 action，星从已认证连接取得。
- 集合版本由完整 machineId、全部绑定该机器的节点钥 label 和不可逆凭证 revision 形成；排序不影响版本。未绑定钥、管理钥及其他机器不在集合内。
- broker/冷写在同一次新鲜读取与同步提交中验证完整集合版本，再一次移除全部匹配节点钥；零匹配、增钥、换钥或绑定变化都拒绝，不允许先删一部分。
- 热态撤销全部被移除凭证对应的既有连接，明确撤权暂停沿用现有规则；保留永久成员册及原生会话。
- 成功回执包含 `removed:true,machineId,removedLabels`，列表必须恰好对应已确认集合。凭证本体不出回执、审计或普通页面。旧 CLI `remove-node` 单 label 行为保持。

## 在线远程改名

- 新管理操作 `rename-node`：本机插座 `{op,starId,machineId,name}`；WS `admin-op` 同名 action。broker 主及当前星管理员可写，普通成员不能代改其他机器。
- broker 只向当前星该完整机器的已认证在线 node 连接转发，绑定具体 socket 与请求 ID。对端只能改自己的当前连接条目，不能接收任意路径或跨星写入。
- 对端核对当前配置条目的完整星/连接身份，严格保留其他字段，只持久修改本条目 `showName`；保存失败不得宣称生效。更新运行时配置与当前连接名称，无需重启服务或原生会话。
- 对端回执必须证明保存和运行时生效，并绑定完整 starId/machineId；broker 收到并核验后同步本星同机凭证缓存和成员机器名，再向管理员回成功。断线、目标替换、超时或写入后缺回执不能伪造完成。
- 成功回执包含 `renamed:true,starId,machineId,showName,saved:true,applied:true`，可带最终 `name`。空串 showName 表示清覆盖，name 是回落后的实际显示名。
- 仅在已认证 node 连接上新增 `node-name-set`：`{op,id,starId,machineId,name}`；对端回 `node-name-result`：`{op,id,starId,machineId,ok,saved,applied,showName?,name?,error?}`。完整 machineId 为归一的 32 位小写十六进制；名称限 32 字符且不能含控制符。请求 ID、完整身份和 socket 同时核对，超时/断线/停机释放等待，迟到或矛盾回执不生效。
- 离线立即拒绝，不排队；不改顶层全局默认、其他星、原生会话名称、machineId、凭证或 broker 管理别名。
- 多钥缓存、节点/成员/会话显示及名字寻址使用同一当前星生效名称；跨星保持独立。旧 CLI 改名合同不扩大。
- 当前 node 连接总是显式报告生效名称；无覆盖、无全局默认时报空串，重连时也清理本星同机全部旧凭证/成员缓存。没有携带 name 的原连接帧继续保留原语义。
- 对端保存和 broker 名称投影使用严格有界读取与独占临时文件原子替换；目标或源文件发生可观察变化即拒绝，损坏源不会触发备份、修复或重建。对端已保存而 broker 投影失败显示待核实，后续重连可重新报告实际名称。

## 空节点配置与验证

- 删除最后一项 TCP 配置后保留 `brokers:[]` 及原顶层字段；读取视为未配置，消费者给明确选择/配置错误，不恢复旧形状、不自动创建星或服务。
- 普通测试只用私有临时目录、注入应用依赖及受控本机 WS/adminPipe；覆盖权限、集合变化、热冷、离线、对端落盘失败、缺回执及同机多星。不读取真实用户配置或远端环境。
- 流程：合同与有意义 RED 先交 root 提交；收到 GREEN 指令后实施。root 唯一 stage/commit；验收保留证据并移除活动任务。

## 2026-10-23 定向验证证据

- RED 已由 root 保存：`41a1851`（应用/空配置合同）、`176f857`（矛盾生效回执）、`ab911ef`（损坏 broker 源与重连多钥缓存）。后续 GREEN 未改弱拒绝、权限或路由断言。
- 20 个相关测试文件共 229 项通过，其中新增应用、事务、等待生命周期、真实受控 WS/adminPipe、空配置 5 文件 34 项。旧名字寻址夹具显式配置其预期 showName，避免只在 broker 中预置名称却由无名称节点立即清除的相互矛盾前提。
- `npm run lint`、`npm run check:imports`、`npm run build` 通过；运行时依赖图 182 模块、580 边，无环或边界违规。整体 TUI 和真实终端验收由 root 汇总，本记录不代表未执行的真实远端测试。
