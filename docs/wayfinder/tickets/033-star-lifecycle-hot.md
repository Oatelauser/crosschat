# 星生命周期热闭环与台账静态化（代码票 A）

label: wayfinder:design
status: open（2026-10-20 七轮 grilling 定案，二期10 自领）
blocked-by: 无
claimed-by: 二期10

## Question

022/032 之后加星仍须重启才完整托管（手册 1.2.4 口径"重启生效"）；broker.json 内嵌 roster.online 是高频变化状态（每次会话上下线整文件重写）；serve 首启自动造星（hostname 缺省名）职责混杂。本票把星清单从"启动读死"改为"持续收敛"，管理动作统一走 broker，台账只存静态。

## 决策（用户 2026-10-20 逐条拍板，grilling 全程留痕）

1. **加/删/改星全免重启**。触发=CLI 落盘型命令完成后经**本机管理插座**通知 broker 立即对账（轮询与 fs.watch 均被用户否决——性能/跨平台坑，否决留痕见 §备选）。对账幂等（按 starId）：磁盘新增星落位并按需播种内挂聚合器；消失星收尾（弃状态→停聚合器→闭连接）。
2. **修改全走 broker**（权限模型）：管理动作只在 broker 机本机（插座）或持管理员钥匙（034）；node 仅持星钥入星/自退（--connect/--stop），无任何管理通道。broker 运行期是台账**唯一写者**——CLI 不再直写（冷路径兜底：broker 未跑时 CLI 直调同一套 registry 库函数落盘，函数不分家，首星/预配机不断腿）。
3. **管理插座**：本机 unix socket / win 命名管（**零 TCP 端口**，不触 v1 准入铁律）；地址随机（知道地址=能力，同仓 claude `cc-msg-*` 管道先例），写 status-broker.json 新字段；broker `stop()` 先停插座再撤星状态；CLI 打印"已生效"必出自 broker 回执（021 不预支成功纪律）。
4. **serve 永不造星**：懒 bootstrap（bootstrapStar1 + mutatingCmd 自动造星钩子）删除；**首星同走 `--add-star` 显式命名**（hostname 丑名问题随葬）；零星启动=合法待配状态（doctor/status 教学指 --add-star）。
5. **broker.json 只存静态**：`roster.online` 字段出文件——活性归运行时（内存连接表 + status-broker.json）；成员册位/钥匙/拓扑留文件。新旧互读无害（缺字段=默认离线，聚合器重连数秒自愈）；"每次上下线整文件重写"的写放大随葬。
6. **删星 `--remove-star <名>`**：执行前打印将死清单（星/机器/成员数），无 y/n 交互；册随星葬、钥匙作废、无墓碑无复活；**最后一颗星允许删**（零星合法——原"拒删防 starId 重造废钥"理由随懒 bootstrap 一起消失，用户拍板撤除）；被删星会话收"星已删除"断连教学；发送方**直报"星已被删除"**（不走防重发绕弯——那属网络超时教学，与本场景无关）；清理面=broker.json 星段 + broker 机 node.json 自登记条目 + status 刷新；node 侧死条目靠教学自清。
7. **showName 热改（仅 broker 机）**：经插座改 node.json + 重挂内挂聚合器（秒级）；node 机维持 017 口径（手编+重启守护）。
8. **非目标**：port 热换不做（改完重启生效，手册明写）/外部守护死亡后内挂接管不做/node 查 broker 星目录**不做（用户拍板）**/fs.watch 不用/轮询不用。
9. **备选已评估否决**：mtime 轮询（用户否——"浪费性能"）/fs.watch 目录监听（WSL/drvfs 不燃 + tmp+rename 生命周期坑）/CLI 写文件+拍门铃 F1（保留跨进程写台账竞态）/变更逻辑双写顾虑（库函数冷热两调用后消失）。

## 实施清单

- broker.ts：onAdminPoke → syncStarsFromDisk（复用）+ 增量播种/收尾；bootstrapLocalAggregators 拆 spawnLocalAggregator(starId)（含外部守护让位检查）；管理插座 server + op 分发（add-star / remove-star / set-showname / gen-key / set-name / set-port / **remove-node（--remove 节点删除）**——全调 registry.ts 库函数，回执带对账后状态）；stop() 先停插座；writeStatus 扩 adminPipe；**插座连上但回执超时=CLI 报错重试，绝不回落直写**（broker 活着即唯一写者）；**零星/删星后 node 拿死星钥连入的 BAD_AUTH 教学语核对**（点明"星可能未创建或已删除，找管理员"）。
- registry.ts：写侧 roster 不含 online；addStarTo 增 ensureSelfEntries；removeStarFrom 新增（splice 星段 + broker 机 node.json 自登记条目摘除）。
- serve.ts：删 bootstrapStar1/mutatingCmd 钩子；管理命令热路径连插座、冷路径直调库函数（打印区分）；--remove-star 旗标 + 将死清单；showName 热改。
- doctor/status：零星态教学行。
- 测试（seedBroker 随机口地基，不碰 7260 挂账）：热加星不重启即收发 / 删星即时收尾+发送直报已删 / 零星合法+doctor 教学 / 删最后一颗后 --add-star 重建 / roster 无 online 新旧互读 / 插座冷热路径与 stop 收口。

## 预算与停止条件

预算 **M**。停止条件：
1. `npm run check` 全绿（本票**零协议帧改动**——协议面归 034）
2. 真机 drill（win broker 在跑）：--add-star 免重启即时托管收发 → --remove-star 即时收尾 → 删最后一颗 → --add-star 重建 → 删后三段投递直报"星已被删除"；全程其他星零中断
3. broker.json 抽查：无 online 字段、零星态文件形状合法
4. 临时文件清理；提交并推送核 ahead
