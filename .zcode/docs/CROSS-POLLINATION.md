# 交叉授粉台账（CROSS-POLLINATION）

姊妹仓机制的**周期性**吸收流程与快照。dsh 的 CAPABILITY-MATRIX 是一次性台账；本文件把它变成可重复的审阅流程，防止后人重复评估、无据吸收或无据拒绝。完整判定明细见 [CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md)；研究报告沉淀在 `.zcode/docs/research/`。

## 审阅触发条件（任一满足即跑一轮）

1. 姊妹仓有 release 或核心工作流变化。
2. 用户点名评估某仓/某机制。
3. 活跃开发期每月一次（发版停滞期可降频）。

## 审阅产出（每轮记录一节快照）

- 对每个候选机制三选一：**adopt now**（本批吸收，注明落点 verb/文件）/ **adapt later**（已排期，注明 DEV-PLAN Task）/ **reject**（写理由，进 CAPABILITY-MATRIX 明确不做清单）。
- 立场优先级：可执行检查与发布门禁 > 按需 skill > 常驻 prompt 文本（instruction text costs context on every request; a check costs nothing until it fires）。
- 新能力必须过 [CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md) 末尾的未来提案四规则（命名执法机制/命名能拦的事故/优先扩现有检查/宿主能力不存在即拒）。

## 快照 #1 —— 2026-09-01 四仓全量研究（首版）

- 范围：dsh-base（基线全量 22 项）+ codex-base / cc-base / cursor-base 增量；报告 `.zcode/docs/research/`（源 `.zcode/state/research/`，researcher 子代理只读产出，2026-09-01）。
- adopt now（已落地）：dsh 基线主体（recap/sync-check/review 全链/fast 贷款/protected 三性/install/exit 码/docs 纲要）；codex 卫生层（状态锁/quarantine/untracked 指纹/脱敏/软执法）；codex 证据计划（verification plan/evidence 三重/executor 绑定/completion 门）；cc 检查面（skills-lint③④/plan-lint/test-routing/CoVe/make-release）；cc/codex 进化与修复（聚类毕业/EVOLUTION 第④层/修复熔断）；cursor 证据语义（轮转+anchor/引用保护/FAIL-streak/planHash/三方合并）。批次锚点：R3（commit eb2bf55）→ R4（commit b8b39e6）→ R5 本批（design-brief/dfx 12 维/CI/docs 四件套）。
- adapt later（已排期）：spec-lint+trace+Spec id 制（9.2）、八属性六档+adapters（9.1，R5a 并行批）、context-pack 摘要/证据分离+时间窗（9.3）、shell 语义分类器 v2 四仓融合（10.1）、自我插桩 effectiveness（10.2）、live 路由行为测试+no-direct-code-guard（10.3，OQ-4/OQ-5 待实测）。
- reject（理由进 CAPABILITY-MATRIX 不做清单）：service 监督器、auto-push、SubagentStop 机制、sh/ps1 双写、path lease、fleet 多仓层、编译产物入仓、tdd-gate marker 链、宿主专属面。
- 关键裁决：fast mode 之争两案叠乘（dsh 贷款四条件 + cursor「已执行 FAIL 永不可豁免」）；「检查优先于常驻文本」入宪法体量标尺；三仓教训种子 15+ 条待 10.4 注入。
- 下一轮触发：R6 终验后或任一姊妹仓 release。

## 快照 #2（待续）

每轮审阅向下追加，不改写历史快照。
