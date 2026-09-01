# 能力矩阵（CAPABILITY-MATRIX）

四仓吸收台账：dsh-base（基线全量 22 项机制）+ codex-base / cc-base / cursor-base 三族增量。判定三值：**Absorbed** 语义原样吸收；**Adapted** 意图保留、按本仓机制重表达（或落地中/已排期，落点列注明批次）；**Rejected** 明确不做，理由在列、不暗示等价物。

依据：`.zcode/state/research/` 四份研究报告（2026-09-01，沉淀副本见 `.zcode/docs/research/`）+ progress.md 2026-09-01 三条裁决（dsh 深研吸收 / v2.0 大重构 / cursor、codex-cc 增量裁决）。批次号指 DEV-PLAN v2.0 Phase（R1-R6）；「落地中」= 本批或并行批在途。

## 一、dsh-base 22 项

| # | 能力 | 判定 | 实现与落点 | 理由 |
|---|---|---|---|---|
| 1 | recap/invariants 预算化恢复 | Absorbed | R3b：6000/1200 预算派生摘要；SessionStart 注入 + 脏树校准提醒 + 待毕业 feedback 播报 | compaction 不修正漂移；恒定成本恢复 |
| 2 | sync-check + 3 git hooks | Absorbed | R3b：三文件同步判定挂 Stop 门（pre-commit/Stop 双缝共用）+ recorder 豁免窗口 | 「三文件铁律」的机器执法缝 |
| 3 | review 全链（session/blue/lens/verdict/backlog） | Absorbed+扩展 | R4c：引擎化全链 + stage 门 + lineage + CoVe verificationQuestion + scope 匹配 | verdict 由已记录事实计算；zcode 加 CoVe 与 ownedPaths 比对 |
| 4 | budget 爆炸半径四指标 | Absorbed | R3b：lib/budget.mjs；超限 exit 1「拆分或记 ADR」 | 信号不是禁令 |
| 5 | rules-audit + scan-instructions | Absorbed+修复 | R4a：rules-audit 三态动态 known 集；scan-instructions 八规则并修 dsh 潜伏缺陷（前导旗标 `\b` 永无边界全漏检） | 宪法规则须有真实执法点；指令文件是活跃攻击面 |
| 6 | skills-lint | Adapted | R4a：并入 cc 触发式描述③④；阈值按本仓规范（220 warn/500 err） | dsh 阈值是 DSH 宿主数字 |
| 7 | fast 四条件 | Adapted | R3a：dsh 四条件 + codex windowId + 铁律「已执行 FAIL 永不可 fast 豁免」两案叠乘 + F1 债务跨指纹存续 | 超越 dsh/cursor 任何一家单独方案 |
| 8 | spec-lint（EARS）+ trace | Adapted | R5 批次（Task 9.2）落地中：Spec id 制 + 性能预算数字化 + Expected 字段 | 引入需换需求文档范式，随 R5 批次走 |
| 9 | release + dod | Absorbed | R4d：九条件（7 阻断+2 非阻断）+ dod 12 步 + never-tag 文案内置 | 引擎装配证据，tag/push/deploy 永远是 HIGH 档人类行为 |
| 10 | archive --apply | Adapted | R3b：append-only + 幂等 + ledgerHealth 阈值提示；本仓 progress 为 append 式（最新在尾），顺序契约与 dsh prepend 相反 | 归档为 recap 恒定成本，不为删历史 |
| 11 | cochange 共变度量 | Rejected（暂缓） | 未排期；需要时按研究报告 dsh§11 平移（124 行） | 模块边界已由 arch 禁边+impact 执法；共变是补充度量非刚需 |
| 12 | 嵌套 AGENTS.md + agents-lint | Absorbed | R3b：riskTier + 四段契约 + 本仓 critical/high 模块落地 | 目录级宪法是最便宜的边界契约 |
| 13 | protected attributes（含 privacy） | Absorbed | R3a：PROTECTED 三性 + 豁免/fast/backlog 三消费点拒绝 | 「结构上无可表达之例外」 |
| 14 | install 一条龙 | Adapted | R4d 大合流：dsh 旁路/LF 归一/verify 先 stage + codex 事务回滚 + cursor 三方合并 + 本仓独有用户级 hooks 注册（ADR-0006） | 三仓精华一次合流 |
| 15 | exit code 0/1/2/3/4 | Absorbed | 宪法声明 + 引擎落地；exit 2 扩「hook 阻断与发布门阻断」 | degraded 永不假装绿 |
| 16 | tests 组织（launcher+helpers+机制分组） | Adapted | R4e：readdir 展开 launcher + tmpdir helpers + 三类新测试（并发/性能/对抗） | Node 20 glob 兼容；对抗测试锁出存量缺陷 |
| 17 | CI gate.yml | Absorbed | 本批 9.5：矩阵 ubuntu×windows × node 22/24；selftest 先行；install 冒烟注册临时 HOME；doctor always | CI 是第二执法缝 |
| 18 | 八属性六档 + attributeReasons | Adapted | R5 批次（Task 9.1）落地中（R5a 并行批）：+adapters 表证据供给侧 | 八属性对齐 ISO 25010；降档必须是记录在案的决策 |
| 19 | docs 四件套 | Adapted | 本批 9.6：OPERATING-MODEL/CAPABILITY-MATRIX/ADOPTION/ADR-CONTRACT，对齐本仓宪法/命令面中文重写 | 文档随机制走，不照抄宿主表述 |
| 20 | 研究简报结论（审查循环量化等） | Absorbed | 审查循环收益进 review 设计注释；「未执法规则有害」→rules-audit；AGENTS.md 长文件零收益→嵌套契约；compaction 失效→recap/invariants | 被严格度量过的杠杆才配进设计注释 |
| 21 | dsb 单入口 + lib 七模块界 | Absorbed | R4e：lib 19→七模块界 + 26 个 re-export shim；forbidden 禁边单向链执法 | 依赖方向是架构事实不是愿望 |
| 22 | 工程配套（LICENSE/CHANGELOG/.editorconfig/.gitattributes/package 元数据） | Absorbed | 本批 9.5 | 与 install LF 归一配套 |

## 二、三族增量（按主题合并去重）

| 主题 | 能力 | 源 | 判定 | 实现与落点 |
|---|---|---|---|---|
| 状态与并发卫生 | 跨进程状态锁（wx+pid 存活+ownerToken） | codex1.13/cursor#1 | Absorbed | R3a：3×25 双进程并发零丢失 + 并发回归测试 |
| | 损坏隔离 quarantine（.corrupt-<ts>+事件账本） | codex1.14/cursor#11 | Absorbed | R3a + F2（仅 SyntaxError 隔离） |
| | untracked 内容字节入指纹 + symlink 不跟随 + 256MB 截断响亮失败 | codex1.18/cursor#15 | Absorbed | R3a + F4（预算+memoize）；WIP 期恰最需证据绑定 |
| | 账本轮转 + anchor 携带 | cursor#9 | Absorbed | R4b：保留尾链端到端可验证 |
| | 全局输出脱敏 redactSecrets | codex1.3/cursor#2 | Absorbed | R3a：16 模式，receipt note/logGate/hook 三出口 |
| | hook/CLI 输出预算 | codex1.19 | Absorbed | R3a：超限拒断不静默截断 |
| 写路径与安全 | 写路径预检 + ownedPaths 闸 + knownHashes 并发冲突 | codex1.4/cursor#3 | Absorbed | R3b：工具+shell 双路提取/symlink 逃逸/三态冲突 |
| | 护栏资产软执法（播报+留痕两档） | codex1.5 | Absorbed | R3a：引擎文件写=播报+gate-log |
| | Stop 三振按状态分键 + 清单指纹 | codex1.7/ccA8 | Absorbed | R3a/R3b：分键多槽 LRU |
| | shell 语义分类器 v2（tokenizer+wrapper 剥壳+嵌套递归+管道秘密外传+融合参数+三档决策+match/notMatch 自测向量） | codex1.1/1.2+cursor#12 | Adapted | R6 旗舰（Task 10.1）四仓融合排期；现有正则表是已知绕过面 |
| | no-direct-code-guard（主 Agent 不写业务码） | ccA1 | Adapted | R6（Task 10.3）台账模式先行；OQ-4（用户级 hooks 是否触发子代理调用）决定最终形态 |
| | SubagentStop 回执校验/验收提醒 | codex1.6/ccA6 | Rejected | ZCode 无 Subagent 事件（已查证）；主 Agent 验收时校验信封承担 |
| 证据与计划 | verification plan（组队+保守扩散+依赖 DAG+资源锁+planHash+空计划阻断） | codex1.8/1.9 | Absorbed | R4b：「该跑什么」=impact 的确定性函数 |
| | evidence 三重完整性（文件+bytes/hash+逐字节复验+路径安全） | codex1.10/cursor#9/#10 | Absorbed | R4b：篡改三态可检出 |
| | retention 引用保护 | cursor#10 | Absorbed | R4b：被引用证据永不删 |
| | runtime 检查时间窗 runtimeValidityHours | cursor#5 | Adapted | R5（Task 9.3）落地中 |
| | completion 完成门聚合（optional FAIL 阻断+review scope 匹配） | codex1.11 | Absorbed | R4c |
| | executor 角色绑定（high 须 tester 回执） | codex1.12 | Absorbed | R4c：一行校验执法宪法纪律 4 |
| 审查 | CoVe 逐条对抗验证（verificationQuestion+独立核验） | ccJ | Absorbed | R4c：findings 可选字段，Judge 前核验 |
| | live 路由行为测试（断言库/fixture/selftest 层 + 环境探针） | ccH | Adapted | R6（Task 10.3）断言库先行；live 层待 OQ-5（headless CLI+事件流） |
| | 按栈编译门（pre-commit 只编译 staged 涉及栈） | ccA7 | Absorbed | R3b：pre-commit；工具缺失降级不卡死 |
| | static-check 识栈工具（code-review Stage 0 可执行化） | ccI | Adapted | 按栈编译段已进 pre-commit；Stage 0 全工具化未排期（现 prompt 条目） |
| 发布与安装 | install 事务性（staging 备份/逆序回滚/post-verify/install-receipt） | codex1.23/cursor#14 | Absorbed | R4d |
| | 三方合并 upgrade/uninstall + safeManagedPath | cursor#14 | Absorbed | R4d |
| | make-release（私人内容剥离+打包后泄漏自验） | ccD | Absorbed | R4d：发版链第四验 |
| | 归档阈值自动触发 | ccM3 | Adapted | R3b：ledgerHealth 阈值提示（M3 Done>100）；自动触发为提示非强制 |
| 检查面 | fitness 五反模式+行内抑制 | codex1.21 | Absorbed | R4a：与接线审计并存 |
| | managedDrift + bootstrap 出厂态警告 | codex1.22 | Absorbed | R4a |
| | FAIL-streak 根因重定向 | cursor#7/codex1.11 | Absorbed | R4a：同 check 连续 FAIL≥3 报 high |
| | plan-lint / test-routing / skills-lint 触发式③④ | ccE/G/F | Absorbed | R4a |
| | adapters 外部工具接线表（11 工具+adapters add） | ccB/cursor#4 | Adapted | R5（Task 9.1）落地中（R5a 并行批） |
| | context-pack 定点收敛+分级裁剪+摘要/证据分离 | codex1.20 | Adapted | R5（Task 9.3）denied→diff 省略+摘要分离先行；收敛算法后补 |
| | spec 自举三细节（性能预算数字化/Expected 字段/复制面维护面分离+pack-check） | codex§2 | Adapted | R5（Task 9.2）落地中 |
| 反馈与进化 | feedback 引擎化（lint+毕业候选+risk 播报） | cursor#8 | Absorbed | R4a |
| | 聚类毕业（同失败模式跨条目合计≥3） | ccM1 | Absorbed | 本批 9.4：evolution-engine |
| | EVOLUTION 第④层（Skill 自动生成提案）+UX 三档 | codex5.4 | Absorbed | 本批 9.4：evolution-engine 四层+UX 三档 |
| | 修复熔断闸（≥3 次未转绿强制回根因） | ccM2 | Absorbed | 本批 9.4：bug-fixer（与 FAIL-streak 呼应） |
| Skill 面 | design-brief-builder（视觉方向采访） | codex5.1/ccK1 | Absorbed | 本批 9.4 |
| | design-maker（odc 生成设计稿） | codex5.2/ccK2 | Rejected | odc daemon 环境专属；「一份产物两用/状态完备」纪律一句话并入 design-brief |
| | 吸收台账周期化 CROSS-POLLINATION | codex§3 | Absorbed | 本批 9.6 |
| | 测试三技术（并发/性能预算/对抗性） | codex§3 | Absorbed | R4e |
| 立场级 | 拒全局 fast mode（模式旗标活过它的借口） | cursor3.1 | Adapted | 两案叠乘：保留贷款四条件 +「已执行 FAIL 永不可豁免」（裁决超越两家单独方案） |
| | 「检查优先于常驻文本」 | cursor3.2 | Absorbed | 宪法体量标尺 |
| | progress 模板 Not doing 段 | cursor3.2 | Absorbed | 被拒提案显式留痕防重讼 |
| | 教训库不随 install 旅行 | cursor3.4/cc | Absorbed | 安装面不含 feedback 私条目（make-release 同原则） |

## 三、明确不做清单

| 项 | 理由 |
|---|---|
| service/dev-service 监督器 | 三仓共识拒绝（dsh 拒在先，codex/cc 环境各异）；本仓是治理脚手架非运行时；已摘 probeHealth 语义与「重启风暴=非瞬时故障」熔断教训 |
| auto-push | 与「push 是 HIGH 档人类行为」哲学正面冲突 |
| SubagentStop 机械拦截/注入 | ZCode 无该事件（已查证）；语义由回执信封+主 Agent 验收承担 |
| sh/ps1 双写+parity 测试 | Node 单实现架构性免疫（cc 全部 PS 5.1 坑本仓不成立） |
| path lease 路径租约 | 单 writer（主 Agent 唯一编排）默认下用处有限——裁决「缓」 |
| fleet 多仓合同层 | OQ-3 暂缓 |
| 编译产物入仓+runtime-sync 字节校验 | 零依赖纯 mjs，无编译产物可验 |
| tdd-gate marker 文件链（.red-verified/.tdd-exempt） | red-locks 是宪法铁律+bug-fixer 流程；另建状态文件违反双真相源拒斥 |
| mark-review-needed 按文件登记 | 功能被 changedPaths+fingerprint+receipts Stop 门覆盖，平行清单=双真相源 |
| 宿主专属面（.cursorrules/.cursor hooks 六事件/sandbox.json/cli.json permissions/codex safety.rules DSL/PS ASCII 强制） | 宿主能力不存在即拒；可借鉴内核已拆出（如三档决策、沙箱 deny-list 起点） |
| grok/pi/kimi/opencode 二手吸收 | 四仓研究报告已提炼族内精华，二手引用无增量 |

## 未来提案四规则

1. **必须命名执法机制**：一个 zbase verb+exit code、fitness 规则 id、ZCode hook、git hook 或 CI 步骤。「靠 Agent 记得」= prompt-only，必须照实标注。
2. **必须命名能拦住的事故**：gate-audit 终会问这道闸拦截过什么——答不出的闸不该存在。
3. **优先扩现有检查，不加新文件类型**：每个新产物类型都要配自己的 lint、过期规则和审查面。
4. **依赖宿主不存在的能力（事件/设置文件/常驻进程）即拒**：ZCode 事件面=注册的 7 事件，超出即本表记录理由。
