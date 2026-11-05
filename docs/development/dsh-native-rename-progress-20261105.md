# DSH原生改名：C20条件能力续接

2026-11-05。用户持续开发授权，root独立。工作区D:/workspace/CC/cc-dsh-rename-20261105、分支codex/dsh-native-rename-20261105，基线948e58f（DSH Windows npm/Web入星切片已验收）。权威总表在原工作区，25父项/11CI索引与其它负责人保持。没有推送、发布、外部Actions或Desktop操作授权扩展。

已核实官方rc.2/rc.5的SessionTitleService.rename(session,title)为同步调用：检查同一live session，追加原生session/title事件，再返回接受快照。来源与发行物摘要见[C15原生模块索引](evidence/c15-dsh-operations-20261105/module-index.json)。外部sessionController.rename先resolveAgent，可能激活历史会话；本适配不走它，不创建/恢复替代目标，不改数据库。

## 本轮实现与验收边界

- 沿用已批准TUI原生改名动作、名称校验及applied/rejected/uncertain；不新增用户命令/参数、必需步骤或crosschat持久数据文件。原生标题事件属于已有DSH会话存储。
- 只在已验证的npm/Web入口核实后启用；Desktop、未知profile/版本或缺服务的入口单独禁用，不因同家族或方法存在而继承。保留入星等独立能力。
- 现有Bearer loopback桥增加完整会话的title子资源：GET只读核实当前实例/原生创建信息及能力，并给出内存中的活Agent代次；POST只接受有界名称与预期实例/创建信息/活代次。代次用WeakMap跟随原对象回收，不新增账本或数据文件，避免相同Host/ID/原生创建时间但Agent被恢复替换时复用旧确认。认证、Host/Origin、完整不透明ID、当前root身份和类型均沿现有合同；读取不产生标题事件。
- 通过当前Host的ctx.get('sessionTitle').rename(agent.session,name)写入，执行前再次核实同一root；不在最终身份校验与同步写入之间await。缺目标、旧实例/创建信息、输入错误在写前拒绝；原生调用后异常/丢回执保持uncertain，零盲重试。读取恢复不重放写入。
- Adapter复用既有登记/握手/完整目标与上下文核验，TUI最终确认绑定实际端点/owner/版本。实际返回名称与请求不同或后续同步未确认时，不能宣称applied。
- 真实验收须覆盖同一live Agent的原生快照、真正Web界面、node/星册及新名称寻址；不能以HTTP字段、直接Adapter调用或历史基础CI替代。模型只用loopback桩。未实测前保持改名禁用，C20父项不关闭。

本机有Edge可执行文件，但尚未启动浏览器或安装自动化依赖。计划使用独占profile的受控本地Web界面；不连接用户浏览器或日用Desktop。上一切片的锁定官方npm runtime暂保留为本轮测试依赖，各次Host/run数据均已正常回收。下一步先保存桥/Adapter行为RED，再实现与验证。

## 桥子资源第一段

487f0a1保存行为RED：首次12失败/2通过，补活Agent代次后13失败/2通过。产品**bd0779c**已实现GET/POST title子资源，使用当前Host的同步SessionTitle服务，不走resolveAgent；WeakMap只保留对象活代次，不写文件。输入、鉴权/Origin、Host/profile/版本、实例/创建信息/活对象变化、读取零写、原生异常后uncertain零重试共15条新用例通过。首次扩大到旧Adapter测试时，新worktree尚无dist，13条旧诊断用例因MODULE_NOT_FOUND失败；原始输出保留，不当作桥的行为RED。随后npm run build及相关ESLint通过，四文件定向119通过，见[原始定向结果](evidence/c20-dsh-rename-20261105/bridge-targeted-green.txt)。本段未运行完整check，尚有客户端/原生界面等开发待办。

GET里的executable只说明这个底层桥可以对当前活对象调用已核实的原生方法；用户操作Provider尚未登记rename，仍按待核实禁用。不能把15条模拟Host或119条定向检查当作真正DSH/Web界面通过。下一步为Adapter四态/context/revision/最终确认与错误回执、正式Web界面及node/星册/按名寻址证据；未推送/发布或启用用户操作，无活DSH测试Host或浏览器。
