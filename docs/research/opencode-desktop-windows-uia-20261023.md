# OpenCode Desktop Windows UI Automation 研究记录

2026-10-23。曾为正式发布包没有 CDP 的情况研究 Windows UIA，使用本次创建的独立 WPF 窗口验证系统能力。之后真实发布包已证明接受显式 loopback CDP 参数，因此交付仅保留 CDP 路线；未使用的 UIA/WPF 临时工装已移除，不增加第二套长期维护代码。

## 已验证的系统能力

自有 WPF 窗口 4/4 通过：准确 PID、可执行文件、启动时间及 HWND 绑定；真实 ValuePattern.SetValue、TextPattern 和 InvokePattern 操作；PrintWindow 仅抓指定窗口；错误启动时间在操作前被拒绝。没有全局键鼠输入、前台窗口切换、全屏截图或用户剪贴板操作。

[结果](../development/evidence/opencode-desktop-20261023/uia-research/result.json)与[自有窗口截图](../development/evidence/opencode-desktop-20261023/uia-research/owned-window.png)保留。截图已实际检查。四轮临时窗口 PID 39472、31016、39852、42676 均已核对退出；临时目录归本次 workspace cache，在最终清理时单独核对。

首轮 WinForms 的旧托管 UIA 只暴露通用 HWND Pane，不能证明存在 Value/Invoke 模式；后改用 WPF。研究还暴露空 Bounds/Infinity JSON 与辅助进程解析失败后的回收问题，临时工装修正后重跑通过。这些结果均不构成 OpenCode 产品互通验收，不能用 WPF 控件能力推断 Electron UI。

## 依据与取舍

- 从目标应用 HWND 开始读取有界子树，避免遍历整个桌面。[Microsoft UIA 元素获取](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-obtainingelements)
- 控件是否支持写入由实际 Pattern 决定。[ValuePattern.SetValue](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue?view=windowsdesktop-9.0)、[TextPattern.DocumentRange](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.textpattern.documentrange?view=windowsdesktop-9.0)
- PrintWindow 是同步窗口绘制请求，成功回执不能代替截图检查，需外部时间预算。[Microsoft PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow)

当前正式桌面 probe/CI 不调用 UIA，也不自动切换到该方案。未来若 CDP 合同改变，应由兼容检查明确失败并重新评估，不能静默改用不等价的 UI 操作来宣称兼容。
