# WSL serve --stop 假报成功（028 drill F8）

label: wayfinder:design
status: open
blocked-by: （无——drill-028-20261017 F8 实锤）
claimed-by: 二期9

## Question

WSL（linux）侧 `crosschat serve --stop <星>` 打印"pid N 已终止"但进程仍活着：后续双开防护又见同 pid 在跑；带旧配置的僵尸守护重连报 STAR_ID_MISMATCH 且无限重试，排障成本高。kill -9 同 pid 立死——stop 路径没杀到真身（疑：状态文件记的 pid 是中间 shell/父进程，或信号发了但没确认死亡）。

## 定案方向（最小完整）

stop 后**确认死亡**：发信号后限时探活（pid 存在 + cmdline 匹配才算没死），超时升级 SIGKILL，仍活着才报错；成功口径改为"确认已终止"而非"已发信号"。win 侧 stop 已有"端口双重确认"先例，linux 对齐同语义。

## 预算与停止条件

- S 票：stop 路径一处收口
- 停止：npm run check 全绿；WSL 真机复演——起守护→stop→进程确死+状态文件复位+双开防护不再误报
