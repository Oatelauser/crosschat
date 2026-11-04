# C14：OpenCode / Harness 发信工具类型与逐轮核验研究

2026-10-28。仅研究当前仓库及官方固定提交；未安装或启动原生工具、未连接用户会话/生产服务、未读取凭据、未运行测试或发送消息。本轮仅新增本文，没有修改实现或已安装技能。用户已选择所有 `send`（包括 `--conversation`）明示收件 `--tool`；用户尚未同意因缺少来源类型就一律禁用工具，要求先调查自动识别，不足时询问用户自身类型，并由程序持续核验。

## 结论

**两种工具都有可利用的原生依据，不能笼统称为“无法识别”。OpenCode 的逻辑工具类型可直接归于已约定的共享服务域；Harness 有公开、每次 shell 调用都会执行的环境贡献接口，可将现有桥实例与本次调用关联。后一条尚未接线和实测。**

| 范围 | 当前可靠依据 | 现代码状态 | 可自动判断及限制 |
| --- | --- | --- | --- |
| OpenCode CLI / Desktop 默认本机服务 | shell 原生覆盖当前 `OPENCODE_SESSION_ID`；两入口使用同类共享服务 | sender只保存Provider＋原生ID；发现行标 `shared` | 本批类型为 `opencode/shared`，不必询问用户“CLI还是Desktop”。这不等于证明某个窗口或某个服务实例的归属。 |
| OpenCode 多服务/standalone | 原生登记有实例 `id`、URL、PID、版本；HTTP健康信息可核对PID/版本 | Adapter选一份登记或显式URL，忽略原生登记的 `id`；没有本次shell→service实例标识 | 可核验选定服务的回信路由，但不能仅靠session ID证明当前shell来自它。需明确服务绑定或进一步利用公开shell hook；不能扫描到一个候选就给来源定型。 |
| Harness Web / 非Desktop Host | 每次执行原生重建 `DSH_SESSION_ID`、`DSH_PROFILE`、`DSH_PROFILE_DIR`、`DSH_HOME`；profileContext为原生启动事实 | sender只读session ID；桥能分类/核验被连接Host的profile和instance | 类型本身可据原生profile上下文分类。精确Host可通过现有桥增加公开shellEnv贡献的实例标识，避免从列表猜来源。 |
| Harness Desktop | 官方Desktop Host显式以 `profile: 'desktop'` 启动，复用同一shellEnv机制 | 有类型/隔离接线，正式Desktop shell未独立验收 | 源码支持自动识别路径；不能把Web实测或类型登记算作Desktop已通过。 |

“类型”在这里是通信域分类，不是新增鉴权条件。现有服务/桥的认证和owner核验继续用于防止连接到错误实例，不要求用户证明窗口身份或增加安全凭据。`--tool`仍只表示收件类型；来源由原生集成给出或由用户明确确认，不能混用两个方向。

## 来源与版本边界

OpenCode CLI 2.1.3 固定提交为 `bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1`，GitHub提交信息为 `release: v2.1.3`；Desktop 2.1.3固定为 `37d973754ba6cc31732f93421c0c18b675841573`，与既有正式安装证据一致。本文分别核对原生shell源码，不将两者当成同一个构建。Harness固定 `dsh-v0.2.1-rc.2` / `687f282e8625c6b8d11ff58211a90524be2e4317`。[O0][O1][O2][H0]

源码可证明接口与执行位置，不能代替正式发行物运行验收。已有Windows OpenCode CLI/Desktop及Harness npm/Web原生shell证据见[CLI验收](../development/opencode-cli-validation-20261023.md)、[Desktop验收](../development/opencode-desktop-validation-20261023.md)、[Harness验收](../development/dsh-validation-20261023.md)。本研究没有新增平台或运行通过项。

## OpenCode：已知类型与未知服务归属分开

1. **原生每次覆盖会话ID。** `ShellTool.execute` 取得 `context.sessionID`，在实际spawn前设置 `AGENT=1`、`OPENCODE=1`及 `OPENCODE_SESSION_ID=context.sessionID`。CLI与Desktop固定提交均如此。因此无需用户填写原生ID，也不能从会话名称、目录或最近历史推断当前会话。[O1][O2]
2. **共享类型来自已选择的Adapter合同，不来自“只有一个候选”。** Desktop的后台连接调用公开 `Service.ensure()`发现/复用兼容服务；它不建立“每个GUI窗口独占一个原生会话owner”的归属。因此本批OpenCode仍为shared，不能用同一session ID辨别CLI/Desktop窗口。[O3] 仓库发现适配器已在 `src/opencode/client.ts:33`统一返回 `endpointType: 'shared'`，但 `src/identity.ts`返回的sender尚未附加它。
3. **服务登记已有运行实例字段。** 官方 `Info`声明 `id`为服务实例标识，并携带URL、PID、版本；服务写登记时包含这些字段并监视登记是否被其它实例替换。官方客户端用id/version/url/pid比较登记是否同一实例，HTTP `/api/info`则核对PID/版本。不能宣称健康接口已验证这个id，因为固定源码的健康解码只返回PID/版本。[O4][O5][O6]
4. **默认shell没有原生service URL/id注入证据。** 上述原生工具写入段没有service URL/id字段。shell底层环境优先采用原生SessionEnvironment保存的每会话快照，否则用进程环境，随后调用公共 `shell.create.before` hook，最后运行原生工具的before回调。因此环境里某个继承URL、XDG路径或用户自设标记不能自动升级为本次调用所属服务的事实。[O1][O7][O8] 这是本次所核文件范围内的结论，不是对所有未来上游扩展作否定保证。
5. **存在可研究的公开补强口。** Promise/Effect shell hook公开可写 `env`，插件上下文提供 `shell.hook`注册。可以研究由运行中的原生插件闭包对每次shell附加非秘密的来源实例标识，再和所连服务关联，而不是由skill或模型写入。hook发生在原生覆盖session ID之前，hook载荷本身也不含session ID；不能直接读取继承的 `OPENCODE_SESSION_ID`冒充本次调用。实例标记与随后原生写入的真实ID须一起核验。[O7][O9]

第5条尚无本仓库实现，也没有证明插件能无配置获得当前HTTP URL或官方service id。不能把“公开env hook存在”写成“多服务来源自动绑定已完成”。若实施插件，需要依现有接入任务单独明确安装/更新/卸载合同，不能偷偷给用户新增插件依赖。

当前仓库默认依据 `XDG_STATE_HOME/.../opencode/service.json`或显式配置选服务，核对登记与HTTP PID/版本；`CROSSCHAT_OPENCODE_SESSION_ID`只是既有显式集成回退，不是上游原生变量。选定服务能返回同ID会话只说明该回信路由存在；克隆数据、两个服务共享ID时不证明当前调用来自哪一方。见 `src/opencode/service.ts:43`、`:119`、`:191`及 `src/identity.ts:119`。

## Harness：公开每次执行接口可以直接绑定桥实例

### 上游能证明什么

- 官方shellEnv明确为每次模型shell调用重新收集受管理 `DSH_*` 环境；原生保留字段包括home、shell标志、session ID、profile名与profile目录。`collect(execution)`直接取 `execution.agent.session.header.id`和当前 `ctx.profileContext`，不是读取历史列表。[H1][H2]
- bash工具在执行时调用 `ctx.shellEnv.collect(exec)`；pwsh同样调用。两者把结果传入executor，受管理环境覆盖普通继承环境。shell接口文档还明确executor丢弃继承的 `DSH_*`，防止父子/嵌套Harness的陈旧身份串入。[H3][H4][H5] 已有正式npm/Web探针确实核对过原生session/profile/home，但没有验证本文新增的实例标记方案。
- 插件可以通过公开 `ctx.shellEnv.register`声明自有 `DSH_*`字段，`resolve(execution)`针对每次执行调用并可取得当前agent。字段名称与owner冲突会失败；注册随插件作用域释放。不能覆盖原生保留字段。[H1][H2]
- `runProfile`在加载插件前提供 `profileContext`，包含name、dir、home等原生启动事实；官方Desktop Host明确调用 `runProfile({profile:'desktop', ...})`。[H6][H7] 它证明Host启动域，不证明当前用户前台打开哪个标签页。非desktop的有效profile在本批归host，不扩展新工具类型。

### 最小可行的自动识别接线方向（尚未实施）

现有bridge已在闭包中生成每次挂载唯一 `instanceId`，并在私有登记及认证 `/v1/info`中保留同一值。可由**同一桥插件**注册一个shellEnv贡献者，向本次原生调用附加该instanceId与已明确的Host工具类型；字段名称只是未来接口设计，不在本研究定稿。原生 `DSH_SESSION_ID`继续由上游提供，不由插件伪造。[H1][H2] 当前桥见 `integrations/dsh/bridge.js:46`、`:52`、`:68`；入口现在仅注入 `agents`，未接 `shellEnv`，见 `integrations/dsh/index.js:6`。

后续每次 `crosschat send`读取原生会话ID、原生profile/目录和插件贡献的instance标识，定位**指定实例**的登记，使用既有认证读取info并核对instance/PID/runtime/profile，再只读精确核验该Host中的live root ID。这样关联本次调用与具体Host，不需要“把所有Host列出，只有一个就认为是来源”。`execution.agent`还可供贡献者核对本次调用确属它借用的Agent作用域；应通过受控运行验证这一点。

同profile在不同目录、同目录的两个Host、不同Host持有同原生ID时，profile名或session ID都不足以唯一定位；实例标记解决的是这层路由身份，**不取代已有认证，也不把非秘密instanceId当认证令牌**。不得把token或模型key放进新身份字段。

现有收件端逻辑已经：相同ID＋类型出现在多个源时拒绝 `DSH_AMBIGUOUS_SESSION`；显式类型先过滤Host/Desktop，再核对owner。它保护收件定位，不证明当前shell来源。sender当前仅返回 `{p:'dsh', id}`，尚未按上述路线接线。见 `src/dsh/client.ts:46`、`:89`、`src/dsh/service.ts:104`、`src/identity.ts:129`。

注意 `profileContext.home`、shellEnv可配置的 `dshHome`、crosschat登记所在OS HOME是不同的配置来源；默认可能一致，不能不核对就当同一目录。最小绑定以原生执行上下文和instance为依据，不拿某个HOME目录替代Host身份。[H2][H6]

## 用户确认、自身类型绑定与后续逐轮核验

以下是研究建议，不是新增批准；尤其不预先决定缺口入口一律禁用。

| 情况 | 可保存的明确绑定 | 程序每轮能核验的事实 | 不应声称的保证 |
| --- | --- | --- | --- |
| OpenCode已知共享域 | 当前机器＋Provider＋原生session ID＋所选服务/登记配置＋运行实例信息 | 原生ID仍是当前调用；所选service登记、HTTP PID/版本及精确session详情仍一致 | 仅凭同ID或默认登记就证明shell来自这个服务；CLI/Desktop窗口归属 |
| Harness完成公开shellEnv接线 | 当前机器＋原生session ID＋profile目录＋bridge instance代际＋类型 | 每次原生新收集的字段，认证info与精确live root；桥热重载/退出后旧实例不可继续命中 | 当前浏览器标签页，或把历史会话存在当live root |
| 原生上下文不足、用户明确选自身类型 | 用户确认的类型＋本次可取得的session及来源作用域，记录“用户确认” | 可以重核原生ID、已有来源/实例、配置/版本是否变化；有新原生证据时对账 | 用户回答一次后，程序就独立证明了以后每次shell的真实端点类型 |

**“每轮重核绑定仍有效”和“每轮重新证明真实来源类型”是不同能力。** 如果原生调用只有裸ID，两个可投递端点拥有同ID，且没有每次调用的来源实例信息，用户选一次类型也不会凭空产生可让程序区分两个shell的新事实。保存“机器＋裸ID→类型”的全局缓存会把两个入口混在一起；只重查所选目标仍在线也不能解决。应先研究本次调用绑定；实在无法取得时，明确向用户说明可核验范围及需要再确认的边界，不能许诺完全自动重核或把用户选择伪标为原生证明。

有足够作用域时，确认只在该原生session和当前来源代际有效；每次发送重新读原生信息并对账。session切换、Host/bridge实例变更、服务登记替换、配置root/profile/版本变化都使旧绑定需要重新核验。native证据与用户选择冲突时报告冲突，不让旧确认覆盖新原生上下文。未知变已明确只补信息应保持已批准的cN/nonce/连续轮次；真正换端点按独立通信关系处理。

Harness桥disable/enable即使同一PID、相同Agent对象，也生成新instance/凭据；既有正式运行已经验证该生命周期。因此不能只按PID保存用户确认或来源类型缓存。OpenCode服务代际可利用原生登记id＋PID/URL/版本变化，但当前Adapter还没保留id；不可只靠PID长期不变就认为来源一直有效。[O4][O5] 这两种生命周期变化均不授权自动重发结果不明的写入。

## 最小受控验证步骤（本研究未执行）

| 检查 | 最小步骤与完成标准 |
| --- | --- |
| OpenCode原生调用 | 隔离正式CLI，脚本模型驱动A/B各执行只读身份输出；每次实际session ID正确，不沿用上一会话；类型保持shared。Desktop独立重复，不能用CLI成绩替代。 |
| OpenCode服务归属 | 两个隔离服务配置，包含重复原生ID/克隆历史条件；更换显式服务、登记或后台代际。程序不能仅凭裸ID或一个候选自动宣称caller归属；精确来源标记方案若实施，必须证明marker与当前服务匹配。 |
| Harness环境贡献 | 使用正式npm/Web runtime的原生bash/pwsh，贡献者在实际执行路径提供非秘密instance标记；输出的session/profile/instance与认证桥及该live root一致。禁止由工装直接手填身份变量冒充原生贡献。 |
| Harness多实例 | 不同profile、同profile不同目录、同profile同目录的两个Host，构造重复session ID；当前shell只绑定其实际Host。无法区分时报告缺口，不选首项。 |
| 热重载与重启 | bridge禁用/启用、Host重启、同ID resume、A→B切换；旧instance/确认不串用，原生每次字段跟随真实执行。相同PID热重载也失效。 |
| 用户确认回退 | 在缺失可选上下文的受控场景保存一次明确类型；保留“用户确认”来源标签。逐轮对账能发现实际可观测变化；无法辨别的变化必须留为缺口，不能测试成自动识别成功。 |
| 正式Desktop及平台 | Harness正式Desktop独立验证原生profile/贡献者/实际shell；OpenCode Desktop独立验证共享域。三平台各格仍按现有CI计划留证，此研究不替代任何平台运行。 |

验证使用既有正式工具＋本机脚本模型、隔离HOME/profile/登记，无真实模型key，不安装到生产或远端。需要新增实例标识时只传路由事实，日志不记录桥token/服务password。接线、实际安装和运行验证均属于后续实施，未在本研究启动。

## 官方固定源码

[O0]: https://github.com/anomalyco/opencode/commit/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1
[O1]: https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/core/src/tool/plugin/shell.ts#L199-L218
[O2]: https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/core/src/tool/plugin/shell.ts#L199-L218
[O3]: https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/background-service.ts#L35-L63
[O4]: https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/client/src/service.ts#L45-L57
[O5]: https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/services/service-registration.ts#L22-L63
[O6]: https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/client/src/service-probe.ts#L43-L104
[O7]: https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/core/src/shell.ts#L264-L292
[O8]: https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/core/src/session/environment.ts#L9-L29
[O9]: https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/plugin/src/promise/shell.ts#L3-L16
[H0]: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2
[H1]: https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/shell-env/README.md#L28-L67
[H2]: https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/shell-env/src/index.ts#L108-L184
[H3]: https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/tool-bash/src/index.ts#L478-L495
[H4]: https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/tool-pwsh/src/index.ts#L504-L520
[H5]: https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/shell/src/types.ts#L86-L101
[H6]: https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/src/profile-boot.ts#L313-L328
[H7]: https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop-host/src/index.ts#L14-L30
