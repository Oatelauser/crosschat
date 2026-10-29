# C08-I01-R1 独立复审

2026-10-29（UTC+8）。固定范围 `fb5668d..b4d6a75`，RED `ede6ed3`、GREEN `b4d6a75`。八个变更文件均在白名单内。**尚未验收，剩余一个 P2：首次安装的 Windows 大小写别名重复。**

## Standards

根与祖先检查已在 effects 前执行；独立 preview 复现确认原 root-junction、ancestor-junction 的安装/卸载预览均变为禁用。未发现危险写删越界，不把读取元数据的次序扩大成额外安全问题。

`targetKey` 使用祖先 dev/ino 加缺失后缀，但后缀仍保留原大小写。Windows 新 home 尚无 `.claude`，DSH_HOME 指向 `.CLAUDE` 时仍返回三项；创建 `.claude/skills` 后变为两项。违反原单与 R1 的同一路径一次处理合同；shortcut 注释只是披露，未得到例外批准。

help 已修正。其用例检查整份 help 的关键词，辨别 install-skills 与 uninstall 各段的能力偏弱，属测试质量建议，不另判产品阻断。

## Spec

独立 Windows fixture 实测：fresh 计划三项、实际安装返回三项；安装后两种拼写的目录 dev/ino 相同，重算才变为两项。首次复制同一目录两次，因此“目标已存在”的 GREEN 不足以闭合合同4及 R1第2项。POSIX 大小写不同目录仍须保留。

其它两项接受：外部根/祖先链接被拒、合法外部目标与原指纹合同保持；现有 CLI help 说明三目标、DSH_HOME 和 --dir 隔离。未发现新增参数、源码文件、账本或用户操作越界。

## 验证与处理

root 实际运行七套件 **84/84**（max2/min1），对应worker结果；worker完整check **2541通过/11原有跳过**、203模块/682边、lint/build通过，原始 `I01-R1-check.txt` 含真实退出0。两轴各自最小独占fixture均已清理，没有访问用户skill或执行用户卸载。

首轮卸载 TypeError 已订正为证据限制，本轮 RED 是真正业务反例；不改写旧日志。R2 只补首次安装大小写反例与去重，不重做已通过的目录根/帮助产品修复。
