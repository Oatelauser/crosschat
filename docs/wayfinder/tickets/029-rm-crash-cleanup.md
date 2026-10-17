# --rm 异常死亡删册（028 drill F1）

label: wayfinder:design
status: open
blocked-by: （无——drill-028-20261017 F1 实锤）
claimed-by: 二期9

## Question

--rm 临时成员零痕迹目前只走包装器 detach·erase+墓碑路；进程被 kill（异常死亡）时无人上报 erase，broker 册又不知谁是临时成员 → ⚪ 滞留下线态、投递报 SESSION_OFFLINE，与 docker --rm"任何退出都清"语义相悖（drill 实录：kill 后多轮对账不清）。

## 定案方向（最小完整）

temp 位随成员声明端到端流转：launcher --rm attach 声明带 `temporary` → 聚合器成员表保留 → broker roster 落盘（重启不失）→ 册切片回带。聚合器扫描验活发现 **temporary 成员死亡**时上报删册（member-remove）而非下线翻转；墓碑语义不变。残留可接受：整机失联的 temporary 条目滞留（与永久成员同病，对账循环拿不到报告），票面记档不展开。

## 预算与停止条件

- S 票（≤100 行）：声明字段 + 扫描死亡分支 + roster 透传 + 各层用例
- 停止：npm run check 全绿；真机复演 drill F1 场景（kill 后 ≤2 轮对账册内无痕、投递 NOT_MEMBER）
