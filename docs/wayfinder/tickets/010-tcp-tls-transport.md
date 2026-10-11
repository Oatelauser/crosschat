# tcp 传输 TLS（公网加密 + 钥匙防截）

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

proto:1 是明文 WebSocket。公网直连（形态：云端堡垒）下存在两层风险，第二层比已声明的更重：

1. 内容可截看（文档已声明，用户 2026-10-11 拍板接受）
2. **钥匙可截走 → 身份可伪造**（文档原表述"伪造被 PSK 挡死"在明文公网下不成立）：`connect` 帧的 `auth` 钥匙明文过网，路径窃听者抓到即可冒充该节点身份发消息——TLS 不是锦上添花的保密，是**让钥匙防伪成立的前提**

### 方案倾向（2026-10-11 设计卡，用户待拍板形态细节）

**自签证书 + 钉指纹（TOFU，ssh host key 同款哲学）**——零域名零 CA：

- broker 首次 `serve --tls` 自动生成自签证书，打印/持久化 sha256 指纹
- `--gen-key` 输出的 node.json 增加 `"tls": true, "pin": "<指纹>"`；节点 wss:// 连接并核对指纹，中间人换证书即被钉住
- 进阶：`--tls-cert/--tls-key` 挂正式证书（Let's Encrypt），此时档案省 pin
- 惰性兼容：不带 `--tls` 照旧明文跑，内网场景零变化
- 实现决策点：证书生成走小依赖（selfsigned 类，win 可靠）还是 shell 出 openssl（win 不可靠）——倾向依赖

## 预算与停止条件

- 规模 M 票：证书生成/指纹核对/wss 接线/gen-key 与 doctor 联动/协议 caps 标注/测试/手册协议章更新
- 停止条件：内网明文回归全绿（零回归铁律）；wss+pin 真机双机（win 节点 + 云 broker）drill 一轮过；pin 不符拒绝且有教学报错
- 发版：随 v1.6.0（或与 011 合批，用户排期拍板）
