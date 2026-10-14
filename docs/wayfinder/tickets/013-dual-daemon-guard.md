# 双开防护：--connect 同星守护互顶拒绝（013）

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

`serve --connect <星>` 起节点守护时不检测本机是否已有**同星**守护在跑。现场抓到：同星双守护并存后互相顶替乒乓（broker 同 mid 后连顶先连 → 两守护轮流把对方顶掉，在途消息/回执随顶换丢失；本地 status-node-*.json 互写抖动）。现状唯一防线是人记得先 `serve --stop`。

## 拍板与选型（2026-10-14 用户三问全 A + 俯瞰定案）

1. **撞上=硬拒绝**（exit 1 + 教学）；否决自动顶替（隐式杀进程、动词语义漂移）与幂等跳过（升级重启场景静默失败——用户要的是换新守护，跳过=旧守护白跑）
2. **同星判定=解析后的星身份**：名字/starId 前缀/裸 `--connect`（默认腿）各自归一后比对，防换拼写绕过
3. **不加 `--force`**：`serve --stop <星>` 即逃生门
4. **探测=进程扫描而非 lockfile**：护栏与 `serve --stop` 必须看见同一个世界（lockfile 会出现"锁拦你但 stop 扫不到持锁者"的自锁死局）；不引入需死期管理的新状态文件（014 纪律）
5. **教学命令用活守护自己的 cmdline 拼写 + pid**（stop 是字面匹配选择器——若活守护是 `--connect wsl-star` 起的、你用 `5aed24` 撞上，必须教 `stop wsl-star`）
6. 扫到但解析不出星名的 cmdline **保守放行**（拦错锁死用户，放行维持现状）；双 connect 毫秒级竞态（TOCTOU）接受
7. 不入本票：doctor 活双守护检测（状态抖动侧写）——留观察

## 预算与停止条件

- 规模 S 票：connect 前置进程检查 + 拒绝报错（含教学）+ 测试（前台与 --detach 双形态、异拼写同星、不同星放行、乱码 cmdline 放行、正常 connect 零回归）
- 停止条件：npm run check 全绿；真机双开实测拒绝、教学命令可直达解困
