# 运行模型（OPERATING-MODEL）

本仓工作到底怎么流：九阶段循环、四签字闸、审批三档、13 角色表、证据五步、停止条件。对齐宪法（AGENTS.md）与 rules/workflow.md 现状。图例：**M** = 机器执法（命令+exit code）；**P** = prompt 约束（无命令可判，审查时核）。

治理 CLI：`node .zcode/zbase.mjs <verb>`；退出码契约 0 通过 / 1 错误 / 2 hook 与发布门阻断 / 3 检查发现（degraded，不是 pass）/ 4 账本校验失败（stale/断链）。

## 1. 九阶段循环

从「产物缺失/过期/未证」的最早阶段进入；在未闭合的前段闸上盖后段 = 返工不是进展。

| # | 阶段 | 入口条件 | 产物 | Exit 门（M=命令） | 签字人 |
|---|---|---|---|---|---|
| 1 | Frame 定框 | 用户带着想法/需求来（超出单行编辑） | 任务信封（六字段+risk+ownedPaths） | `task start` exit 0（M）+ `doctor` 看 failing 而非退出码（M） | 主 Agent |
| 2 | Specify 需求 | 问题已述但不可判定 | Product-Spec.md（+修订成对更新 CHANGELOG） | 用户点头（P）；plan/spec 细则见 product-spec-builder | 用户——Spec 签字闸 |
| 3 | Design 设计 | Spec 已签字；M/L 档必做 | Architecture-Design.md + module-catalog.json + 嵌套 AGENTS.md + ADR + DFX-Spec.md | `catalog lint`/`arch check`/`adr check`/`agents-lint` 全 exit 0（M） | 用户——架构/DFX 签字闸 |
| 4 | Plan 计划 | 设计已签字；模块/层/禁边已声明 | DEV-PLAN.md（Phase×Task，验证列可执行） | `plan-lint` exit 0（M）+ `budget` 超限→拆分或记 ADR（M） | 主 Agent；超 budget 交用户 |
| 5 | Implement 实现 | 选中一个 Task；信封六字段齐 | diff | `impact` 圈受影响面（M）+ 写路径预检 ownedPaths 闸（M，PreToolUse） | implementer 自检 |
| 6 | Verify 验证 | 树可跑、Scope 未越 | 回执落账本（四态） | `gate` PASS exit 0（M）；空计划=BLOCKED 不是绿灯（M） | 引擎；主 Agent 读回执 |
| 7 | Review 审查 | 有绑定当前指纹的 PASS 回执 | 审查结论（三 Stage / 引擎协议 verdict） | `receipt verify` exit 0（M）+ verdict ACCEPT；stale=exit 4（M） | code-reviewer / red-blue——永非作者 |
| 8 | Record 记录 | 审查 ACCEPT | progress.md 条目 / ADR / 三文件同步 | `sync-check` exit 0（M，pre-commit+Stop 双缝）+ `manifest generate`（M，家底变了） | 主 Agent |
| 9 | Release 发布 | DoD 收口 | tag / 产物包 | `dod` exit 0 + `release` READY exit 0（M）+ make-release 泄漏自验（M） | 用户——发布闸（HIGH 档） |

读退出码的三条纪律：`doctor` 是报告不是闸（看 failing 清单）；`arch baseline` 记录测量永远 exit 0，裁定在 `arch trend`；exit 3（degraded）永远不是 pass——引擎拒猜（无 catalog/无需求文档/引擎异常），如实报「未验证+缺什么」。

## 2. 四签字闸（批的是「当前这版内容」，不是想法）

| 闸 | 关闭阶段 | 机器前置（M） | 人签字（P） | 重批触发 |
|---|---|---|---|---|
| Spec 签字闸 | 阶段 2 | Spec 可判定（spec 细则由 product-spec-builder 把关） | 用户批准该版 Spec | Product-Spec.md 任何编辑——CHANGELOG 同回合成对更新 |
| 架构/DFX 签字闸 | 阶段 3 | catalog lint / arch check / adr check / agents-lint 全 0 | 用户批准模块图+档位（S 档可并入 Spec 闸） | modules/layers/禁边/riskTier/attributes 变更或新 ADR |
| Phase 完成闸 | 阶段 5-7（每 Task） | `gate` PASS + `receipt verify` 0；回执绑定指纹，树一动即 stale exit 4（M） | 审查 ACCEPT（绑定机器执法，判断是人做的） | 被 track 的 diff 动一个字节 |
| 发布闸 | 阶段 9 | `dod` 0 + `release` READY 0（永不 tag/push/deploy——那是 HIGH 档人类行为） | 用户显式批准 | 批准点之后的任何 commit |

Spec/设计闸无哈希绑定（P），以 progress.md Decisions 记录批准对应 commit 做审计；Phase 闸是机器真相（指纹绑定）。

## 3. 证据五步（任何事实性结论前，铁律）

1. 想清证明命令：说不出命令的主张是观点，明说。
2. 本会话新鲜跑：改前跑的结果是陈的。
3. 读完整输出**和** exit code——只看其一不够。
4. 确认输出支持**这个**结论：跑 0 个检查的 exit 0 什么都没证明；没碰受影响模块的套件证明不了它。
5. 才下结论，引用命令+exit code。

禁用词：「应该没问题」「大概好了」「看起来通过了」。替代句：「未验证：<缺什么>」。

## 4. 审批三档

| 档 | 行为 | 范围 |
|---|---|---|
| LOW 不问直接跑 | 写文档/progress/feedback、加测试、P2/P3 顺手修复、只读探索、本地构建与测试 | — |
| MEDIUM 一句话预告后继续 | 新增/修改框架非家底文件、派长耗时子代理、超 5 文件的批量重构、依赖安装 | 不停等 |
| HIGH 必停等明确批准 | 删除/停用/重写任何现有 hook/skill/宪法规则（存量资产铁律）、git push/发版/部署、不可逆或远端写操作、密钥/隐私相关、Spec 签字门 | — |

模糊落高一档；用户当前指令可显式豁免单次（安全护栏除外）。Fast Mode 是用户显式开启的临时放水（`fast on --minutes 1..480 --reason 必填`）：跳过的自动卡点留 SKIPPED 痕、DEBT 阻断 task finish/release、已执行的 FAIL 永不可豁免、security/safety/privacy 三性永不可跳。

## 5. 角色表（13）

角色=skill+派单契约（`.zcode/docs/ROLE-CONTRACTS.md`）；主 Agent 用 Agent 工具派 fresh 实例，子代理不再派子代理（depth=1）。

| # | 角色 | 可做 | 不可做 |
|---|---|---|---|
| 1 | 主 Agent（唯一编排者） | 定阶段、写信封、派单、验收/拒绝、跑只读命令、亲写四类文档（Spec/CHANGELOG/DEV-PLAN/progress） | 亲自动手编码/审查/测试/部署；验收未核证据的自报 DONE；未授权 HIGH 档 |
| 2 | implementer 实现者 | Scope 内最小一致实现；执行受影响验证交证据 | 批准自己的实现；越 Scope；自报 DONE 不带命令+exit code |
| 3 | code-reviewer 审查者 | 三 Stage（静态→Spec 合规→质量）；findings 分级附 file:line | 顺手改码；与实现者同源；跳 Stage |
| 4 | tester 测试者 | 面向公共契约写测；red-locks 先红后绿；交真实运行器输出 | 与被测作者同实例；只报「通过」不附输出 |
| 5 | deployer 部署者 | 构建/部署；独立核验三件套（产物时间戳+tag/健康端点/live 冒烟） | 自决上线时机（HIGH 留用户）；拿 uptime 冒充活性 |
| 6 | researcher 研究员 | 外部库/API/版本调研；结论附来源链接+版本号 | 把「社区说的」当「官方说的」；fan-out 冒充下钻深度 |
| 7 | impact-analyst 影响分析师 | 跑 impact/context pack 并解读；degraded 判定与保守扩张建议 | 吞 degraded 标记；猜验证范围 |
| 8 | feedback-observer 反馈观察员 | hook 信号提醒后落 feedback 条目（现象/根因/规则/occurrence） | 依赖主 Agent「记得」才记 |
| 9 | evolution-runner 进化执行员 | INDEX 盘点→毕业评估（含聚类毕业）→规则减脂→修订提案 | 擅自改宪法/rules（HIGH 审批）；推倒重写 |
| 10 | progress-recorder 记忆记录员 | 工作单元收尾即时同步 progress.md（Decisions 记被拒方案） | 攒批补记；Done 不附证据指针 |
| 11 | red-blue 审查者（Blue/Red/Judge） | Blue 自证（claim 必附证据）→Red 攻击（finding 附 file:line/复现）→Judge 由已记录事实裁定 | 无证据主张立案；超过 2 轮不收敛 |
| 12 | 用户（签字人） | 四签字闸拍板；HIGH 档授权；Fast Mode 开关 | —（被批的是当前版本，内容变了要重批） |
| 13 | 引擎（zbase.mjs，机器执法者） | gate 四态、quality verify 反证、review stale、Stop 门、写路径预检、账本哈希链——只认命令+exit code | 无：引擎不判「可以接受」，只判「证据齐不齐」 |

为什么主 Agent 派证据收集、留判断：证据经得起转移（命令/exit code/evidencePath 可复跑复核，指纹绑定让陈旧可检出）；判断经不起转移（子代理上下文是严格子集，风险系统性欠估）。所以：派审计/盘点/机械迁移/Scoped 实现；留验收/风险分级/架构决策/一切 HIGH 档。

## 6. 停止条件（停，找人）

1. `zbase` 命令 exit 2/3/4 且修复超出声明 Scope。
2. 审批档是 HIGH，或在 MEDIUM/HIGH 之间模糊。
3. 任务信封缺字段、Scope 没有具体路径——回 NEEDS_CONTEXT，不猜。
4. 门只能靠放宽 budget/改检查定义/收窄运行/豁免三性变绿。
5. Spec 与代码不一致：问哪个错了，别静默改任何一个。
6. 同因连续两轮验证失败（引擎 FAIL-streak≥3 会点名）：报阻塞，别试第三次变体；bug 修复尝试≥3 次未转绿=熔断回根因。
7. 两个独立子代理对同一主张交回矛盾证据。
8. `risk scan` 报账本断链/豁免过期：既有证据不可信，别在上面继续盖。
9. 不可逆或争议决策（schema/依赖/公共契约/数据删除）。
10. 子代理走完升级路径（补上下文→提模型→拆任务→报限制）仍 BLOCKED。
