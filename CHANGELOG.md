# Changelog

本项目的全部显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [1.0.1] - 2026-10-02

- README 移除曾用名注记；首验 Trusted Publisher (OIDC) 自动发布管线

## [1.0.0] - 2026-10-02

首个公开版本。Windows 一期：本机 Claude Code ↔ Codex CLI 跨会话消息，无守护进程，原生投递。

### 新增
- 四命令 CLI：`send`（同步投递/自包含引用/轮次计数）、`status`（双侧总览含目录时间）、`install-skills`、`claude`（接收许可包装启动）
- Claude 侧通道：sessions 注册表发现、named pipe + peerToken 鉴权、peer 协议 v1 帧注入
- Codex 侧通道：app-server proxy 桥接（ws-over-stdio）、resume→turn/start 投递、busy/locked 等待循环
- 溯源信封（回复命令自带教学 + 保留字中性化）与 agent 侧 skill（低入侵：题词只写角色）
- 防乒乓限流（30 条/60s/对端点）、16KiB 单条上限、身份冲突自纠指引
- 机会式发件箱：忙/锁超时 parked 落盘，任意 send/status 调用入口自动排涝补投
- daemon 0.160 开窗投递支持（同 daemon 多连接绕过进程级写者锁，实证）
- 双 bin 过渡别名（crosschat 主 / multichat 曾用名）

### 过程档案
- 设计决策地图（wayfinder）、实测研究报告 ×4、联调实证 ×2 随仓库公开（已脱敏）

[1.0.0]: https://github.com/Oatelauser/crosschat/releases/tag/v1.0.0
