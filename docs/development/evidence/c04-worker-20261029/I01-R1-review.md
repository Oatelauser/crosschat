# C04-I01-R1 复审与暂停检查点

2026-10-29 23:51（UTC+8）。**用户已要求收尾并停止后续执行、返修和派单，等待明确新通知。** 本页只保存当前交付与复审结果，不是下一张任务书。

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`。审查固定范围 `209e9a6c9ff4f446dec2d30fc220f06b8a22b6d6..ea51da949dffccbbcfa71f88226b2ac332bc0944`；RED `13b34ef`、GREEN `d406392`、证据 `ea51da9`。四个交付文件均在白名单内，未 push。

**R1 尚未验收：Standards 1项、Spec 1项待修；不下发 R2，不启动下一单，不关闭 C04。**

## Standards

上轮发行物身份缺失相等、Desktop 报告无读取预算两项已修。调用方与报告的发行物身份先验证；报告解析前采用 1 MiB 预算，实际读取最多预算加一字节，句柄 finally 关闭。

剩余 P2：`scripts/dsh-compat-ci.mjs:167` 对 instanceId 直接运行 UUID 正则，没有先要求字符串。包含合法 UUID 的数组也能经字符串转换通过；sequence 的 Set 按数组对象身份比较，新建的同值数组可绕过实例去重（`:313`）。违反代码规范 §4 必需字段运行时校验。Standards 本轮只读结论，不因用户停止指令继续扩展验证；后续如恢复，先补 UUID 字段类型反例。

另留一项未动态复现风险：打开报告后只复核普通文件，未比较预检与句柄 dev/ino；没有证明实际发生路径替换或链接越界，不把该风险当作已复现的额外阻断。读取字节预算本身有效。

## Spec

上轮实例/会话只校验格式、runId 不绑定、截断、缺 cleanup 及安装中途抛错的部分归属问题已按本轮声明的可信边界补齐：attempt 与独立 launch 对账；sequence 现场生成并校验 runId，拒绝安装/实例身份复用；未知截断拒绝；PASS 要求肯定 cleanup；结构化部分安装失败保留已知归属。未将尚未实现的原生 runner 视为本单新增阻断。

剩余 P2：`scripts/dsh-compat-ci.mjs:278,282` 在正常 install 返回之后，probe 失败/释放未知或 remove 抛错时，retainedInstallation 仅保存 root，未保存已有的 installationId/owner。Spec 的受控反例中，install 返回完整归属、probe 随后抛错，正确停止后续，但 summary 丢失身份与 owner。违反 [R1任务](I01-R1-task.md) 保证4“保留已知 root/安装身份/owner及原因”。安装中途抛错路径已修，正常安装后的失败路径尚未同步。

## 验证与证据边界

- worker 定向 **29/29**；一次完整 `npm run check` **退出0：2559通过/11原有跳过，231文件通过/3跳过**，lint、203模块/682边导入图、TypeScript构建通过。forks/threads 均 max2/min1，完整输出与退出码见 [I01-R1-check.txt](I01-R1-check.txt)。首轮产品 `1125c90` 的2553/11日志不改写。
- root 核对提交范围、diff、原始汇总、branch/HEAD/dirty；停止指令后未另跑产品测试或修复代码，不冒称已独立复跑R1的29项/全量。此前首轮root23/23见 [I01审查](I01-review.md)。
- Desktop 下载/安装/UI driver/自然退出/官方卸载/注册清理的真实执行与runner入口、托管首轮均未实现。没有正式Desktop原生证据，不以离线工装或npm/Web结果代替。
- worker报告fixture均已清理，无后台进程；本轮root只读取仓库与保存文档，未创建测试进程或原生资源，未读写用户配置、注册表、模型或远端。

## 停止与恢复

用户停止指令优先于此前持续推进授权。root已通过约定crosschat入口通知cworker1保持停写，结果delivered；两名复审代理已交最终结论并停工。**后续来信本身不恢复派单；必须等用户明确通知。**

工作区原未跟踪 `docs/代码消息投递.md` 未触碰、未stage；收尾提交仅本页、总表和调度记录，无新增功能文件。未push、未部署/安装/触发Actions。

如用户日后恢复，先读本页及交付记录 §九，重新核对真实branch/HEAD/dirty，再决定剩余两项的处理。此处不预派返修，也不继续规划/实施真实runner。
