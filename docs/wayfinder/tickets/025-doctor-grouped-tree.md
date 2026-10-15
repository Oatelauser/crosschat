# doctor 分组树展示（按检查类型聚合，tcp 按星分组）

label: wayfinder:design
status: open
blocked-by: （无——015 doctor 降噪的续篇，展示层改动）
claimed-by: （待领）

## Question

用户 2026-10-15 反馈（v1.6.2 实测）：doctor 输出是平铺清单，"tcp 节点条目 1/2 可解析""条目 2 broker TCP 不可达"这类**编号条目**看不出哪条属于哪颗星——多星机上一屏条目与星的对应关系要靠脑记。要求按检查类型聚合（父子分组），tcp 段按星聚合。

## 方案

**只动展示层**：检查项集合、判定逻辑、诊断文案、退出码语义、结论行全部不变——重排为两级缩进分组（组名行顶格、条目行缩进两空格；不用框线，保持 grep 友好）。目标形态（对应用户实测输出）：

```
crosschat doctor
环境
  ✅ Node v25.0.0 (≥22)
  ✅ claude CLI …（可路由会话 2 个）
  ✅ codex CLI 0.160.1
  ⚠️ codex daemon 未运行；要用 codex 通道时先执行: codex app-server daemon start
  ✅ claude 侧 skill 与安装源一致
  ✅ codex 侧 skill 与安装源一致
  ✅ 无双身份残留
tcp · cloud-broker
  ✅ 节点条目可解析
  ✅ broker 可达（118.196.47.9:7777）
  ✅ broker 注册表可解析（1 节点）
tcp · wsl-star
  ✅ 节点条目可解析
  ❌ broker 不可达（127.0.0.1:7260）——确认 broker 机 crosschat serve 在跑、网络/防火墙放行端口
  ℹ️ 陈旧状态文件（守护已停止）跳过版本对账：status-broker.json——确认无用后可删除
其他
  ✅ 发件箱空（无暂存消息）
结论: 11 项通过，1 项警告，1 项错误
```

分组与归属规则：

- **环境**：Node/claude CLI/codex CLI/codex daemon/双侧 skill/双身份
- **tcp · `<星名>`**：该星的节点条目可解析、broker 可达、注册表可解析、守护版本对账；陈旧状态文件按文件名里的星归属（`status-<role>-<星>.json` → 对应星；无星段如 `status-broker.json` → 该星所在组或"其他"，实现期按状态文件产生者归位）
- **其他**：发件箱等不属于前两组的杂项
- 编号条目（"条目 1/2"）退役——星名即分组标题；同星多条目（多 broker 同星？现形状一星一条目）实现期若出现按行内标注

## 预算与停止条件

- 规模 S 票 ≤150 行（含测试断言重排；doctor 相关既有测试全量更新）
- 停止条件：npm run check 全绿；真机——多星机（cloud-broker + wsl-star）输出逐星聚合、不可达星一眼可辨；结论行与退出码与改前一致
