## Summary

C11 从零入口原先固定 Windows 报告、pwsh 和 ConPTY，无法验证 POSIX 的完整接入流程。现在复用四目标合同，在 Linux/macOS 使用真实 PTY 和原生 Bash，按实际 OS/架构核对六阶段报告、串行释放和回归身份。

```text
四个原生目标 → 官方 npm/SRI → skill/身份/收发 → 诊断与真实终端
                                                ↓
                  分目标 artifact ← 正常清理 ← 更新/移除/聊天保留
```

既有从零工作流手动覆盖 Windows/Linux x64、macOS Intel/ARM；POSIX 先配置 Python、验证实际架构和真实 PTY，再安装 DSH。报告 job 仅默认分支有 Issues write，不 checkout 或执行 artifact 代码。Windows 旧 marker 和每周五 13:07 保持，新增 POSIX 每周五 14:07 仅在原生首验与后续明确合入决定后启用。

## Evidence

- **Before:** 真实 Linux PTY 被 Windows 守卫拒绝；目标合同 RED 14 失败/1 通过，实际 YAML 报告与矩阵 RED 6 失败/3 通过。原始记录保留在[开发记录](https://github.com/Oatelauser/crosschat/blob/0d0f91a81bbb7264cd2bca830013d64b40fa2c0a/docs/development/evidence/c12-posix-onboarding-20261105/pty-development.md)。
- **After:** Windows Node22.23.4 完整 `npm run check` **2827 通过/11 原有跳过，240 文件通过/3 跳过**，lint/build/导入图通过；78 项平台/实际 YAML 检查、真实 Linux PTY 七项与 Windows ConPTY 回归通过。
- 正式 Linux npm 工具、官方 SHA 核验 Node22.23.4、loopback 模型：rc.2 与 rc.5 各六阶段通过；完整 skill/原生来源、双向回信、诊断/真实终端、更新/官方插件移除和卸载后的 profile/聊天保留均核对。Host/登记/fixture/PTY 正常释放，forced=false，无 retry；同一 WSL 退出前安装根/默认缓存移除、匹配测试根进程 0。
- [95 份原始文件与 11 个源码 blob](https://github.com/Oatelauser/crosschat/blob/0d0f91a81bbb7264cd2bca830013d64b40fa2c0a/docs/development/evidence/c12-posix-onboarding-20261105/validation.json)、[自审与边界](https://github.com/Oatelauser/crosschat/blob/0d0f91a81bbb7264cd2bca830013d64b40fa2c0a/docs/development/evidence/c12-posix-onboarding-20261105/review.md)。实际 Linux 源码 3ebf6ca 的 9 个原生相关 blob 与候选一致；后续工作流改动不计为已经托管运行。
- 首轮长根 Unix socket 错误及 retained 记录保留；短 TMPDIR 的一次独立复核通过，基线依赖版本/SRI 图相同。SRI 抄写首败、旧单周更断言和未全部验证的路径假设也分别保留。
- macOS 六阶段和新版托管首验待本 PR 后续运行。旧 main [Ubuntu 来源确认锁失败 41969350805](https://github.com/Oatelauser/crosschat/actions/runs/41969350805)仍未定因，公共实现/断言未改，不宣称修复；实际 schedule、生产 Issue 写入、浏览器 UI、正式 Desktop 和跨机不计为本次通过。

## Merge Danger

**Door:** two-way

没有产品命令或持久数据格式迁移，src、包版本与依赖文件保持。此次用户批准推送、草稿 PR 与候选分支首验；main 合入、新 POSIX 从零周更和发布仍待另行决定。

**Blast Radius:** CI

每个原生 job 上限 75 分钟，四目标合计上限 300 原生 runner 分钟，另有普通三平台 CI。POSIX 的 Python 是验收工装依赖，不增加产品用户步骤。已有 Windows 从零及 C05 通信计划保持。
