# 兼容性矩阵

## 单机行

| 兼容维度 | 事实 | 影响 |
|---|---|---|
| Node.js ≥ 22 | doctor 首检项；更低版本 ❌ | 装新 Node 即解 |
| 引用格式 mc2_ | 现行格式（≈84 字符二进制打包） | 新版签发 |
| 引用格式 mc1_ | 旧 JSON 打包，**永久兼容解码** | 旧信封/旧分片/旧账目不过期；新版只签发 mc2_ |
| 旧 CLI 读新引用 | mc2_ 旧版不识 → 报"trailing bytes"+升级教学 | 设计好的版本偏差路径，不是故障 |
| 短柄跨机 | 柄永不过网：跨机腿到达时已解析为完整引用 | 各机柄号独立，不冲突 |
| codex daemon ≥ 0.160 | 忙线程 turn/start 被接受并**入队**（开窗投递） | queued 语义的分界线 |
| codex daemon < 0.160 | 忙时投递走 parked 路径（~10s 停滞预算） | 功能不缺，语义退化、延迟变高 |
| Windows AF_UNIX | daemon 控制 socket 按登录会话隔离 | sshd/服务会话投 codex 报 10061；日常终端无感 |
| claude 接收前提 | 会话须带 crossSessionInbound: accept 启动 | 裸 `claude` 起的会话收不到（用启动器即解） |
| skill 版本 | doctor 与安装源递归比对（含 references/） | 升级后重跑 install-skills 即对齐 |

## 跨机行

<!-- 跨机协议兼容（tcp PROTOCOL_VERSION、星节点版本对账、ssh 端 CLI 版本要求）：待 ssh/tcp 专家补 -->
