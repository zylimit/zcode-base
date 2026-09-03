# Product-Spec — zcode-base

版本: v2.0 ｜ 状态: Signed（v2.0 大重构：dsh-base 全面吸收 + 单目录封装 + 超越层） ｜ 日期: 2026-09-01

## 1. 定位

综合 codex-base / cc-base / ccb-base / pi-base / cursor-base / opencode-base / kimi-base 七个家族脚手架经验，构建遵循 ZCode 原生扩展规范的 harness 开发脚手架：git clone 即用 + 安装器安全升级，支撑 60W+ 行项目开发。v2.0 深研吸收 dsh-base（第八族、机制最成熟）全部核心机制，采用**单目录封装**（脚手架本体全部收进 `.zcode/`，安装面=一个目录+根级种子文件），并把执法从「宿主会话」扩展到**三缝**（ZCode hooks + git hooks + CI）。

## 2. 用户故事

- 作为开发者，我在 ZCode 打开装了 zcode-base 的项目，宪法自动生效、17 个 Skill 自动触发、危险操作被硬拦，无需手工配置。
- 作为架构师，我声明 module-catalog 后，架构违例被机器执法（新债零容忍、存量棘轮），ADR 幽灵引用被拦截。
- 作为质量负责人，我给模块定五性档位，未覆盖的 critical/high 属性阻断任务收口；security/safety 永不可豁免。
- 作为维护者，我用安装器把脚手架升级到项目，已定制文件自动旁路不改写。

## 3. 功能需求

| 编号 | 需求 | 验收 |
|---|---|---|
| REQ-1 | 宪法自动注入（AGENTS.md） | 当 ZCode 打开项目时宪法必须自动生效；验收：规则与 rules/ 指针一致 |
| REQ-2 | 18 个生命周期 Skill 自动触发（含 R5b 增 design-brief-builder） | frontmatter name+description 齐全；doctor 校验目录 |
| REQ-3 | 16 个 /zbase:* 治理命令 | 命名合规（^[a-z0-9][a-z0-9_:-]{0,63}$）；$ARGUMENTS 替换 |
| REQ-4 | 7 事件 hooks 硬门禁+留痕 | 危险命令 exit 2；全部拦截写 gate-log；doctor 校验注册 |
| REQ-5 | 治理 CLI（零依赖 Node≥18） | node .zcode/zbase.mjs 全 verb 必须可用且无 npm 依赖；验收：doctor/manifest 校验零依赖 |
| REQ-6 | 哈希链账本 | 断链/篡改 exit 4；fingerprint 防证据腐化 |
| REQ-7 | 五性覆盖门（反证优先） | 同属性 PASS+FAIL=uncovered；blocking 拦 task finish |
| REQ-8 | 架构棘轮 | 新违例 exit 3；baseline 放行存量；trend 只紧不松 |
| REQ-9 | 大仓三板斧 | 30k 路径 lint 必须 <2.5s；验收：impact 闭包正确；context DENY 永不入包 |
| REQ-10 | 死闸审计 | gate-audit 输出 denied=0 规则清单 |
| REQ-11 | 安装器安全升级 | 目标定制文件旁路 .zbase-new；未定制覆盖 |
| REQ-12 | 进化引擎 | feedback 条目 occurrence 计数；≥3 毕业评估 |
| REQ-13 | privacy 列入永不可豁免 | PROTECTED=security/safety/privacy 三性：豁免拒绝、fast 不可跳、backlog 不可入 |
| REQ-14 | Fast Mode 贷款语义 | 当开启 fast 时必须带 --minutes（封顶 8h）与 --reason；验收：仅跳 allowFastSkip 预标记项，SKIPPED 留痕，DEBT 阻断 task finish/release 直到还清 |
| REQ-15 | 恒定成本恢复 | recap（预算化派生摘要，超龄不超预算）+ invariants（不可谈判集重注入，对抗 compaction 漂移）；SessionStart 注入改用 recap |
| REQ-16 | 三文件同步机器执法 | sync-check：代码变而 progress.md 未变=exit 1；Spec 无 CHANGELOG=exit 1；3 个 git hooks（pre-commit/commit-msg/pre-push）经 core.hooksPath 接线 |
| REQ-17 | 模块级嵌套契约 | module-catalog 增 riskTier；high/critical 模块须带四段 AGENTS.md（Purpose/Boundaries/Invariants/Verification）；agents-lint 执法 |
| REQ-18 | 爆炸半径预算 | budget 四指标（文件数/行数/模块数/新文件数）超限 exit 1，advice=拆分或 ADR 升级 |
| REQ-19 | 记忆归档 | 当 Done/Notes 超额时必须 append-only 归档（历史只移动不删除）；验收：archive --apply 移入 progress.archive.md（指针保留），ledgerHealth 建议 |
| REQ-20 | skills-lint | frontmatter/命名/长度/重复机器校验；防 skill 被宿主静默丢弃 |
| REQ-21 | 指令文件安全扫描 | scan-instructions 八规则（endpoint 覆写/嵌入凭据/指令覆盖/渗出命令/静默执行/隐藏字符/门禁禁用指令）；error>0 exit 1 |
| REQ-22 | 规则接线审计 | rules-audit：宪法规则行三态（enforced/declared-unenforced/unenforced），输出 enforcementRatio |
| REQ-23 | 审查引擎化（结构化分歧） | review start/blue/lens/verdict/backlog/review-pack；diffHash 绑定树变即 stale（exit 4）；stage 门（code→functional→trust）；profile 组队属性只缩不扩；maxRounds 封顶 escalate；三性 finding 不可 backlog；ACCEPT+final 才写回执 |
| REQ-24 | 发布证明聚合 | 十二条件（9 阻断+3 非阻断：worktree-clean 脏树阻断、ci-status 判决阻断且 unknown is not a pass、review-profile 降档可见化）全 READY 才 exit 0 且必须 never tag/push/deploy；验收：dod 十二步静态 DoD（blocking 失败 exit 2） |
| REQ-25 | 安装器增强 | --dry-run/--verify（先 stage 再测）/--targets-from 批量/--json；LF 归一化比较防 CRLF 误报 |
| REQ-26 | 测试重组 | helpers（spawn+tmpdir 隔离）+ 按机制分组 + launcher（无测试文件=degraded） |
| REQ-27 | 八属性六档 | +availability/performance/maintainability、+minimal 档；minimal/none 须 attributeReasons（opt-out 是记录的决策） |
| REQ-28 | 需求可判定可追溯 | spec-lint（EARS 规范词/触发词/度量/验收/占位/模糊词/重号）+ trace（需求 id 被测试引用，悬空引用 fail） |
| REQ-29 | CI workflow | .github/workflows/gate.yml：矩阵（linux×win × node）必须 selftest 先行；验收：doctor always（诊断不阻断） |
| REQ-30 | 治理文档四件套 | OPERATING-MODEL（九阶段+签字闸）/CAPABILITY-MATRIX（吸收拒绝台账）/ADOPTION（三起点十步序）/ADR-CONTRACT + research 实证沉淀 |
| REQ-31 | 工程配套 | LICENSE(MIT)/CHANGELOG/.editorconfig/.gitattributes(LF 归一化配套)/package.json scripts 对齐 |
| REQ-32 | 单目录封装 | 当安装到目标项目时，脚手架本体必须全收 `.zcode/`（引擎/skills/commands/feedback/rules/docs/harness/githooks/state）；验收：install=复制一个目录+根级种子；运行态 .zcode/state/ gitignored |
| REQ-33 | 三缝执法 | ZCode 会话 hooks（7 事件）+ git hooks（pre-commit/commit-msg/pre-push 经 core.hooksPath）+ CI workflow——会话内、人提交、推送前三个层面全覆盖 |
| REQ-34 | 自我插桩（超越层） | 当某门从未触发时必须给证据或撤：每个 gate/lint 规则记录拦截/触发次数；验收：gate-audit 升级为 effectiveness 报告——治理处方假设未经验证，自我度量 |

## 4. 非功能需求（八属性初档，细化见 module-catalog）

- 可靠 critical（.zcode/lib 账本/门禁正确性）；安全 high（拦截不误放）；隐私 high（DENY 路径）；韧性 high（断链 fail-closed）；Safety none+attributeReasons（纯软件工具）；可用/性能/可维护档位按实情声明（runtime-harness performance/maintainability=medium，其余 none+理由），Task 9.1 起为八属性六档（+minimal；退出治理须 attributeReasons）。
- 性能预算（数字化，tests/performance.test.mjs 锚点消费）：hook 执行必须 <15s（现 hook timeout 上限）；selftest（120 模块 × 3 万路径规模冒烟）<2.5s；catalog lint 30k 路径 <2.5s；impact 反向闭包（合成仓 64 模块链）<5s；500 untracked 文件 fingerprint 端到端（含进程启动）<3s；CLI 模型可见输出 ≤12000 字符（超限响亮拒绝）。

## 5. 边界（Out of Scope）

- 不做多模型跨进程编排（ccb 形态）；不做 IDE 插件；不深度耦合特定 CI 平台（提供可选 GitHub Actions workflow）；不内置 MCP server（hook+CLI 已覆盖，留作演进）；fleet 多仓合同层暂缓（无多仓场景，见 OQ-3）。

## 6. 开放问题

- OQ-1: 插件发行面（双形态）是否值得做 → 二期评估。
- OQ-2: hook 输出的严格 JSON schema 字段名以客户端实测为准（当前用退出码+additionalContext 保守契约）。
- OQ-3: fleet 多仓合同层（fleet.json/契约 sunset/coordinationCost）暂缓，出现真实多仓场景再评估。

## 变更记录

见 `Product-Spec-CHANGELOG.md`。
