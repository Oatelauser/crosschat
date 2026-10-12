# 双 drill 实录：011 多星闭环 + 012 远程枚举闭环（2026-10-12）

> win（yang，双星成员）+ cloud（cloud-broker 星）+ WSL（wsl-star 星）。全程 1.5.5 真机。

## 012 远程枚举（关票）

- `crosschat status --via tcp:iv-yefd46fldsvr6olkju4j` → 列出云端会话（claude broker4 idle + codex unavailable **部分应答语义正确**）
- 查到即发：`send --via tcp:iv-… --to broker4` → delivered (turn 1)。**枚举→直发一气呵成，"赌名字"时代结束**

## 011 多星成员（关票）

拓扑：win 同时入 cloud-broker（公网 7777）与 wsl-star（本机 WSL，7260）双星：

1. WSL `serve --name wsl-star --detach` + `--gen-key 1`（gen-key 探测即出 192.168.1.3）
2. win node.json 双条目合并（数组形状，starId 各随钥匙）；`--connect wsl-star --detach` 上线
3. 双星自环：`send --via tcp:wsl-star:ec542c2c --to tcpworker4` 与 `--via tcp:cloud-broker:ec542c2c` 均 delivered，接收侧 tcpworker4 两腿均回执确认——**双星各收发一条 + 回信按 ref 星标识自动选星全链实证**

顺带实测通过：星名选择器、多星限定词 `tcp:<星>:<mid8>`、**星内同名机器（win/WSL 双 yang）mid8 消歧**、mc2_ 尾部星标识随轮次携带、A+ 瘦信封照抄。

## 现场抓获两条（新知）

1. **WSL 镜像网络：win→WSL broker 必须用 127.0.0.1**——WSL 报的 LAN IP（192.168.1.3）从 win 不可达（探测不可达→改 127.0.0.1 秒通）。broker.md 1.1 情况4 已补注
2. **同机同星双守护互顶乒乓**：手工连起第二个 cloud 守护后，新旧同 mid 连接互相顶替循环，发送撞上断连窗口报 PEER_OFFLINE。清场（--stop 到无进程）重启单守护即愈。**改进挂票 013**：--connect 时检测本机已有同星守护 → 拒绝并提示（防手滑双开）

## 停止条件对账

- 011：双星双 broker 真机闭环 ✅（各自收发+回执）；单星零回归有快照锚定 ✅ → **关票**
- 012：真机双机闭环（枚举+直发）✅；旧 broker 偏差超时教学有测试 ✅ → **关票**
