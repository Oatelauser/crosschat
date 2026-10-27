# 1.13.1 发布记录

2026-10-27。沿用用户“只提交你修改的代码 + 发布新版本”的授权。本补丁接续 [1.13.0 发布](release-1.13.0.md)，源代码、依赖及功能实现保持，仅修正打包 skill 的旧用法并递增版本。

1.13.0 的主线提交 `d80662f1b31994e69dedbe799a7ac95246361d94` 已通过 Windows、Ubuntu、macOS CI（运行 `40463509526`），GitHub/npm 发布运行 `40463892799` 成功；npm 处理后已公开可查。发布后复核实际包发现 `references/stars.md` 仍教裸 `/resume` 自动归队、泛化的 `--rm` 清册和 id8 下线逃生口，与已批准的新行为冲突，因此追加此补丁。

## 修改范围

- `skills/crosschat/references/stars.md` 更新统一入口、首条输入与选择跟随、窗口声明释放、已有永久属性保护、node 重启及 TUI 管理/改名能力。
- `skills/crosschat/SKILL.md` 的章节入口补充 TUI 会话管理，继续将详细规则集中在星成员章节。
- package/lock 只更新本项目版本到 1.13.1，更新 CHANGELOG 与本记录；没有改产品代码、测试规则、依赖或其他聊天文件。

本地验证 skill 相对链接、旧行为移除、包内说明与源码一致及 `--version`。产品检查沿用 1.13.0 的 1814 通过/11 原有跳过与三平台结果；此补丁仍由既有线上 CI 及发布工作流执行完整 `npm run check`。

公开版本、完整性及 provenance 回执保存在仓库外 `C:/Users/yangsheng/.codex/artifacts/crosschat/release-1.13.1/`。正式结果见 [GitHub v1.13.1](https://github.com/Oatelauser/crosschat/releases/tag/v1.13.1) 与 npm 注册表；不会重发覆盖 1.13.0。
