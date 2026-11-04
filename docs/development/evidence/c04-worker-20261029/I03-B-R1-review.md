# C04-I03 阶段B R1双轴复审

2026-11-02（UTC+8）。固定比较 `b5dbe7c18298593307a59b33b00b4d1b055f51f9...fe96cb7d6a4d7a669d6c88bc053b9fc4517f3379`；唯一交付提交fe96cb7。规格 [I03-B-R1-task.md](I03-B-R1-task.md)，原始准入范围沿I03-B-task.md。结论：文件一致性、有界文件等待、迟到open、唯一close和冻结错误包装已修正；签名child仍有两个组合缺口，同单R2，不验收、不进入安装执行。以下行号均对应fe96cb7。

## Standards

独立审查1组P2，无另报smell。`scripts/dsh-compat-ci.mjs:565` 的child error事件直接finish，绕过统一close等待和父侧引用释放，若已进入取消/超限收尾还会清掉等待timer。违反规范§4/§5及R1保证3“spawn error共用owner、只有close证明退出”。

动态反例：child发error但无close，立即返回signature错误，kill=0/destroy=0/unref=0，无releaseUnclear；70KiB输出触发停止后，kill失败并发EPERM error，立即以EPERM替代输出超限主因，destroy/unref仍为0、无未确认退出信息。data监听已正确移除，但未退出child和管道引用未释放。应让已有child的error进入同一有限收尾，保留首个主因，观察close或明确报告释放未确认。

## Spec

独立审查2项P2，无范围扩张：

1. **总截止覆盖已取得的清理失败信息。** 同文件740–744行只保存stage=cancelled的late.error。child先输出超限进入释放等待，随后总截止到达时，适配器返回的stage=signature及releaseUnclear被丢弃，入口仅抛普通取消错误。违反R1第3组的未确认释放报告与第4组错误保真。实证：70KiB、kill=false、无close、timeoutMs=50；约1014ms返回，错误仅有stage/unresolvedResources，无releaseUnclear；适配器已destroy两根管道并unref，说明清理信息已取得却未传出。
2. **已有child的error仍绕过收口。** 同文件565行直接finish，既未确认close也未有限等待。合成child在spawn返回后发error且无close，入口立即返回，kill/destroy/unref全0。违反R1第3组，须区别同步spawn抛错未产生child与已有child的error事件，后者按同一owner收口。

两轴分别计数：Standards 1组、最高P2；Spec 2项、最高P2。child error问题为两轴共同发现，仍是原R1第3/4组，未扩大任务。

## root验证与全量失败归属

- root独立定向70/70、退出0；四个VITEST fork/thread上下限2/1，移除测试环境CROSSCHAT_LIVE。syntax及代码范围diff检查通过。
- worker新反例RED 7失败/63通过、GREEN 70通过；一次完整check退出1，4失败/2596通过/11原有跳过、229文件通过/2失败/3跳过。原始I03-B-R1-check.txt保留，不写成全量通过。
- 四条失败在conversations.test.ts和conversation-state-concurrency.test.ts；src/state-lock.ts、src/conversations.ts及这两个测试文件本轮均零diff。旧B完整检查通过，R1没有靠回退共享文件归责。
- root只导入现有dist/state-lock.js，独占TEMP中创建10个新目录，用相同canonical directory/key公式算端口，分别进行一次loopback bind与timeout=0的withStateLock调用：4个bind报EADDRINUSE，且这4次均acquired=false、work未执行；其余6次均成功。未导入或执行准入模块。探针支持当前环境中独立会话锁路径存在失败，未确认这些端口的具体占用/保留来源，也不冒充逐条首败的完整因果证明；不把本单白名单扩到通信/状态产品。
- root探针的监听均已close，临时根经绝对范围校验后finally删除，输出FIXTURE_REMOVED=true。两轴探针仅内存spawn注入、合成child、自有小TEMP文件，finally补发close并清理；无真实PowerShell/官方EXE/安装/卸载/网络或用户状态操作。
- 原用户未跟踪docs/代码消息投递.md、五个被拒URL和I02/W05历史保留均未触碰。未无理由重跑全量。

## 同单决定

按 [I03-B-R2-task.md](I03-B-R2-task.md)仅修上述child/错误传递组合。完整检查未绿和会话锁归属保留为独立验证事项，不由准入worker修改或用重跑抹掉。R2完成后再复审；I03整体与C04父项均未完成，无原生Desktop通过证据。
