# 「沟通桥梁」定位诊断与重设计方案（2026-09-08）

产品本质重述：脚手架是人和 AI 共同理解问题、形成判断、完成交付的沟通桥梁——业务理解与工程执行必须同样强大。本文诊断现状离这个定位的距离，给出取舍与批次。证据均带 file:line（主 Agent 亲读核验承重项；全文审计由子代理完成）。

## 一、诊断总判断

**工程轴（证据/执法/恢复/安全）已经过实战验证，是资产；业务轴（为什么做/谁受益/现实怎么运转/例外/依据）在框架词汇表里接近不存在**——全文 grep「业务|为什么做|谁受益|价值」仅 3 处命中（dfx-designer:56、:74、quality-attributes.md:13）。业务信息只在访谈对话中存在过一次，之后每一跳收窄为工程字段，直到归零。这不是某个 skill 写得薄，是结构性的：没有载体、没有锚点、没有执法点。

## 二、偏差证据（按严重度排序）

### 1. 派单信封零业务上下文（阶段断点之王）
`AGENTS.md:28-37` 六字段 Goal/Scope/OutOfScope/ExistingPattern/Verification/Escalation 全为工程字段；`Task-Brief-Template.md:15` 唯一业务关联是 `"refs":{"spec":"<条目>"}`（要 fresh 子代理自己去读的引用）；`orchestration.md:7` 派发即 fresh 实例。**implementer/code-reviewer/tester 三个角色在「不知为什么」的状态下写码/审码/测码**——reviewer Stage 1 只能字面对照 Spec（code-review:17），tester 语义源头是 Verification 命令不是业务场景（test-builder:16）。多代理架构下「业务理解双强」等于空中楼阁。

### 2. 理解校准机制存在于错误的 skill 里
`design-brief-builder:59`「翻译完必须复述确认（『我理解得对吗？』）——未确认的翻译只是自嗨」+ :53 充足度判据 + :19-21 选择题优先/参考锚定/感受翻译——**全框架唯一合格的采访协议长在视觉层**；最需要它的需求阶段只有 `product-spec-builder:14` 一行「三话题+禁词表+一个反问句」，且 :16 模板引用悬空（`.zcode/harness/templates/` 无 Product-Spec 模板，实测）。签字闸（workflow.md:15）批的是文档版本，不是 AI 的理解。

### 3. 全链交接物无业务载体
Architecture-Design-Template:5-9 需求映射表仅「Spec 条目|架构承接」两列；DEV-PLAN-Template:7-14 Task 表无业务列；Review-Receipt-Template:4-6 审查范围只有 diff+Spec 引用；progress-recorder:16-33 五段结构无业务事实/用户原话/领域约束栏——**SessionStart 恢复的会话业务理解归零**。唯一正面锚点：MODULE-CAPSULE-Template:5-7 有「这个模块为什么存在」栏（证明加业务栏符合现有风格）；dfx-designer:52 优先级栈+被牺牲方是唯一传递下游的判断依据（但出现在 DFX 阶段——架构决策做完才排业务优先级，顺序倒置）。

### 4. feedback 分类漏「业务理解偏差」，记忆无修正链
feedback-writer:16 四分类（流程/技术判断/机制缺口/偏好）——「你理解错了我的场景」无处落库，聚不成类毕不了业。Feedback-Template 无「依据/适用范围/supersede/trace」字段；FEEDBACK-INDEX:43 条目并列归档不修正（对照 ADR-Template:3 已有 Superseded by——修正链在 ADR 层存在，没下放）。毕业判据 occurrence≥3 纯数字，与自家教训 `.zcode/feedback/spec-overfitting-quantitative.md:20`「数字可审计≠数字承载价值」内部矛盾。

### 5. 激励错位：只有放水阀没有加深阀
Fast Mode 完备（AGENTS.md:88-90），全库无「理解不足时升级访谈」的对称机制；重批成本（workflow.md:17「内容有任何变更须重新请批」）激励绕开 Spec 直改代码，而 sync-check 不执法代码↔Spec 一致——理解漂移有制度性后门；zbase-core:21-36 路由表漏 design-brief-builder/skill-builder（与宪法 AGENTS.md:72 失同步），最好的采访 skill 触发面收窄。

### 6. 重复机制（无效复杂度）
三层路由重复（宪法表/zbase-core 表/skill descriptions，已漂移）；per-Task 闭环四份、派单六字段四份、red-locks 四份、三文件同步四份、Fast 边界五份——违反宪法自己的「检查优先于常驻文本」（AGENTS.md:11）。

### 7. FISU 四分缺失
框架有强大的「事实 vs 主张」机制（证据五步/claim 必带 evidence）但全部针对工程证据；Spec 里哪句是用户确认的、哪句是 AI 推断补全的，无标记要求；完成话术禁用词表（workflow.md:56）把「应该/大概」全禁，没给「以下是我对需求的推断，待你确认」留合法句式——**AI 表达业务不确定性的通道不存在**。

## 三、外部实践锚点（来源见调研报告，2025-2026）

- **example mapping**（Wynne）：rule 必挂具体 example；question 是头等公民——无人能答就落红卡显式存档，不许当场消化；全红=需求不成熟。
- **先查后问 + 问题预算 + 带假设直答**（arXiv 2410.13788 / CLARINET / HN over-asking 实录）：能自查的歧义自查后报「我查到 X，假设 Y」；每轮 ≤2-3 问、选择题优先、一次打包；tie 偏直答防 over-ask——always-clarify 精度最高但交互轮数翻倍，selective 折中最优。
- **纠正→持久规则 schema**（arXiv 2607.13091，4 周 9 类错误 0 复发）：{规则原文, Rationale, Scope, Traced-To 触发事件, 日期} + 启动 lint + 冲突收窄 scope + **回显确认闭环**（「已学到 R，适用 S，下次 T 触发」请用户确认）。
- **护栏原句**（codecentric EventStorming+LLM 实证）：「不得引入 artifact 之外的概念/功能」——规则只存在于对话里 LLM 就编码不出来（artifact 失败，不是模型失败）。
- **apprentice 协议**（contextual inquiry）：先观察（读代码/日志/文档）再提问，提问必须引用观察证据（「我看到 X，是否因为 Y」）。
- **ceremony 按规模分级**（Böckeler/Fowler 实测批评）：小修走 Spec Kit 全流程=杀鸡用牛刀；bug 级=复述理解直推，特性级才全流程。
- **不推荐的**：现场生成 Gherkin 正式规格（抢走对话注意力）；Kiro 固定顺序三件套强搬；纯 RAG 当领域记忆（无依据无范围无修正链）；高频微确认（决策疲劳，Pydantic「Human-in-the-Loop is Tired」）与全自主（连贯性错误需持续警觉）两个极端。

## 四、重设计（保留什么/重建什么/删除什么）

**保留（不动一行）**：hooks 三缝执法、哈希链账本、证据五步、red-locks、独立审查测试、Fast 贷款语义、三文件同步、大仓 harness、R8 tier 盘计划——工程轴已验证，且新定位明确要求工程侧继续保有。design-brief-builder 不删不重写——它是采访协议的原型资产。

**重建（业务脊柱四件）**：

1. **业务上下文脊柱**：Product-Spec 模板新增固定章节「业务上下文」——为什么做（动机/触发事件）/谁真正受益（角色+受益方式）/现实中怎么运转（流程/环境）/已知例外与隐性规则/术语表；全链交接物各加一栏锚点引用（架构需求映射表加「业务诉求」列；DEV-PLAN Task 表加「价值/未知」列；Review-Receipt 加「业务意图核对」；**派单信封加第 7 字段 `Business:`**——task start 机器校验非空，符合「检查优先于常驻文本」）。
2. **FISU 标注 + 复述协议**：Spec 正文区分【事实】（用户确认）/【推断-待确认】/【建议】/【未知】（example mapping 红卡语义：未知显式落盘不消化）；签字闸前加**理解复述**——AI 用具体业务情境走一遍三段式「我理解/我假设/请纠偏」，签字覆盖文档+复述两者。完成话术规范补合法句式：工程结论禁含糊不变，业务理解必须显式标置信。
3. **采访协议全集**（product-spec-builder 重写的核心内容）：apprentice 先观察后提问（提问引用观察证据）；先查后问（能自查的不问用户）；问题预算（每轮 ≤2-3、选择题优先、一次打包、参考锚定、「都行」→选项逼出）；带假设直答（tie 偏直答）；example mapping（每条 REQ 挂至少一个具体 example，question 落开放问题清单阻断签字）；护栏「不得引入用户未提及的概念/功能」；充足度判据（业务上下文四要素齐=可收敛，缺一=继续问或显式记未知）；对话示例与反例内嵌（好问法 vs 坏问法对照——design-brief-builder:57-58 已有范本）。
4. **纠正可见闭环**：feedback-writer 加第五类「业务理解偏差」+ 条目 schema 扩字段（依据/适用范围/supersedes 取代谁/trace 触发事件）——feedbacklint 扩展执法；**落条目同一回复必须回显**「这次纠正具体改变了什么」（改动文件/规则/后续行为/不重问的范围），不可止于道歉或记条目；progress Decisions 加修正关系标注；evolution 毕业判据从 occurrence≥3 数字改为「同族失败模式聚类」（数字降为参考，消除与 spec-overfitting 教训的内部矛盾）。

**新建（轻量两件）**：交互深度自适应判据（复用 S/M/L 规模档驱动 ceremony 深度：S=复述直推、M=标准、L=完整+架构/DFX；判据=任务清晰度×影响可逆性×用户意愿；「已答/已授权不重问」由 feedback 条目 scope 字段支撑）；pre-mortem（L 档实现前 fresh 会话假设已惨败反推——red-blue 的业务版）。

**删除（去重）**：三层路由表收敛为「宪法=唯一权威表，zbase-core=指针+差异，修同步缺口（补 design-brief-builder/skill-builder 两行）」；四处重复段落（per-Task 闭环/派单字段/red-locks/三文件同步）确立单一权威源+指针，skill 重写时一并消除；**不建 skill 间重复检测新 lint**（过度工程，skills-lint 既有面够用）。

## 五、实施批次（待拍板，HIGH 档——涉宪法与 skill 重写）

- **B1 脊柱批（核心闭环）**：Product-Spec 模板（业务上下文章节+FISU 约定）+ product-spec-builder 重写（采访协议全集）+ 派单信封第 7 字段 Business（宪法/Task-Brief/PROTOCOLS/task start 校验三处同步）+ spec-lint 扩展（S/M 档 Spec 业务章节存在性）。
- **B2 全链贯通批**：架构/DEV-PLAN/Review-Receipt 模板加业务栏 + code-review Stage 1 加业务意图核对（Spec 条目对照升级为「条目+业务诉求」对照）+ test-builder 验收来源加场景层（Verification 命令之上问「这个测试对应哪个业务 example」）+ dev-planner 价值排序（关键未知优先，不只依赖正序）。
- **B3 纠正闭环批**：feedback 第五类+schema 扩字段+feedbacklint 执法+回显协议+progress 修正关系+evolution 判据去数字化。
- **B4 自适应与减脂批**：深度自适应判据入宪法/zbase-core + 路由表修同步 + 重复段单一权威源化 + 各 skill 补对话示例/反例/分支/收敛条件（按 product-spec-builder 新标准）+ 宪法「角色」节更新为桥梁定位（执法内核不动）。
- R8（tier 盘+engineIdentityHash+豁免锚定+删除审计）独立并行不冲突，仍待拍板。

## 六、验收场景（改进前后可观察行为）

- **A 模糊需求**（「做个报表导出」）：前=直接列 REQ；后=先读现有代码观察→≤2 个选择题→带假设直答→FISU 标注 Spec→情境复述请纠偏。
- **B 用户纠正**（「不是给财务用的，是给运营」）：前=道歉+改文档；后=同一回复回显「纠正改变了什么」（信封 Business/受影响 Task/不再重问范围）+ feedback 落条目带 trace 与 scope。
- **C 小任务**（「改按钮文案」）：前=仍走仪式；后=S 档复述一句直推，零问卷。
- **D 子代理上下文**：implementer 回执信封含 Business 非空（task start 拦截空值）；reviewer 回执含业务意图核对栏。
- **E 会话恢复**：新会话问「这个项目为谁做什么」——前=只有选型流水；后=progress/Spec 业务上下文可答。
- 机器可查项（信封非空/模板章节/feedback 字段）进 lint 与测试；行为项用场景 A-E 人工验收。
