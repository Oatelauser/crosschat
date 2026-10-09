# 联邦手册验收冷走报告（federation.md 定版）

日期：2026-10-09 · 环境：win11（hostname `yang`，sshd@22）↔ 云 Ubuntu（`118.196.47.9:22`，root，crosschat 1.3.3），单向 NAT + Xshell 反向隧道回程（同 [federation-nat-tunnel-20261008](federation-nat-tunnel-20261008.md) 这条腿）。起点：**双侧 ssh 白纸**（2026-10-08 联测后已全拆）。

验收标准：执行者只拿 `docs/federation.md`、全程不问人，从白纸走通 Win 章 + Linux 章 + 单向 SSH 章，N5 闭环回落。（MacOS 章无环境，挂起未走——CI mac 观察位两连绿。）

## 结果

| 项 | 结果 |
|---|---|
| 亲走全程 | ✅ 一次通过，无卡点；走查终端实录未留存，以执行者结论为准 |
| 执行真实性佐证 | 双侧落盘痕迹与手册步骤一一对应：公钥双向装入（云 authorized_keys 恰含 win 公钥 / win administrators_authorized_keys 恰含云公钥）、云 config N2 回程别名块、云 known_hosts 隧道指纹，时间戳 2026-10-09 18:00–18:12 |
| 终点 | W8 / N3 / N4 自证出版本号，N5 闭环 turn 2 回落 win 发起会话 |

## 走查前预检修（5 处，走前已修并推送，代码零改动）

`722edb9` 三处：

1. **N2 顺序倒挂（必卡级）**：探活命令排在回程别名写入之前——白纸下 `ssh yang` 无从解析必卡 DNS。改为先写别名再探活；实字 `yang` 换 `<对端hostname>` 占位符
2. **N2 排障注释错引（误导级）**：Permission denied 指引去对端章"第二步"——装你的公钥实为其"第三步"（收对端公钥），一字之差方向全反
3. **keyscan 残留（误导级）**：L5/M4 主命令仍是 ssh-keyscan（accept-new 只是旁注），L1 WSL 注记、场景 D 亦残留——四处全部 accept-new 转正，对齐"一律 accept-new"已定规约

`7fad130` 两处：

4. **L7 无单向跳过注（必卡级）**：单向场景 L5 跳过后 `peer` 别名不存在，照走必卡 resolve 失败——补"单向跳过、由 N3 接管"，单向章前言点明"两处"=L5/L7
5. **W6/L5/M4 播种期望输出失真（误导级）**：手册自身顺序公钥交换先于播种，密钥认证不会提示密码——"输一次密码"改双条件备注

## 拆除（验收后即归零）

云侧 `scripts/fed-ssh-clean.sh` 全量清理（本次含删密钥对）；win 侧外科摘除三处（config 云块 / known_hosts 云指纹 ×3 / administrators_authorized_keys 云公钥行，WSL 腿钥匙未动）。环境回白纸，可随时重走。
