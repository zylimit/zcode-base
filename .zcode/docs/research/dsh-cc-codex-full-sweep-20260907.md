# dsh / cc / codex 三仓全量精读裁决 + 业界实践对照（2026-09-07）

方法：三个并行精读代理逐行读全 dsh-base（137 文件）/cc-base（258 文件本体）/codex-base（本体 35 runtime+23 schema+docs 全量，排除 harness-state 运行态）；主 Agent 对 zcode-base 39 个 lib 模块逐项实测去伪（精读代理以宪法文本对照，误报已剔除：arch 实测边+棘轮、waiver 禁词、死闸审计、review authorship、range receipt 等已在位）；联网调研 2025-2026 业界实践（agents.md 标准/Anthropic 上下文工程/ICML 对抗评审/mutation testing/Endor Labs hook 治理面）。

## 一、三仓定位与最强资产

| 仓 | 流派 | 独有最强资产 |
|---|---|---|
| dsh-base | 零依赖引擎+模板内嵌规则（宿主无 hook 面，执法住 git/CI） | arch-trend 逐边债务棘轮；waiver 不可表达性；golden 变异击杀；templates 规则随工件旅行；fleet 仓间契约层；supervisor 进程守护 |
| cc-base | Claude Code 原生运行时行为面 | tier 三档盘+治理面自动升档；agent-memory 角色记忆库；压缩双端守门；authorship 机器强制；hook 战绩账本+死闸审计；golden 双向对拍+probe 掩码推导 |
| codex-base | 证据状态机（schema 闭集+fencing+CAS） | assurance-policy 16 轴单调策略；rapid loan 债权模型（7 哈希绑定+账本推导债务）；guard fault fencing（护栏自身的证据治理）；shell-grammar 双文法全量；模型输出投影契约 |

三家在 **engineIdentityHash（回执绑定引擎指纹）** 上独立收敛（dsh engineIdentityHash / cc engineHash / codex runtimeHash）——三仓同证的结构信号，zcode-base 缺失。

## 二、已核实为「zcode 已有、非 delta」的项（防重议）

arch 实测边+逐边棘轮（graph.mjs extractImports/check/baselineWrite/trend 集合比较）、waiver 五要素+受保护禁词（quality.mjs WAIVER_FORBIDDEN_WORDS 含中文禁词）、死闸审计+effectiveness 三态计数（quality.mjs:1819+，R6b）、review authorship 三态（批次6）、range receipt 双形态+release receipt-fresh（批次7）、四态 BLOCKED 语义（可执行缺失=BLOCKED 永不 PASS）、golden --strict 双向对拍（批次6）、cochange 三分类+批量提交可见、catalog init 三不猜、fingerprint untracked 内容哈希、写路径预检 ownedPaths+knownHashes、跨进程状态锁、budget/archive、invariants State 块。

## 三、真缺口清单（已逐项实测确认）

### A 级（旗舰，正面回答「分档位/可调强度」）

**A1. tier 档位盘**：zcode 只有 Fast Mode 双态贷款；无 per-gate 三模式表、无 strict/standard/fast 具名档、无治理面触碰自动升档。cc 的 `hooks/lib/tier.mjs`（唯一解析器/三档单调/结构性地板/raise.paths 自动升档点名文件/提交后回落/tier validate+explain）与 codex 的 assurance floor 语义（extends 单调继承/只许加严）是两代答案。设计草案见第五节。

**A2. engineIdentityHash**：回执不绑引擎身份——升级脚手架后旧回执仍算证据。三仓独立同证 + codex 把 runtimeTreeHash/worktreeHash 都纳入 planHash。改法：receipt content 增 engine 键（zbase.mjs+lib 全量 LF 哈希），receiptBinding 校验不匹配→stale；老回执无键放行（防升级砖化存量，cc 同款）。

### B 级（便宜高值，单批可落多项）

- **B1. scan-instructions 豁免锚定**：现 suppress 是裸正则（scan.mjs:410 `SUPPRESS = /scan-instructions:ignore/`），无哈希无过期——被豁免行或邻行被编辑后豁免仍活着（可静默放宽）。改法：豁免可附 `sha256:<本行±1 邻行窗口哈希>`（dsh 形态），编辑即 suppression-stale error；`--hash` 子命令算窗口哈希。
- **B2. review-pack 删除审计**：无 removed-files/removed-lines 段。改法：删除清单+预算化 removed-lines 段（dsh：绿 build 藏回归最便宜的路径是删守卫）。
- **B3. golden 变异击杀（opt-in）**：golden record/check 只证「输出没漂」不证「尺子量东西」。dsh 13 突变全击杀 vs cc 删掉整套（feedback：元测试不进发版链）。综合裁决：加 `golden mutate`（6-10 个安全承重突变：忽略 FAIL/waiver 绕过受保护/EMPTY_HASH 换常量/secret 豁免放宽/classifier deny 降 ask/挡板越界），**不进 run-all 与 CI 发版链**，手动跑。吸收两家教训。
- **B4. agent-memory 角色记忆**：`.zcode/agent-memory/<role>/MEMORY.md`（code-reviewer/tester 起）+ ROLE-CONTRACTS 消费条款（开审前先读记忆列重点；收尾写回「记模式不记流水账，单条一行」）+ rules 一句边界（不承载宪法规则/项目事实）。零代码，纯约定+契约；cc 实证其 reviewer 记忆 15 条攻法是审查质量复利（业界对照：干净上下文+积累攻法=审查有效性两要素）。
- **B5. 中期铁律重注入（goal recitation）**：UserPromptSubmit hook 已注册（现仅反馈信号检测）。加：活跃 task 存在且 diff 指纹自上次注入后有变 → 注入一行 invariants 提醒（预算：单行、状态变化才发）。依据：Galileo/arXiv 2510.07777 长任务目标漂移实测；cc 压缩双端守门在 ZCode 无 PreCompact/PostCompact 事件下的会话内替代（事件面已确认 7 事件无压缩对）。
- **B6. classifier 出站模式增量**：secretExposure/sensitivePath 已有管道级检测；增量核对 Endor Labs 高杠杆清单——代理自身配置写入金丝雀（写 `~/.zcode/cli/config.json`/hooks 注册面 → ask 点名）、`~/.aws/credentials` 类绝对秘密路径读取、令牌前缀形态出站。已有面核缺补缺，非新子系统。
- **B7. 模板/技能双改进**（docs 面）：①skill 触发描述对齐引擎信号词表（dsh：description=Use when+引擎退出码/失败信号，模型看到特定错误即知加载哪个技能——触发面与引擎输出同词汇）；②模板内嵌作者规则（HTML 注释写「会被哪个门解析/什么写法会挂」+模板必须能过自己的门，规则随工件旅行）。

### C 级（watching，暂不做）

- codex guard fault fencing（epoch/lineage/intent 目录 ~1500 行）：理念一流（护栏崩溃原子化淘汰旧证据），但 zcode gate-log+死闸审计+effectiveness 已覆盖其 80% 价值面；复杂度不成比例。watch：若未来 hook 崩溃导致假绿实测发生再引入。
- codex 23 JSON schema 闭集+双份维护：manifest+tests 已够，schema 双份是负债。
- codex shell-grammar POSIX+PowerShell 双文法（~1700 行）：zcode 分类器 426 行已覆盖宿主真实面（Linux bash）+19 规则 146 向量；PS 文法对 ZCode 宿主优先级低。仅吸收「解析不动即 fail-closed」原则（已在）。
- codex assurance 16 轴/policyHash 全链失效/target-execution 双输出/7 哈希贷款绑定：为无交互面的自治 exec 宿主设计；ZCode 交互会话人机在场，三档+例外表+贷款句柄是更诚实的复杂度预算。只取 floor+extends 单调+validate 三件（并入 A1）。
- codex leases/services、dsh supervisor：治理脚手架≠进程管理器/工作区协调器，拒绝。
- dsh fleet 仓间契约层：真实缺口（复杂度守恒→仓间契约面无人看）但 zcode-base 单仓定位；列远期二期。
- cc statusline/notify/auto-push/kill-dev-ports/OSC 777：宿主能力依赖（ZCode 无对应面），不接。
- cc stop-gate 三振熔断：zcode Stop 门语义不同且无死锁实测证据；watch。
- cc PreCompact/PostCompact：宿主无事件（OQ 记录，宿主支持后接线；invariants State 块+ B5 是在场替代）。

## 四、业界实践对照（2025-2026）

zcode 核心架构选择全部获外部佐证：AGENTS.md 事实标准（60k 项目/LF 托管）；职责三分（强制→hooks/知识→skills 渐进披露/委派→subagents）；独立可审计 hook 控制面（Endor：Claude Code 原生 deny 50 子命令后静默失效——zcode 自控面正确）；哈希链证据+fresh-instance 审查（ICML 2608.18167：3 角色对抗>5 agent 假共识；Cognition：审查者干净上下文更好）；「智能多线程、写单线程」（Cognition 十个月收敛——与主 Agent 唯一编排同构）；graduated enforcement advisory→warn→block（A1 的 advise 档即 warn 档）；mutation 思维自证门禁（B3）。新增可取：15x token 成本闸写进 orchestration fan-out 判据（Anthropic 多 agent 数据）；「最小改动」单一约束降过度工程 39%（OpenReview U3Cp51uqH1）——宪法纪律 6 已含，可在 dev-builder 强调。

## 五、A1 tier 盘设计草案（旗舰，一个批次）

原则：**收敛而非累积**——把散落的 fast 开关/闸阻断语义/classifier ask 档/budget 警告统一引用一张表，净复杂度不升。

1. 三内置档 `fast / standard / strict`（默认 standard）；`.zcode/harness/profile.json` 一张表：每个受治理面（hook 闸×CLI 阻断动词×classifier 档位）在每档一个模式 `block / advise / off`。
2. **结构性地板**（任何档拿不掉）：三性相关闸（classifier 三性 deny、secret 扫描、scan-instructions、写路径预检越界拦、release 门）恒 block——「可调静音的底线不叫底线」。
3. **单调合并**：自定义档必须 `extends` 内置档，只许加严不许放松任何轴（codex ASSURANCE_POLICY_DOWNGRADE 语义）；`tier validate` 校验三档单调+floor 不入表+已注册闸必须在表（闸清单从 hooks 注册现算，不养第二份名单——cc 教训）。
4. **治理面自动升档**：工作树触碰 raise.paths（宪法/rules/hooks/lib/skills/commands/config/catalog）→ 本状态自动 strict 并点名文件，提交后回落（cc raise 语义：「改判官的人自动挨最严审查」）。
5. **fast 档=贷款不变**：开 fast 即现有 fast on 全套（windowId/minutes clamp/reason/DEBT 阻断 finish+release/已执行 FAIL 永不可豁免）——档位是执行强度，贷款语义是债务，两层正交。
6. **唯一解析器**：新 lib/tier.mjs 单点，hook 侧与 CLI 侧同源（cc #38 教训：一个开关三处解析一边开一边关）。
7. CLI：`tier set <档> [--reason]`（fast 必填 reason+hours 上限 8h 双侧夹）/`tier status`/`tier explain`（每闸三档各是什么）/`tier validate`；SessionStart/invariants 播报当前档+fast 剩余。
8. advise 档语义：同判定同账本（gate-log 照记），只换出口形态（提示不拦）——填 deny 与 allow 之间空隙（业界 warn 档共识）。

实施建议批次：R8=A1+A2+B1+B2（tier 盘+引擎指纹+豁免锚定+删除审计，一个 implementer 派单+tester+review 闭环）；R9=B3+B4+B5+B6+B7（轻批次）。均 HIGH 档审批后动。
