# 多星 WS 连接复用（同机多星连接收敛）

label: wayfinder:design
status: closed
blocked-by: （无——但排期在 1.6.2 之后；019/020 批次在飞，map 挂账行验收时补）
claimed-by: broker多星

**优先级 A（用户 2026-10-15 指定，要求排期）**

## Question

同机器多星场景下连接/进程数随星数线性增长，用户要求优化复用 WS 连接。可行性分场景（物理边界：一条 WS = 一个 TCP 端点，跨端点不可合并）：

1. **跨 broker 机多星**（一机挂 N 星、N 台不同 broker）：❌ 物理不可复用。连接廉价（30s 心跳几无流量），真实成本在管理面（N 进程/N 日志）不在资源——若痛点是管理面，优化对象是运维面不是连接
2. **同 broker 机托管多星**（现状每星一 serve 进程、不同端口）：✅ 可做
   - 方向 A：一进程托管多星——connect 帧带星选择（或钥匙自证星籍，node.json 条目已含 starId）；broker.json 单星形状要改；协议演进级（估 M~L）
   - 方向 B：维持多进程——同机/回环连接开销可忽略，接受 N 条（零改动）
3. **broker 机自挂本星**（`serve --connect <自家星>` 回环 WS 连 127.0.0.1，手册 2.7 第 1 步）：✅ 可做且收益最实——聚合器职责（attach 管道服务端+成员表+活性扫描）in-process 内挂在 broker 进程里，省回环 WS 与第二个常驻进程；attach 管道路径/成员语义/013 双开护栏不变（估 S~M）
4. **瞬态发送腿连接池**（send 每次新开 WS）：与"send 无状态、全机种同一条发送路径"教学原则（3.3 设计取舍）冲突，预期否决留痕——除非实测握手延迟（100-300ms/次）成为真实痛点再议

## 用户场景收口（2026-10-15 追问"为什么一个端口不能当多个 star"）

场景实指 = **方向 2A 完全体：同一 broker 进程/端口托管多颗星，不同机器的不同星群都放一个 broker**。确认非物理障碍（物理只挡跨端点复用），是协议形状选择；用户接受合并故障域代价（自部署形态星主同一人）。设计要点：

- **握手时序倒置**：现 info 帧先报 starId 供节点 STAR_ID_MISMATCH 预检（钥匙不出手）；多星下 broker 见钥匙才知星——starId 改到 connected 帧后核对，单星连接行为不变（零回归）
- **钥匙自证星籍**：connect 带.key，broker 反查（星,机器）；node.json 条目已含 starId+key，形状不动
- **注册表多星化**：broker.json nodes 按星分组、gen-key 按星、--list 按星
- **连接复用两级**：最小版=同端口一星一连接（省端口/进程管理面）；完全版=一条 WS 绑多星（帧带星上下文或逻辑通道复用），caps 协商加 multi-star 能力（沿 018 caps 模式，proto 不翻页），老节点不受影响
- **故障域合并为已接受的运维代价**（一进程崩=所有星瘫、升级窗口合并）——CHANGELOG 与手册明示
- **设计锚点（防跑偏）**：连接层 broker 本就是 epoll-reactor（Node 事件环复用星内全部机器连接），本票合并的是**星级进程**不是连接多路复用；模型同构 vhost/SNI——key 选星上下文 ≈ Host 头选 vhost；完全版一条 WS 多星 ≈ HTTP/2 流复用；broker 活是纯 JSON 路由（I/O-bound），**零 worker 池**，勿过度工程

## 待定（grilling 收口 → 2026-10-18 实施会话定案）

- ~~完全版帧面：帧带星字段 vs 连接内逻辑通道~~ → **定案：连接绑星，帧面零改动**。钥匙自证星籍在 connect 握手定星（SNI 同构），连接生命周期内属星不变；帧不带星字段、无逻辑通道。理由：设计锚点明言"本票合并的是星级进程不是连接多路复用"；票面自证连接廉价（成本在管理面=进程/端口，非 TCP 条数）；零帧面改动=零回归面最小、零 caps 强制协商。info.caps 追加 'multi-star' 标识（018 additive 模式，纯信息性——多星 broker 的 info 不再携带 starId/name，客户端据 connected 帧新字段核星）
- ~~broker 自挂 in-process（原方向 3）是否并入~~ → **定案：并入**。同一进程模型改动，分票会二次触碰同批代码；F4（星心机自挂双连撞死）正是本票 drill 验收项。实现取**虚拟会话对**（virtual socket pair 注入 NodeClient ws 工厂）：聚合器逻辑全走真实 onConnect/onSessions/路由路径，零新成员/路由代码；本机已有同星外部守护时让位跳过（升级窗口平滑）
- ~~020 限定词解析联动确认~~ → **定案：零冲突确认**。三段寻址客户端侧已按星选条目（selectBrokerEntry：星名/starId 前缀），连接即星；broker 侧 targetMachine/tool 限定词解析（resolveSessionMember）全部在 session 所属星的注册表切片与册内进行，纯星内操作天然隔离

## 实施形状（2026-10-18 定案细节）

- **注册表双形状**：单星=旧 broker.json 形状字节不动（零回归）；`--add-star <名>` 加第二星起转 `{port?, stars:[{starId,name?,nodes}]}` 新形状，回读兼容旧形状。add-star 时迁移 roster.json → roster.<星名>.json，且 broker 在跑则拒（防在跑册与迁移册漂移）
- **每星独立册**：多星形状下 roster.<星名|starId>.json；单星沿用 roster.json（零迁移零回归）
- **握手时序倒置（限多星）**：多星 broker 的 info 帧不带 starId/name（broker 见钥匙才知星），connected 帧补 starId+name 供新客户端核星；单星连接字节级不变。老节点连多星 broker：跳过预检照常工作（钥匙即路由）
- **CLI**：`serve --add-star <名>`（一次性）；多星下 --gen-key/--remove/--name 需 `--star <名|starId前缀>` 限定（裸用=USAGE 教学）；--list 多星分组展示；serve 裸跑=托管全部星
- **自挂让位与 013 延伸**：guardSameStarDaemon 认 status-broker.json stars 列表（pid 验活）——本机 broker 内挂星域后拒手动 serve --connect 同星（F4 消除）；反向：起 broker 时本机已有同星外部守护则该星跳过内挂
- **故障域合并**：CHANGELOG 与手册明示（一进程崩=全部星瘫、升级窗口合并）

## 预算与停止条件

待场景收口后定（方向 3 估 S~M：进程模型收敛+测试；方向 2A 估 M~L：协议形状+注册表+全链回归）。
→ 收口后实按 **M~L** 执行（派单口径）；停止条件：check 全绿 + win/WSL 双机 drill（一进程两星/每星独立册/broker 重启册不丢/单星零回归）+ 报告落 docs/drill-reports/。
