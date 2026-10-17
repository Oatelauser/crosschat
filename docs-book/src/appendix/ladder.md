# C 验证阶梯

装完就停下、学完不练手都会忘。验证阶梯是"每级一条命令、当场见判据"的自检序列——从单机起步，一级一级往上验，哪级不过就回去补哪级。

## 单机自检阶梯

| 级 | 命令 | ✅ 判据 | 不过=回去看 |
|---|---|---|---|
| 1 装上了 | `crosschat --version` | 打印版本号（如 `1.6.4`） | [环境搭建](../preface/04-env-setup.md) |
| 2 依赖齐 | `crosschat doctor` | 结论行全 ✅ 或仅 ⚠️（❌ 必须处理；退出码 1 = 有 ❌） | [环境搭建·doctor 自检](../preface/04-env-setup.md#doctor-自检) |
| 3 有人在线 | `crosschat status` | 本机会话计数 ≥ 1，能看到你起的命名会话 | [第1课 1.4](../tutorial/lesson-1/04-first-chat.md#起两个命名会话) |
| 4 发得出去 | `crosschat send --to <名> --body "自检：收到请只回 OK"` | 回执 `delivered … · 续话 cN` | [第1课 1.4 发第一条消息](../tutorial/lesson-1/04-first-chat.md#发第一条消息) |
| 5 收得到、回得来 | （等对方照信封回信） | 你的会话收到回信信封，turn 递增 | [第1课 1.4 对话全景](../tutorial/lesson-1/04-first-chat.md#对话全景) |
| 6 查得到 | `crosschat status --conversations` | 这段对话一行：方向/轮次/末态/短柄都在 | [如何查看在线会话](../howto/status.md) |

四级是最常用的"发一条试试"——两条命令一分钟走完 1、2、4；五、六级验的是异步回环，需要对方会话活着。

## 跨机阶梯

<!-- 跨机验证阶梯（ssh 自环/双机联邦、tcp 星入网）：待 ssh/tcp 专家补 -->
