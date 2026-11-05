# DSH原生操作：C15核实与C24入星能力接线

2026-11-05。按用户“接着往下开发”持续推进，root独立，不派worker。开发工作区D:/workspace/CC/cc-dsh-capabilities-20261105，branch codex/dsh-capabilities-20261105，基线为PR #4合入后的main d26aa2b9857067aeeda67aa73b83f493840905fd。权威任务总表仍在原工作区；25父项/11CI索引、公共通信及其它工具负责人保持。本轮只做本地开发，不复用上一单的推送/合入/外部Actions授权。

## 核实范围与当前结论

DSH npm/Web的既定四目标基础及配套CI已验收，允许该入口继续增强，不等待Desktop或其它工具父项整体关闭。正式Desktop的publisher默认策略、独立干净环境及官方安装/卸载仍保留；用户D:/soft/DeepSeek Harness不启动、修改或卸载。无模型key、真实消息投递或新增crosschat运行数据文件。

C15读取官方rc.2/rc.5的agent、api-session-controller、session-title、session-projection共八个模块，tarball SHA512逐一与此前四目标从零验收的包锁一致；仅读取源码，未安装/执行这些模块。npm元数据没有gitHead，因此不把旧687f282e源码与发行物视为同一构建。模块原件与检查索引暂存在本轮独占node_modules/.cache/c15-dsh-20261105，归档时保留版本/SRI/成员摘要和一手链接。

| 能力 | 已核实事实与边界 |
| --- | --- |
| 完整原生ID/存活 | 官方Agent.get按完整ID读live Agent，roots只列无运行时owner的top-level Agent；本桥又核对agent/session header身份。roots不是窗口选择。 |
| 选择/首条输入/退出 | 当前桥未暴露可靠前端选择信号，Agent生命周期或模型选择事件不能当作窗口选择。npm/Web沿既定TUI明确选择，不新增wrapper，不从active、目录或root差分推断。自动跟随不计通过。 |
| 原生名称读取 | 本桥沿现有sessionProjections读取title，来源与完整目标由已鉴权的桥握手/精确详情取得。 |
| 原生改名 | 两个已验版本均有公开SessionTitleService.rename，检查同一live session后追加原生title事件；活UI、node/星内名称及路由同步尚未实测。C20继续保留，不能只凭函数存在开启修改。 |
| 手动入星 | 已有基础Provider，但只依靠发现结果的delivery及idle/running不足以覆盖端点/owner/版本变化。本轮C24补只读原生核验及最终确认；删册仍走独立精确管理通道。 |

一手来源：[rc.2官方元数据](https://registry.npmjs.org/@deepseek-ai/dsh/0.2.1-rc.2)、[rc.5官方元数据](https://registry.npmjs.org/@deepseek-ai/dsh/0.2.1-rc.5)、[session-title rc.2](https://registry.npmjs.org/@deepseek-ai/dsh-session-title/0.2.1-rc.2)、[session-title rc.5](https://registry.npmjs.org/@deepseek-ai/dsh-session-title/0.2.1-rc.5)、[agent rc.2](https://registry.npmjs.org/@deepseek-ai/dsh-agent/0.2.1-rc.2)、[agent rc.5](https://registry.npmjs.org/@deepseek-ai/dsh-agent/0.2.1-rc.5)。旧源码只作对照：[固定SessionTitle实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-title/src/index.ts)。不读取历史被拒的五份Desktop资源。

## 最小接线合同

复用既有SessionOperationDescription.actions、revision及applied/rejected/uncertain，不改CLI命令、JSON字段/用户步骤或新增持久文件。NativeOperationProvider增加可选的入星只读探测，现有Claude/Codex/OpenCode路径保持。DSH Adapter沿现有注册/鉴权/版本和完整ID校验，私下绑定实际URL、实例、pid、profile/类型、版本与登记代次，返回不可逆上下文摘要；token与私有位置不进入描述。

每次describe/apply重新核实；apply写入前再核对同一上下文。原生核验失败或目标消失属于rejected，不能冒称已发送修改；实际claim写入后回执不明保留uncertain，刷新不自动重发。缺少类型/实例证据为needs-verification，当前不支持的协议/版本为unsupported，失联/认证/owner冲突为unavailable，正常核实为executable。所有探测有界可取消，恢复只恢复动作，改名未验不影响已核实入星。

## 当前开发阶段

新增test/dsh-native-operations.test.ts，隔离HTTP桥覆盖精确目标、四态恢复、同ID跨类型/重复实例、实际URL替换、版本变化、执行前消失、取消及uncertain零重发。第一次11失败来自fixture凭据不符合既有64位hex合同，原始输出保留，修正fixture并保持产品校验。正式行为RED为10失败/1通过，现有实现未发出独立原生探测、旧确认未被端点/版本变化撤销。待实现GREEN并完成相应检查，不把隔离桥当作真实DSH增强验收。
