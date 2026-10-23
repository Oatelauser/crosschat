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
- 离线立即拒绝，不排队；不改顶层全局默认、其他星、原生会话名称、machineId、凭证或 broker 管理别名。
- 多钥缓存、节点/成员/会话显示及名字寻址使用同一当前星生效名称；跨星保持独立。旧 CLI 改名合同不扩大。

## 空节点配置与验证

- 删除最后一项 TCP 配置后保留 `brokers:[]` 及原顶层字段；读取视为未配置，消费者给明确选择/配置错误，不恢复旧形状、不自动创建星或服务。
- 普通测试只用私有临时目录、注入应用依赖及受控本机 WS/adminPipe；覆盖权限、集合变化、热冷、离线、对端落盘失败、缺回执及同机多星。不读取真实用户配置或远端环境。
- 流程：合同与有意义 RED 先交 root 提交；收到 GREEN 指令后实施。root 唯一 stage/commit；验收保留证据并移除活动任务。
