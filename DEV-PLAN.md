# DEV-PLAN — zcode-base v1.0（自举）

前置: Product-Spec v1.0（Signed）。M 档项目：架构见 docs/ARCHITECTURE.md + ADR×5；DFX 见 module-catalog attributes + verification-matrix。

## Phase 1: 骨架与宪法

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 1.1 | package.json/.gitignore/setup.sh/README | governance | low | 文件存在 + setup.sh --help |
| 1.2 | AGENTS.md 宪法 + rules/ 四件套 | governance | medium | 人工审查（宪法 vs rules 一致性） |
| 1.3 | docs/ ×5 + ADR ×5 | governance | low | adr check 零幽灵引用 |

## Phase 2: 治理 runtime

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 2.1 | 基础设施：common/config/state/git | runtime-harness | high | node --test |
| 2.2 | 契约执法：catalog/impact/context/arch | runtime-harness | high | node --test + selftest <2.5s |
| 2.3 | 证据体系：receipts/waivers/quality/tasks | runtime-harness | critical | node --test（断链/反证用例）|
| 2.4 | 留痕与审计：audit/risk/retention/fitness | runtime-harness | medium | node --test + gate-audit |
| 2.5 | hook 统一入口 hooks.mjs + zbase.mjs CLI | runtime-harness | critical | 7 事件模拟（deny/放行/注入）|

## Phase 3: ZCode 原生面

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 3.1 | .zcode/config.json（7 事件注册） | governance | high | doctor hooks 校验 |
| 3.2 | skills ×17 | skills | medium | 目录/frontmatter 齐全 |
| 3.3 | commands ×16 | commands | low | 命名合规 + $ARGUMENTS |
| 3.4 | feedback 体系（INDEX+5 种子） | feedback | low | INDEX 与条目一致 |

## Phase 4: 契约与测试

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 4.1 | harness/：catalog/matrix/schemas×6/templates×9 | contracts | medium | catalog lint + schema 自洽 |
| 4.2 | tests/harness.test.mjs | contracts | high | node --test 全绿 |
| 4.3 | 安装器 + FRAMEWORK-MANIFEST | installer | medium | manifest check + install 旁路用例 |

## Phase 5: 终验与收口

| Task | 内容 | 验证 |
|---|---|---|
| 5.1 | 终验链：node --test / doctor / selftest / 7 hook 模拟 / catalog/arch/fitness/quality 自举 | 全绿 |
| 5.2 | manifest generate + progress.md 收口 | manifest check 零漂移 |

## 里程碑

| 里程碑 | 判据 | 回滚点 |
|---|---|---|
| M1 骨架可用 | Phase 1-2 完，CLI verb 全可用 | git tag v0.1.0-skeleton |
| M2 原生面生效 | Phase 3 完，doctor 全绿 | git tag v0.5.0-native |
| M3 v1.0 发布 | Phase 5 终验全绿 + 用户批准 | git tag v1.0.0 |

## Phase 6: R1 结构重构——.zcode/ 单目录封装（✅ 已完成 2026-09-01）

前置: Product-Spec v2.0（REQ-32）。纯迁移不改行为。

| Task | 内容 | 风险 | 验证 | 状态 |
|---|---|---|---|---|
| 6.1 | git mv 全树 → .zcode/；.zbase→.zcode/state；.zcode/.gitignore(state/) | high | git status 109 项边界正确 | ✅ |
| 6.2 | 全路径引用切换（55+ 文件：宪法/rules/docs/skills×17/commands×16/matrix/package/setup/tests） | high | grep runtime/zbase.mjs 零残留 | ✅ |
| 6.3 | install 单目录化（MANAGED_ROOTS=['.zcode'] 排除 state；wrapper→.zcode/zbase.mjs） | high | 隔离 HOME 冒烟 96 文件 + 8 wrapper 新路径 | ✅ |
| 6.4 | manifest 重生成（99 文件） | medium | manifest check 零漂移 | ✅ |

验收证据（主 Agent 新鲜重跑）: npm test exit 0 / doctor exit 0 / selftest 0.21s / manifest ok / hook session-start 正常；用户级 ~/.zcode/cli/config.json 8 处 wrapper 已切新路径（备份 ~/.zcode/backups/user-config.json.bak-pre-v2-20260901）。

## Phase 7: R3 地基机制（REQ-13..19 + codex/cursor 缺陷修复级增量）

研究输入: .zcode/state/research/{dsh-base-mechanisms,codex-base-delta,cursor-base-delta,cc-base-delta}.md

| Task | 内容 | 源 | 风险 | 验证 |
|---|---|---|---|---|
| 7.1 | PROTECTED 扩三性（privacy）+ 豁免/backlog/fast 三消费点拒绝 | dsh | high | privacy 豁免拒绝用例 |
| 7.2 | Fast 贷款语义：--minutes ≤480/--reason 必填/allowFastSkip 预标记/SKIPPED 留痕/DEBT 阻断 task finish + **windowId 窗口绑定** + **已执行 FAIL 永不可 fast 豁免** | dsh+codex1.15+cursor3.1 | critical | fast 用例组+窗口失效用例+FAIL 不可豁免用例 |
| 7.3 | **跨进程状态锁**（wx 锁+pid 存活+stale 突破+ownerToken）+ **quarantine 损坏隔离**（.corrupt-<ts>+事件账本+risk 信号） | codex1.13/1.14+cursor#1/#11 | critical | 双进程并发不丢更新用例+损坏隔离用例 |
| 7.4 | **untracked 内容入指纹**（字节级+symlink 不跟随+:(literal) pathspec+输出截断响亮失败 256MiB） | codex1.18 | high | untracked 改内容换指纹用例 |
| 7.5 | **全局输出脱敏** redactSecrets（13+9 类模式，receipt note/logGate/hook emit 三出口）+ boundedHead 截断 | codex1.3+cursor#2/#16 | high | token 形态样例全脱敏用例 |
| 7.6 | **写路径预检**（工具+shell 写路径提取/apply_patch 解析/symlink 逃逸检测/ownedPaths 闸/knownHashes 并发冲突检测/preexisting_dirty 区分） | codex1.4+cursor#3 | critical | 任务外写 deny+并发冲突 deny+symlink 逃逸 deny 用例 |
| 7.7 | 护栏资产软执法（引擎文件写=播报+gate-log 两档）+ hook/CLI 输出预算（boundedHookOutput/modelBounded） | codex1.5/1.19 | medium | 软执法留痕+超限拒断用例 |
| 7.8 | Stop 三振按状态分键（sha256(task+fingerprint+缺失清单)）+ release 留痕 | codex1.7+ccA8 | high | 不同缺失分键计数用例 |
| 7.9 | budget 四指标 + archive --apply（+阈值自动触发 M3）+ ledgerHealth | dsh+ccM3 | medium | 超限 exit 1+append-only 用例 |
| 7.10 | sync-check（--staged）+ **three-file-sync 挂 Stop**（共用判定函数+recorder 豁免标志）+ 3 git hooks（pre-commit 含按栈编译门 ccA7/commit-msg/pre-push）+ install --hooks 接线 | dsh+ccA2/A7 | high | 双 error 用例（临时仓）+Stop 拦截用例 |
| 7.11 | 嵌套 AGENTS.md：riskTier + agents-lint 四段 + MODULE-AGENTS 模板 + 本仓 critical/high 模块落地 | dsh | medium | 无契约 error 用例 |
| 7.12 | recap + invariants（预算化派生+**脏树校准提醒 A4**+**待毕业 feedback 播报 A5**）；SessionStart 切 recap | dsh+ccA4/A5 | high | 预算截断+hook 冒烟 |
| 7.13 | 宪法/rules 同步（三性/贷款/命令表/「检查优先于常驻文本」原则/Not doing 段进模板） | governance | medium | rules-audit 预跑+人工对照 |

## Phase 8: R4 体系机制（REQ-20..26 + codex 高价值增量）

| Task | 内容 | 源 | 风险 | 验证 |
|---|---|---|---|---|
| 8.1 | skills-lint（frontmatter/命名/长度/重复+**触发式描述 ③④**）+ scan-instructions 八规则 | dsh+ccF | medium | 坏样例 exit 1 |
| 8.2 | rules-audit（三态+ratio）+ **test-routing 双向一致性**（宪法声明 vs 磁盘）+ **plan-lint**（计划侧占位词/Phase 锚点） | dsh+ccG/E | medium | 三 lint 实扫 |
| 8.3 | **verification plan**（riskChecks 组队+module.verification 并集+保守扩散+依赖 DAG+资源锁+planHash+空计划阻断） | codex1.8/1.9 | critical | 组队推导用例+环检测+空计划 BLOCKED |
| 8.4 | **evidence 三重完整性**（独立文件+bytes/hash 句柄+路径安全+逐字节复验）+ retention 引用保护 + 账本轮转+anchor | codex1.10+cursor#9/#10 | high | 篡改三态可检出用例 |
| 8.5 | review 全链引擎化（session/blue/lens/verdict/backlog/review-pack+stage 门+profile+maxRounds）+ findings schema 加 **CoVe verificationQuestion 字段**（Judge 前独立核验）+ **completion 门聚合**（optional FAIL 阻断+review scope 与 ownedPaths 比对+requiresReview 按风险档） | dsh+ccJ+codex1.11 | critical | stage/stale/maxRounds/scope 用例组 |
| 8.6 | **executor 角色绑定**（high 风险回执须 tester 执行）+ waiver 契约扩 Compensation/Approval | codex1.12+cursor#13 | high | 非 tester 回执 finish 拒绝用例 |
| 8.7 | release 九条件 + dod 静态聚合 + **make-release 打包**（私人 feedback 剥离+打包后泄漏自验） | dsh+ccD | high | READY/never-tag/泄漏扫描用例 |
| 8.8 | install 大合流（--dry-run/--verify 先 stage/--targets-from/--json/LF 归一化+**事务性回滚/post-verify/install-receipt**+三方合并 upgrade/uninstall+safeManagedPath+bootstrap 出厂态警告） | dsh#14+codex1.22/1.23+cursor#14 | high | 故障注入回滚用例+批量冒烟 |
| 8.9 | fitness scan 子命令（五反模式+行内抑制）+ managedDrift + FAIL-streak 根因重定向 + feedback 引擎化 lint/毕业候选 | codex1.21/1.22+cursor#7/#8 | medium | 反模式样例用例 |
| 8.10 | lib 模块界重组（19→七模块界）+ tests 重组（helpers spawn+tmpdir/按机制分组/launcher+**并发正确性/性能预算/对抗性三类测试**） | dsh§16+codex§3 | high | 全量绿+性能锚点（600k 行合成仓） |
| 8.11 | 宪法/rules/skills 对接同步（red-blue-review skill 引擎协议版） | governance | medium | 路由行为预验 |

## Phase 9: R5 扩展（REQ-27..31 + cc/codex 扩展）

| Task | 内容 | 源 | 风险 | 验证 |
|---|---|---|---|---|
| 9.1 | 八属性六档 + attributeReasons + 存量迁移 + **adapters 表**（11 工具+adapters add 接线——八属性证据供给侧） | dsh#18+ccB/cursor#4 | high | lint 拒未理由降档+adapters list 探测 |
| 9.2 | spec-lint(EARS) + trace + Spec id 制 + **Spec 自举三细节**（性能预算数字化/DEV-PLAN Expected 字段/复制面维护面分离+pack-check） | dsh+codex§2 | high | 自举 Spec 实扫+悬空用例 |
| 9.3 | context-pack 升级（denied→diff 整体省略/摘要证据分离；收敛算法可后补）+ runtimeValidityHours 时间窗 | codex1.20+cursor#5 | medium | 秘密变更不入包用例 |
| 9.4 | skills 增补：design-brief-builder（视觉层）+ dfx-designer 12 维/六要素/双模式扩写 + evolution 四层第④层（Skill 自动生成提案）+聚类毕业 + bug-fixer 修复熔断闸 | codex5.1/ccK/L/M1/M2 | medium | skills-lint 全绿 |
| 9.5 | CI workflow（矩阵+selftest 先行+doctor always）+ 工程配套（LICENSE/CHANGELOG/.editorconfig/.gitattributes） | dsh#17+§22 | low | YAML 合法+配套齐 |
| 9.6 | docs 四件套（OPERATING-MODEL/CAPABILITY-MATRIX/ADOPTION/ADR-CONTRACT）+ **CROSS-POLLINATION 周期化台账** + research 沉淀 | dsh§19+codex§3 | low | 文档齐+引用有效 |

## Phase 10: R6 超越层 + 终验（REQ-34）

| Task | 内容 | 源 | 风险 | 验证 |
|---|---|---|---|---|
| 10.1 | **shell 语义分类器 v2**：tokenizer+wrapper 剥壳+嵌套 shell 递归（codex1.1）+管道级秘密外传跟踪（cursor#12）+融合参数提取（codex1.2）+三档决策 禁/确认/放行+规则自带 match/notMatch 测试向量（codex safety.rules） | 四仓融合 | critical | 变形攻击面测试组（sudo/timeout 穿透/bash -c 递归/管道外传/融合参数） |
| 10.2 | 自我插桩：检查有效性计数（gate-log 派生每规则拦截数）+ gate-audit 升级 effectiveness 报告 | REQ-34+ccN7 | high | 计数落账+报告用例 |
| 10.3 | live 路由行为测试（断言库/fixture/selftest 层先行；live 层 OQ-5 待宿主实测）+ no-direct-code-guard（OQ-4 待实测，先做台账模式） | ccH/A1 | medium | 断言库自验含对抗 fixture |
| 10.4 | feedback 种子注入（三仓教训 15+ 条：多仓提交隔离/品牌资产/豁免生命周期/主 Agent 亲读/量化指标否决/修配置扫同类实例等） | 三仓 N/§6 节 | low | feedback-lint 绿 |
| 10.5 | 终验链全量（tests/doctor/selftest/dod/release/recap/7 hook 模拟/对抗测试）+ manifest + progress 收口 + CAPABILITY-MATRIX 终稿 | 全部 | high | 全绿 |

## 里程碑（v2.0）

| 里程碑 | 判据 | 回滚点 |
|---|---|---|
| M4 单目录成型 | Phase 6 全绿（✅ 2026-09-01） | git tag v2.0.0-structure |
| M5 地基+体系 | Phase 7-8 全绿（锁/指纹/脱敏/写预检/recap/review 引擎化/evidence/plan） | git tag v2.0.0-mechanisms |
| M6 v2.0 发布 | Phase 9-10 终验全绿 + 用户批准 | git tag v2.0.0 |

## OQ（v2.0 新增）

- OQ-4: ZCode 用户级 hooks 是否对 Agent 工具内子代理的工具调用触发（决定写路径预检作用域与 no-direct-code-guard 形态）。
- OQ-5: ZCode 是否有 headless CLI + 事件流日志（决定 live 路由行为测试可行性）。
