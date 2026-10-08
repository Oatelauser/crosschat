# win↔云端 Linux NAT 单向联邦联测报告（Xshell 反向隧道）

日期：2026-10-08 · 环境：win11（hostname `yang`，sshd@22）↔ 云 Ubuntu（`118.196.47.9:22`，root，hostname `iv-yefd46fldsvr6olkju4j`，crosschat 1.3.3 npm 标准前缀）。网络**单向**（win 可出站连云，云连不回 NAT 内的 win）——回程由 Xshell 会话反向隧道承载（云 localhost:2222 → win sshd 22）。

## 结果

| 项 | 结果 | 证据 |
|---|---|---|
| 出腿自证 | ✅ | `ssh srv crosschat --version` → 1.3.3 |
| 全环自证 | ✅ | `ssh srv "ssh -o BatchMode=yes yang crosschat --version"` → 1.3.3（win→云→隧道→win 一条命令穿全环） |
| 真机投递 + `--json` via 透传 | ✅ | `crosschat send --via ssh:iv-… --to 云端beta --json` → `{"status":"delivered","turn":1,…,"via":"ssh:iv-yefd46fldsvr6olkju4j"}`（此用例此前仅 mock 覆盖） |
| 照抄回信闭环 | ✅ | 云端beta 照信封回执命令回信 → `--via ssh:yang` → localhost:2222 → 隧道 → win → 发起会话收信，`turn="2"`，正文"云端收到，闭环成立" |

## 发现

1. **回程别名必须带 `User <出站侧用户名>`**：无 User 行时 ssh 默认拿对端当前用户——实测 `root@localhost: Permission denied`。加 `User yangsheng` 即愈（已入联邦手册 NAT 节与失败对照）。
2. **云端标准前缀 Node 无 PATH 坑**：sshd 非交互 shell 直接可达 crosschat，与 1B' 结论（坑仅 nvm/自定义前缀）互证。
3. **隧道即会话生命**：Xshell 会话断 = 回程断（出腿不受影响）；当前保活 = keep-alive 30s + 断线手动重连。此形态已是"半 broker"运维形态，堡垒机形态（broker）仍是长期正解。
4. 三层错误码在 NAT 形态下与直连一致（`NAME_NOT_FOUND [via srv]` 透传 + 名单回显，0.7s 级）。

## 环境存续（常驻，非临时清理项）

密钥双向（win pub → 云 authorized_keys；云 pub → win administrators_authorized_keys）；win config 别名 `iv-yefd46fldsvr6olkju4j`/`srv`；云 config 别名 `yang → localhost:2222, User yangsheng`；Xshell 隧道随用户会话常开；云侧命名会话 `云端beta`。回程可用性随隧道状态。
