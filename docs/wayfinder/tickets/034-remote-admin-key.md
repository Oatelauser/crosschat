# 星级分权管理面：星管理钥+挑战应答（原"远程管理与管理员钥匙"，四轮 grilling 重构）

label: wayfinder:design
status: open（2026-10-20 定案，二期10 派发实施会话）
blocked-by: 033（已关账）
claimed-by: 二期10

## Question

033 把管理面收敛到星心机本机插座。用户需要远程管理（在 win 上管云 broker 的日常运维：发钥/查/删节点），且拍板权限模型为**星级分权**——不是一把万能钥匙。

## 决策（用户 2026-10-20 逐条拍板，四轮留痕）

1. **三层角色**：普通成员（星钥）/ **星管理员**（星管理钥，**一星一权**）/ **broker 主**（本机插座专属——**世上不存在全能远程钥匙**，甲案；乙案 broker 管理钥被用户收敛方向否决）。
2. **星管理钥**：发放即绑定一星；**存放=node.json 该星条目可选字段 `adminKey`**（与星钥同条目，管理身份随星绑定；独立管理型条目方案被用户否）；`--gen-admin-key <label> --star <星>` 发（本机插座）、`--list` 见、`--remove-admin-key <label|前缀>` 吊（本机）。
3. **权限矩阵（终版）**：
   - 普通成员：读本星 nodes/members ✅（**新增**）；member-remove（028"星内任何机器可执"不动）
   - 星管理员：上述 + 本星 gen-key 发钥 / remove-node 删节点；**set-name 不给**（星名=broker 主本机）
   - broker 主（本机插座）：全部，含 add-star / remove-star / set-name / 发吊管理钥 / list-stars
   - **set-port 无命令**：`--port` 旗标与管理 op **全删**（033 的 set-port 插座 op 随本票回收——修订先例同 032 修订 022）；端口=broker.json 手编字段重启生效；首启非默认口=手写 broker.json（doctor 教学指路）。理由：机器级旋钮远程改=防火墙锁门风险 + 用户最少命令面原则
4. **挑战应答握手**：管理连接（adminKey）走 HMAC(钥匙, 一次性 nonce) 证明，**钥匙永不过线**；additive cap `challenge-auth` 仅管理连接启用，星钥连接维持现状。诚实边界：会话内容与新发星钥仍明文——TLS 窗口期用户知情在案（010 落地闭合）
5. **读 op 三条**：list-stars（仅 broker 主本机）/ list-nodes / list-members（本星，成员与星管理员皆可）——**回显永不含钥匙**（发钥只走 gen-key 显式动作）
6. **审计**：broker.log 逐笔记管理 op + 来源（本机插座 / 星管理钥 label）
7. **错误码**：`ADMIN_REQUIRED`（非管理员调管理 op，教学指路找管理员）；`STAR_DELETED` 收编 ERR 表（033 遗留拍板项）。协议规范 §四 同步更新
8. **破坏升级授权**（用户口令）：034 落地时 win/WSL `~/.crosschat` **清零重建**，按新协议（挑战应答）从零配——drill 即重建过程；现联邦（yang/d32b、在册会话、WSL 守护）重配、会话重新 adopt
9. **备选已评估否决**：ssh 包装路线（用户否——复杂度）/node.json 独立管理型条目（用户否，改同条目字段）/独立 admin.json 文件（用户倾向字段案后弃）/broker 管理钥乙案（用户收敛方向默认甲）/轮询·fs.watch（033 已否）

## 实施清单

- protocol.ts：connect 帧挑战应答扩展（adminKey 场景：nonce→HMAC 证明，防重放）+ 管理 op 帧族（星管理域：gen-key/remove-node/list-nodes/list-members；本机域透传 033 同套）+ ADMIN_REQUIRED/STAR_DELETED 入 ERR；broker.md §四 协议规范同步
- registry.ts：node.json 条目读写加 adminKey 字段；管理钥发/吊库函数；**--port 写路径删除**（broker.json port=手编专属）
- broker.ts：管理连接挑战应答认证 + op×角色矩阵闸（表驱动）+ 审计日志行；管理插座 op 表删 set-port
- serve.ts/cli.ts：**--port 旗标删除**（解析+help）；--gen-admin-key/--remove-admin-key/--list 钥匙清单；远程管理路由（条目 adminKey + `--via tcp:<星>`）
- doctor.ts：非默认口首启教学行（手写 broker.json 指路）
- 测试：挑战应答全链（含重放拒绝）/矩阵逐格（成员读本星✅、成员 list-stars❌、星管发钥✅改名❌、非管理员 ADMIN_REQUIRED、被吊钥 BAD_AUTH）/读回显无钥匙断言/set-port 无命令回归（help 与解析均拒）/审计行在场
- drill（验收=二期10，破坏升级授权已给）：win/WSL 清零重建 → WSL 持星管理钥远程管 win broker 星（发钥/删节点/读）全链 + 负例全过；本机插座结构操作照常

## 预算与停止条件

预算 **M**。停止条件：
1. `npm run check` 全绿（三段投递/成员语义零回归）
2. WSL→win 远程管理真机 drill 全过（清零重建即验收现场）
3. 协议规范章节与实现一致；CI 三系统绿
