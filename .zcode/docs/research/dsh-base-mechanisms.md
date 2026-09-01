# dsh-base 机制实现事实报告

> researcher 产出 · 2026-09-01。研究对象 `/home/z00632348/code/dsh-base`（只读，未改动任何文件）。
> 所有「文件:行号」均相对 dsh-base 仓库根。引擎总规模：dsb.mjs 998 行 + lib/ 7 模块 3805 行 + install.mjs 304 + audit/ 4 脚本 396 行 + githooks 3 个 ≈ 5900 行 mjs/sh，零依赖 Node≥20。
> zcode-base 对照基于 `/home/z00632348/code/zcode-base/runtime/`（zbase.mjs 306 行 + lib/ 19 模块 1731 行，19 个 case 路由）。

---

## 1. `recap` / `invariants`（memory law）

**目的**：把无界增长的项目记忆变成有界的派生摘要，并在 compaction 后重注入不可谈判的规则。

**实现摘要**（`lib/context.mjs:300-526`）：
- 配置默认 `MEMORY_DEFAULTS`（context.mjs:308-315）：`ledger=progress.md`、`archive=progress.archive.md`、`maxLedgerBytes=24000`、`keepDone=40`、`keepNotes=30`、`recapBudget=6000`；由 `catalog.memory` 覆盖（memoryConfig，:317-319）。
- `parseLedger`（:322-331）把 progress.md 按 `## ` 标题切段；`entriesOf` 取 `- ` 开头条目；`priorityOf`（:337-339）识别行首 `- #N P0/P1/P2` 优先级 token（排除正文提及）。
- `recap(catalog, {budget})`（:437-483）数据流：progress.md 切段 → `specLint`+`trace`（需求/覆盖数）→ `readTask()` → ledger 里最后一条 gate → `riskScan`（decay 信号）→ git branch/dirty 数 → 拼 blocks：Position（分支/commit/活跃任务/last gate/需求覆盖）、Pinned(12)、In progress(8)、Next P0(10)、Next P1(10)、Decisions(5)、Done(6)、Risks(8)、Decay signals → 超预算硬截断并标注 `truncated`。每行 `clip(line, 200)`（:346-347）。CLI 侧 `dsb recap`（dsb.mjs:483-492）附 `ledgerHealth`（字节数/Done 条数/归档建议）。
- `invariants(catalog, {budget=1200})`（:496-526）：输出固定 5 条法则（EVIDENCE 五步 / STATES 四态+exit3 非通过 / FLOOR 三性永不可豁免 / SCOPE / TIERS HIGH 停下）+ Live state（活跃 task、fast 是否开着含 DEBT、last gate、ledger 是否断链）。动机写在注释：ContextEcho 23 模型实测 compaction 不修正漂移（:484-494）。

**规模**：1 文件（context.mjs）约 190 行核心 + recap 依赖 specLint/trace/riskScan/readTask/readLedger（跨 4 模块）。

**移植成本**：**低**。纯派生读取，无 git 写、无状态；zcode-base 已有 progress.md 三文件铁律与 `.zbase/state.json`，把数据源换成 zcode 的 task/fast/ledger 即可。invariants 几乎可原样搬（改 5 条法则文案 + state 来源）。

**依赖**：依赖 ledger 账本、task 状态、fast 状态、riskScan；recap 依赖 specLint+trace（若不移植 spec 体系可降级为跳过该行）。

---

## 2. `sync-check` + 三个 git hooks 接线

**目的**：项目记忆不得落后代码超过一个 commit；用 git 作为 DSH（无 hook 宿主）唯一的执法缝。

**实现摘要**：
- `syncCheck(catalog, {staged, paths})`（`lib/quality.mjs:571-623`）：输入 = git 变更路径（`--staged` 时仅 index，否则工作树+untracked+staged 合集，core.mjs:274-288）。判定：
  - `codeChanged` = 变更中经 `classifyPath` 归类为 module 的路径；
  - **MEMORY_BEHIND_CODE**（error）：`codeChanged.length > 0 && ledgerFile(默认 progress.md) 不在变更集`（:583-591）；
  - **SPEC_WITHOUT_CHANGELOG**（error）：requirementDirs 下非 CHANGELOG 的 .md 变了而同名窗内无 CHANGELOG .md（:593-604）；反向 CHANGELOG_WITHOUT_SPEC 为 warning（:605-611）。
  - 输出 findings + counts，error>0 → exit 1。
- **pre-commit**（`githooks/pre-commit`，61 行 sh）：catalog 存在才跑；顺序执行 secrets(--staged) / instructions(--staged) / syntax / catalog-lint / skills-lint / agents-lint / fitness(--staged) / sync-check(--staged)；exit 3（degraded）只播报不计失败；**budget 超限只 echo 不阻断**（:50-51）；末尾列出 FAILED 并提示 `--no-verify` 是 HIGH-tier 行为。
- **commit-msg**（36 行）：纯 sh，主题 <12 字符拒绝；wip/fix/update/misc 等空词拒绝；>72 字符警告不阻断；`#`/Merge/Revert 前缀放行。
- **pre-push**（53 行）：跑 `dod`（静态 DoD）+ `gate --baseline @{u}`（有上游时按将发布的 range 判定，无上游按工作树）；任一非 0 → 阻断，并明示 exit 3 = gap 非 pass。
- **core.hooksPath 接线**：`dsb init`（dsb.mjs:543-553）`git config core.hooksPath .dsh/base/githooks` + chmod 755 三钩子；`install.mjs --hooks`（install.mjs:181-197）同操作外加 `git add --chmod=+x` 把可执行位记进 index（防 Windows 文件系统克隆后失位）；doctor 校验 `hooksPath === '.dsh/base/githooks'`（context.mjs:157）。

**规模**：quality.mjs 53 行 + 3 个 sh 钩子 150 行 + init/install 接线 20 行。

**移植成本**：**低**。检测逻辑 50 行纯函数；git hooks 与 core.hooksPath 对 ZCode 用户完全适用（ZCode 宿主 hooks 管不了 git 提交，这恰好是互补面）。zcode-base 现有 hooks 在用户级 `~/.zcode/cli/config.json`（7 事件），加 git 钩子不冲突。注意 zcode 宪法已有「三文件同步铁律」但无机器执法——这正是缺口。

**依赖**：classifyPath/catalog（判断哪些路径算 governed code）；pre-commit 依赖 audit 脚本与多个 lint 命令存在。

---

## 3. review 体系全链（start/blue/lens/verdict/status/team/backlog/review-pack）

**目的**：把「结构化分歧审查」做成闸：verdict 由已记录事实计算而非断言，并绑定 diffHash。

**实现摘要**（`lib/quality.mjs:680-1048` + dsb.mjs:792-928）：
- **数据存储**：`.dsh/base/state/review/session.json`（REVIEW_PATH :693）——单文件会话，含 version/diffHash/baseCommit/scope/requiredLenses/excludedLenses/lineage/blue/lenses/verdict/backlog。
- **start**（startReview :790-820）：先 `computeImpact` 得受影响模块 → `reviewLenses` 组队 → 拒绝空 diff（`no-change` degraded）；若上一会话 verdict=FIX_REQUIRED，把其 diffHash/errorCount 追加进 `lineage`（轮次血缘）。 convened 逻辑（:751-771）：显式 `catalog.review.lenses` 赢；否则按 profile（personal=1 lens / team=3 / production=6 / regulated=9，REVIEW_PROFILES :730-738）× **属性裁剪**：lens 声明的属性若没有受影响模块声明在 `low` 以上则不召集（correctness 无属性永留）。lensExclusions（:774-784）给出每个未召集理由。
- **blue**（recordBlue :831-841）：stdin JSON `{"claims":[{"claim","evidence"}]}`；空 claims 拒；任何 claim 缺 evidence 拒（"a claim without a command, a path or an exit code is an opinion"）。
- **lens <name>**（recordLens :871-911）：stdin `{"findings":[{"severity","location|reproduction","summary"}]}`。校验：lens 必须在 requiredLenses；每条 finding 必须 `file:line`（正则 `/^[^\s:]+:\d+/`）或可跑的 reproduction，否则整批拒；severity ∈ error|warning|info。**stage 门**（stageGated）：LENS_LIBRARY 每个 lens 有 stage 1/2/3（code/functional/trust，:708-712）；`currentStage`（:849-869）算最高可报阶段（当前 stage 的 required lens 未报完不得开下一 stage；profile 没召集的空 stage 跳过）；越阶段提交返回 `stageGated:true` → exit 1 并提示看 status。
- **verdict**（reviewVerdict :918-1003）：freshness 通过后，errors=所有 lens 的 error findings（跨 stage 聚合，error 是主导事实）；unable lens 存在 → NEEDS_MORE_EVIDENCE；当前 stage 有 lens 未报 → blocker；否则 ACCEPT。`maxRounds` 默认 3（catalog.review.maxRounds）；`escalate = FIX_REQUIRED && round >= maxRounds`（:947）→ 输出 STOP 建议（缩范围/降 profile/记债）。`isFinal = stage>=3 || 无更深 stage lens`；**仅 ACCEPT+isFinal 才自动 `writeReceipt`**（lenses 字段随回执落盘）。advice 文案按 verdict/escalate 分支。
- **stale（exit 4）**：`freshness(s)`（:823-828）= `s.diffHash !== diffHash()` → 所有写操作（blue/lens/verdict/backlog add）返回 stale，CLI 层 `r.stale ? EXIT.STALE : EXIT.VIOLATION`（dsb.mjs:829,844,860）。
- **backlog**（:1014-1048）：add 需 owner/expiry(未来 ISO)/summary/lens；`BACKLOG_FORBIDDEN = /(security|safety|privacy|pii|secret|credential)/i` 拒绝三性 finding 入积压（:1025-1027）；list 标注 EXPIRED。
- **review-pack**（dsb.mjs:367-424）：base 解析顺序 tag→origin/main→首 commit；产出 md（Commits/Diffstat/**Deletion audit 删除审计**/Untracked/Diff）；diff >800 行溢写 `.dsh/base/state/review/diff-<ts>.patch` 只留指针。
- **task complete 强制结构化**（completeTask :548-554）：结构化未关（catalog.review.requireStructured!==false）时，接受回执必须带 lens 覆盖，否则 blocker（"共识比三个分歧的 lens 度量更差"）。

**规模**：quality.mjs 约 370 行（680-1048）+ dsb.mjs 路由 137 行 + review-pack 58 行；1 个测试文件 review.test.mjs(182) + review-stages.test.mjs(141) + review-team.test.mjs(129)。

**移植成本**：**中**。逻辑自足（单 JSON 文件状态机+stdin 协议），无宿主耦合；成本在于与 zcode 现有 red-blue-review skill（纯 prompt）的整合——dsh 的做法是把协议下沉进引擎，skill 只剩指导。ZCode 子代理派单模式与 stdin JSON 协议天然匹配。

**依赖**：diffHash（core.mjs:333-336，排除运行态目录的 canonical diff）；writeReceipt（回执）；computeImpact+catalog（lens 组队）；readTask。

---

## 4. `budget`（blast-radius budget）

**目的**：变更爆炸半径信号——超预算不禁止，但必须分裂变更或显式 ADR 升级。

**实现摘要**（assessBudget，`lib/quality.mjs:473-510`）：输入 = catalog.budget 限额（默认 maxChangedFiles 40 / maxChangedLines 1500 / maxModulesTouched 3 / maxNewFiles 25，core.mjs:356）+ git 事实：changedPaths 数、`git diff --numstat`（staged 用 --cached，否则对 HEAD）累加 added+removed、untracked 数、`impact.direct.length`。四指标逐一 `actual > limit` → finding。输出 `{ok, metrics, limits, findings, advice}`，超限 exit 1，advice 固定文案「Split the change, or record an explicit decision (ADR + plan)」。pre-commit 中**只播报不阻断**；dod 中 non-blocking；`gate` 不消费它。

**规模**：38 行单函数。

**移植成本**：**低**。零新依赖（zcode 已有 impact）；只需补 numstat 聚合。

**依赖**：computeImpact（modulesTouched）、catalog.budget。

---

## 5. `rules-audit` + `audit/scan-instructions.mjs`

**目的**：审「宪法里的规则是否有真实执法点」；把 AGENTS.md/SKILL.md 当不可信输入做安全扫描。

**实现摘要**：
- `rulesAudit`（`lib/scan.mjs:637-735`）：扫目标文件（默认 `AGENTS.md`，可 `--files`）。逐行：跳过 code fence；`## / ###` 标题记 section；规则行 = `/^\s*(?:\d+\.|-|\|)\s+\S/`（编号/圆点/表格行）且 ≥25 字符。**执法点判定**（enforcementTokens :654-664）：行内反引号 token 剥掉 `node .dsh/base/dsb.mjs ` / `dsb ` 前缀后，命中 `known` 集合 = catalog.checks 键 ∪ ENGINE_CAPABILITIES（38 个引擎能力名，:232-242）∪ FITNESS_RULE_IDS。三态：`enforced`（有 token）/ `declared-unenforced`（行内或下一行或 section 名含 `prompt-only|(P)`）/ `unenforced`（两者皆无 → RULE_UNENFORCED error）。输出 enforcementRatio 与 advice；**默认 advisory**：`catalog.rules.maxUnenforced` 为 null 时上限 Infinity（:708-709），设数字才变闸。
- `scan-instructions.mjs`（audit/，148 行）：对 10 类指令文件模式（AGENTS(.local).md/CLAUDE.md/GEMINI.md/.cursorrules/.cursor/rules/copilot-instructions/.windsurfrules/skills/*/SKILL.md/.dsh/skills//.agents/）跑 8 条规则：endpoint-override（ANTHROPIC_BASE_URL 等）、embedded-credential（sk-/ghp_/AKIA/xox/PEM）、instruction-override（"ignore previous instructions" 类）、exfiltration-command（curl -d/--upload-file 等）、silent-execution（curl|sh）、hidden-characters（零宽/双向控制符）、gate-disable-instruction（--no-verify/skip hooks）为 error；secret-file-read 为 warning。行级扫描，`scan-instructions:ignore` 抑制注释（本行或上一行）；>1MB 跳过并 warning；非 git 环境 exit 3；error>0 exit 1。stdout 一行 JSON。声明 class security → 永不可豁免/快跳。

**规模**：rulesAudit 98 行（scan.mjs）+ scan-instructions 148 行独立脚本。

**移植成本**：**低**。rulesAudit 只需替换 ENGINE_CAPABILITIES 集合为 zbase 命令名与路径前缀（`node runtime/zbase.mjs`）；scan-instructions 几乎原样可用（模式列表已含 `.agents/`），改路径前缀即可。ZCode 用户同样面临指令文件攻击面（AGENTS.md 自动注入）。

**依赖**：rulesAudit 依赖 catalog.checks + fitness 规则 id + 引擎能力名单（移植时要与 zbase 实际命令面同步，否则产生 PHANTOM）；scan-instructions 无引擎依赖（独立脚本）。

---

## 6. `skills-lint`

**目的**：校验 skill 目录满足宿主发现契约（frontmatter 完整性/命名/体积），防止整 skill 被静默丢弃。

**实现摘要**（`lib/scan.mjs:377-476`）：扫描根 = `['.dsh/skills', '.agents/skills', $DSH_HOME/skills]`（:417）。发现形态：`<root>/<name>/SKILL.md` 或平铺 `<root>/<name>.md`；根级 AGENTS/CLAUDE/README 保留名跳过（:412）。手写 frontmatter 解析器 parseFrontmatter（:384-406，支持引号剥壳、`>-`/`|` 折叠、缩进续行）。校验项：NO_SKILL_MD（目录无 SKILL.md）、BAD_FRONTMATTER、NO_NAME、NAME_NOT_KEBAB、NAME_MISMATCH（frontmatter name ≠ 目录名——发现与装载不一致即失效）、NO_DESCRIPTION、DESCRIPTION_TOO_LONG（>500 error，目录截断阈值；>220 warning）、CAMEL_CASE_KEY（`disableModelInvocation` 等 camelCase 键 error——宿主会整丢）、NON_BOOLEAN_INVOCATION、SKILL_LARGE（>24000 bytes warning，建议移 references/）、DUPLICATE_SKILL（重名 error，近层遮蔽远层）。输出 skills 清单（含 userInvocable/modelInvocable 派生）+ counts。

**规模**：约 100 行。

**移植成本**：**低**。zcode-base skills 在 `.agents/skills/`（ZCode 原生规范），扫描根已兼容；只需按 ZCode 原厂 SKILL.md 规范核对阈值（500/220/24000 是 dsh 宿主数字，需按 ZCode 实测调）。

**依赖**：DSH_HOME 概念（ZCode 对应 `~/.zcode/`）；无引擎内依赖。

---

## 7. fast 四条件实现

**目的**：服务截止压力下的放水需求，但四条件保证它不变成永久。

**实现摘要**（`lib/quality.mjs:624-679` + context.mjs:228-236 + dsb.mjs:724-771）：
1. **`allowFastSkip` 预标记**：在 `catalog.checks.<id>.allowFastSkip: true` 声明（catalog.json 中仅 `unit`、`trace` 两项）；`fastSkippable(catalog)`（quality.mjs:670-679）列出可跳清单并**剔除一切 protected**；catalog-lint 对 protected 属性 check 设 allowFastSkip 直接报 `PROTECTED_FAST_SKIP` error（graph.mjs:97-99）。
2. **`--minutes`/`--reason` 必填 + 8h 封顶**：`setFast`（:650-667）`minutes = clamp(1..480)`（`Math.min(...,8*60)`），空 reason 抛错（"an undated loan is never repaid"）；状态写 `.dsh/base/state/fast-mode.json`（version/reason/by/minutes/createdAt/until），自动过期（fastState :642-648 判 until）。
3. **SKIPPED+fastMode 戳**：runCheck（:60-62）`fastMode && def.allowFastSkip && !protectedCheck` → `status=SKIPPED, reason='fast-mode'`；runGate（:236-270）**无需 --fast 旗标**——窗口开着就生效；gate 记录含 `fastMode/fastReason/fastUntil/skippedByFastMode` 并入哈希链账本。全 SKIPPED → gate=BLOCKED（aggregate :226）。
4. **不能关任务/release + FAST_MODE_DEBT**：`completeTask`（:542-545）最新 gate 若 fastMode 且绑定当前 diff → blocker「a loan against evidence cannot close a task」；`riskScan`（context.mjs:228-236）`FAST_MODE_DEBT` **error** 级 decay 信号（skipped 清单点名）；`releaseReadiness` 的 `fast-mode-closed` 与 `fast-debt-repaid`（context.mjs:671-676）都是 blocking 条件。

**规模**：quality.mjs 56 行 + risk/release 消费点 3 处。

**移植成本**：**低-中**。zcode-base 已有 fast on/off/status（state.mjs:20-34），但差异明确：zcode 默认 24h、**无 8h 封顶、reason 可空、无 allowFastSkip 预标记体系、无 SKIPPED 留痕/DEBT 阻断 task 完成**。移植 = 补 minutes 封顶与 reason 必填（改 3 行）+ 在 gate 执行器加 allowFastSkip 分支 + task complete/release 加 DEBT 检查。zcode 的 gate 在 quality.mjs（反证门），需检查其是否已有 fast 分支——未见到，属新增。

**依赖**：gate 四态执行器（PASS/FAIL/BLOCKED/SKIPPED）；ledger（gate 记录留痕）；task 状态。

---

## 8. `spec-lint`（EARS）+ `trace`

**目的**：需求必须可判定（规范性关键词/触发词/度量/验收标准），且每个需求 id 被至少一个测试引用。

**实现摘要**（`lib/scan.mjs:296-374, 550-636`）：
- **specLint**：扫 requirementDirs（默认 docs/requirements）下 .md（跳过 TEMPLATE/CHANGELOG）。id 正则 `/\b((?:REQ|NFR)-[A-Z]{2,6}-\d{3,4})\b/`（:332）。对每个 id 的后 14 行块：`NOT_NORMATIVE` error（无 SHALL/MUST/必须/不得/应当）；REQ- 无 EARS 触发词（WHEN/WHILE/IF/WHERE/当/若）→ `NO_TRIGGER` warning；NFR- 无度量（`/\b\d+(\.\d+)?\s*(%|单位词)/`）→ `NO_METRIC` error；`AMBIGUOUS` warning（robust/scalable/尽快/合理 等 21 个中英模糊词）；`NO_ACCEPTANCE` error（无 Acceptance/验收/Given/Verification）；`PLACEHOLDER` error（TBD/TODO/待定）；`DUPLICATE_ID` error（跨文件重号）。全量级：五性（resilience/security/safety/privacy/reliability）任一在全部需求文本中未被提及 → `ATTRIBUTE_UNADDRESSED` error（:365-370）。无需求文件 → degraded（exit 3）。
- **trace**（:556-636）：id 集合扩展 `REQ|NFR|HAZ|THR`；遍历 tracked files（≤512KB、跳二进制扩展名），正则提取命中 id；按文件性质分流：ADR 目录→adrs、testGlobs（默认 `**/test/**` 等 6 模式）→tests、其余→code；`classifyPath` 归属 module。**悬空引用**：代码/测试中引用未声明 id → fail；纯文档中 → 单独报告不计败（:568-594 的 dangling vs danglingInDocs）。coverage = 有测试引用的需求占比，`minCoverage` 默认 1（100%）；`ok = coverage>=min && 无 code 侧 dangling`。孤儿需求（无实现无测试）单独列出。
- `specView`（context.mjs:538-609）按 impact 取「本变更触及的需求」渲染（预算 6000 字符，标题定位到声明处）。

**规模**：specLint 79 行 + trace 81 行 + specView 72 行。

**移植成本**：**中**。算法纯文本无宿主耦合；成本在文档体系对齐——zcode-base 用 `Product-Spec.md`（非 REQ-xxx id 制），引入 id 制意味着改 product-spec-builder skill 与模板。trace 依赖 catalog 的 trace 配置与测试目录约定。

**依赖**：specLint→无；trace→specLint（id 来源）+ classifyPath + trackedFiles；recap/specView 消费两者。

---

## 9. `release` + `dod`

**目的**：release 汇齐人类签字所需证据但**从不** tag/push/deploy（HIGH-tier 人类行为）；dod 是静态 DoD 聚合闸。

**实现摘要**：
- `releaseReadiness`（`lib/context.mjs:649-709`）：9 条件清单**硬编码在函数内**（无配置来源）：`dod-static`（内部聚合 catalog/skills/agents/spec/adr/attributes/arch/fitness 八项）、`trace-coverage`、`ledger-intact`、`receipt-fresh`（含 range receipt 支持）、`fast-mode-closed`、`fast-debt-repaid`、`review-backlog`（非阻断）、`decay-signals`（非阻断）、`sync-clean`。7 阻断 + 2 非阻断；blockers 空 → READY。输出 markdown 报告（`Tagging, pushing and deploying are HIGH-tier human acts. This command never performs them.`）。ready → exit 0，否则 exit 2。
- **为什么 never tags**：设计即如此——引擎只装配证据，决定权在人类（代码注释 :641-648 与 OPERATING-MODEL 第 9 相/release gate）。range receipt（`receipt write --base <tag>`，quality.mjs:358-401）专门服务发版：绑定 `base..HEAD` commit range，HEAD 未动即有效。
- `dod`（dsb.mjs:439-469）：DOD_STEPS 12 步静态聚合：catalog-lint / skills-lint / agents-lint / spec-lint / adr-check / attributes / arch-check / fitness(all) / trace / ledger / **risk（非阻断）** / **budget（非阻断）**；每步 try-catch（引擎错误→DEGRADED）；blocking 失败 → exit 2；提示「dod 只做静态治理，行为证明仍需 gate」。

**规模**：release 61 行 + dod 31 行。

**移植成本**：**低**。纯聚合；条件清单改为调 zbase 现有命令。zcode-base 有 release-builder skill（prompt 侧）但引擎无 release 命令——这是明确缺口。

**依赖**：几乎所有静态检查 + ledger/receipt/fast/backlog/sync——移植顺序上放最后。

---

## 10. `archive --apply`（progress.md 归档）

**目的**：活跃账本保持小而有界；历史只移动、永不删除、永不改写。

**实现摘要**（`lib/context.mjs:377-429`）：`archiveLedger(catalog, {apply})`：parseLedger 切段 → Done 保留最新 `keepDone`(40) 条、Notes 保留 `keepNotes`(30) 条（section 契约 = 最新在前，尾部即最旧）→ 超出部分 `plan`。`--apply` 时：archive 文件不存在则建头（`# Archived project memory` + append-only 声明）；追加 `## Archived <YYYY-MM-DD>` + `### Done/Notes` + 条目原文；活账本删除已移条目并在首处插入指针行 `- Older entries are in [progress.archive.md](...)`。无 `--apply` 只报 plan（dry-run 语义）。`ledgerHealth`（:352-370）给 bytes>24000 或 Done>40 的归档建议。`archive --changelog --apply`（archiveChangelog :614-640）：PRODUCT-SPEC-CHANGELOG.md 保留最新 10 个 `## ` 版本段，其余移 `.archive.md`。**触发是手动命令**（recap 的 health.advice 提示），无自动触发。

**规模**：53 行 + changelog 27 行。

**移植成本**：**低**。纯文件操作；zcode-base progress.md 同为 `## ` 段式即可直接用。

**依赖**：catalog.memory 配置；无其他。

---

## 11. `cochange`（共变度量）

**目的**：用 git 历史测模块边界画得对不对——总一起变的两个模块是被墙隔开的一个模块。

**实现摘要**（`lib/graph.mjs:483-606`）：`git log -n 500 --no-merges --name-only --pretty=format:@@@%H`（哨兵前缀解析 commit→paths）。每 commit：路径经 classifyPath 归属模块去重排序；触及模块数 0 跳过、**>maxModulesPerCommit(8) 视为 sweeping commit（发布/全仓重排）排除并计数**。累计：solo[m]（模块出现次数）与 pairs[a|b]（无序对共现次数）。`coupling = pairCount / min(soloA, soloB)`（:526-527）。findings：`coChanges >= minPairs(3) && coupling >= ratio(0.5)` 才报——有 dependsOn 声明 → warning `HIGH_COUPLING`（不能独立发布）；无声明 → error `BOUNDARY_SUSPECT`（边界错或图不全）；`catalog.cochange.accepted`（`[a, b, reason]` 数组）接受的对 → warning `ACCEPTED_COUPLING` 带理由。`analysed < minSample(30)` → `LOW_CONFIDENCE` warning（结果只是提示非度量）。`isolatedModules` = 从不与任何模块共变者 → 拆库最安全候选。advice 文案随 isolated 有无切换。

**规模**：124 行单函数。

**移植成本**：**低**。只依赖 git + classifyPath（zcode 已有 impact/classify 同源逻辑）。

**依赖**：catalog.modules + classifyPath；无写副作用。

---

## 12. 嵌套 AGENTS.md（module contracts）+ `agents-lint`

**目的**：高风险模块的目录级宪法（宿主自动加载）是最便宜的边界契约；lint 保证覆盖与结构。

**实现摘要**（`lib/scan.mjs:478-548`）：
- `moduleDirOf(glob)`（:489-498）：模块 paths 去通配段取实目录（`src/api/**` → `src/api`；文件形尾回退父目录）→ 候选契约 `<dir>/AGENTS.md`。
- `agentsLint(catalog)`：配置 `agentsMd.requireForRiskTiers` 默认 `['high','critical']`、`maxBytes` 12000。根 AGENTS.md：缺失且 `$DSH_HOME/AGENTS.md` 也无 → error `NO_ROOT_AGENTS`；仅全局有 → warning；有但超限 → warning `ROOT_AGENTS_LARGE`。模块级：`riskTier ∈ requireFor` 无任何候选文件 → **error `NO_MODULE_AGENTS`**（低风险 → warning）；存在则校验四段 `Purpose/Boundaries/Invariants/Verification`（正则 `/^#{1,4}\s*<name>/im`，:542）缺段 → warning `MODULE_AGENTS_INCOMPLETE`；超字节 → warning。
- catalog 里 risk tier 触发声明：`modules[].riskTier: 'low'|'medium'|'high'|'critical'`（RISK_TIERS core.mjs:41）；catalog-lint 校验合法值（graph.mjs:47-49）。riskTier 还驱动 `resolveVerification` 兜底（模块无显式 verification 时取 `riskChecks[tier]`，graph.mjs:226-232）。
- context-pack P2 段把受影响模块的 AGENTS.md 打进包（context.mjs:75-85）。

**规模**：71 行。

**移植成本**：**低**。ZCode 同样支持嵌套 AGENTS.md 注入；zcode-base 有 module-catalog，加 `riskTier` 字段 + 此 lint 即可。模板 `.dsh/templates/MODULE-AGENTS.md`（4.2KB 四段骨架）可对照。

**依赖**：catalog（modules/riskTier/agentsMd 配置）。

---

## 13. protected attributes（privacy 永不可豁免）

**目的**：三性（security/safety/**privacy**）不可豁免、不可快跳、不可降级——「结构上无可表达之例外」。

**实现摘要**（硬编码点全列）：
- `PROTECTED_ATTRIBUTES = new Set(['security','safety','privacy'])`（`lib/core.mjs:39`）+ `PROTECTED_CLASSES = new Set(['security','safety','privacy'])`（core.mjs:52，check 的 class 维度）。
- **waiver 拒绝**：`validateWaiver`（quality.mjs:142-155）——`WAIVER_FORBIDDEN_WORDS = /(safety|security|privacy|pii|secret|credential|destructive|deploy|production|push)/i` 匹配 reason+scope → error「never waivable」（:149-152），`waiver create` 直接拒绝（dsb.mjs:292）；`applyWaivers`（:158-174）双重拦截——命中 protected 属性或 protected class 的 check 结果**不参与豁免**（:165-167），豁免只能降 FAIL/BLOCKED 且改标 `waivedFrom`。
- **fast 拒绝**：runCheck（:59-62）protected check 无视 allowFastSkip；fastSkippable（:670-679）清单过滤；catalog-lint `PROTECTED_FAST_SKIP`（graph.mjs:97-99）把「protected check 声明 allowFastSkip」定为 catalog 错误。
- **backlog 拒绝**：`BACKLOG_FORBIDDEN = /(security|safety|privacy|pii|secret|credential)/i`（quality.mjs:1014）。
- invariants 法则 3 文案重申（context.mjs:508）。
- **zcode-base 现状**：`PROTECTED_ATTRS = ['security','safety']`（runtime/lib/quality.mjs:13、waivers.mjs:7）——**privacy 不在引擎 protected 集合内**，尽管宪法红线提及隐私。这是移植时的一行级差异但语义升级。

**移植成本**：**低**。改两个常量 + 核对三处消费点（fast 分支/waiver 校验/gate 聚合）。

**依赖**：无（词汇表常量）；被 gate/waiver/fast/backlog 消费。

---

## 14. install 一条龙

**目的**：单实现安装器 + 平台薄壳，幂等、永不静默覆盖他方定制。

**实现摘要**（`install.mjs` 304 行；setup.sh 17 行 / setup.ps1 40 行）：
- **分工**：全部逻辑在 install.mjs；setup.sh 只查 node 存在然后 `exec node install.mjs "$@"`；setup.ps1（PS 5.1 兼容、ASCII）把 `-DryRun/-Enable/-Hooks/-Verify` switch 翻译成 `--` 旗标转发。
- **复制面**：`MANAGED_ROOTS=['.dsh']` 一个目录；`EXCLUDE_PREFIX`（state/evidence/receipts/waivers 运行态）与 `EXCLUDE_EXACT`（catalog.json）不装；`SEEDS`：AGENTS.md（根对根）+ progress.md（**从模板 .dsh/templates/PROGRESS.md 种入**，非本仓账本）。
- **`--dry-run`**：全程跳写，报 would install。
- **managed 策略**：目标不存在→拷贝；内容一致（**LF 归一化哈希** hashLf，CRLF checkout 不误报）→unchanged；不一致→写 `<file>.dsh-base-new` 旁路文件**永不覆盖**，列入 `staged` 待人审。
- **`--enable`**：目标无 catalog.json 时从 catalog.example.json 种入。
- **`--hooks`**：`git config core.hooksPath .dsh/base/githooks` + chmod 755 + `git add --chmod=+x`（可执行位进 index）。
- **`--stage`**（被 `--verify` 在 git 仓内隐含）：`git add -A` —— **先 stage 再 verify**，否则 catalog-lint 度量 0 tracked paths = 什么都没证明（:199-205 注释）。
- **`--verify`**：子进程跑 doctor（取 enabled/skills/failing）/selftest/skills-lint/catalog-lint（取 trackedPaths/unmapped，0 tracked → warning），selftest/skills-lint 失败 → errors。
- **`--targets-from FILE`**：每行一个目标（空行/# 忽略）批量装；单目标失败不中断批次。**`--json`**：仅 stdout 一行机器可读结果。exit 0/1/2（usage 或 fatal）。
- 自装保护：拒绝 `SRC === dst`（install into itself）；非 git 仓或目标在别的仓内 → warnings。

**规模**：install.mjs 304 行 + 两壳 57 行。

**移植成本**：**低-中**。zcode-base 已有 install（含用户级 hooks 注册到 `~/.zcode/cli/config.json`），dsh 模式可借鉴三点：`.dsh-base-new` 旁路永不覆盖、LF 归一化比较、`--verify` 先 stage 再测。ZCode 侧还需叠加「hooks 注册进用户 config」这步 dsh 没有的逻辑（zcode 已有）。

**依赖**：engine 可独立运行（install.mjs 不 import lib，全部自含）。

---

## 15. exit code 契约（0/1/2/3/4）

**目的**：全引擎统一五值退出码，degraded（3）绝不假装绿，stale（4）区分「证据失效」。

**实现摘要**：`EXIT = Object.freeze({OK:0, VIOLATION:1, GATE:2, DEGRADED:3, STALE:4})`（`lib/core.mjs:44-50`，注释即契约）。实现方式：
- `emit(payload, code)`（core.mjs:420-423）：stdout 恰一行 JSON、返回 code；`note()` 人类诊断走 stderr——输出通道分离是契约的一半。
- `degraded(command, reason)` 助手统一 exit 3（core.mjs:433-435）；`needCatalog`/`needGit` 守卫（dsb.mjs:62-79）在命令入口统一判 degraded。
- main 兜底：任何异常 → `engine-error` exit 3（dsb.mjs:989-895），**引擎崩溃也不会假绿**。
- exit 4 的两个来源：`receipt verify` 无新鲜回执（dsb.mjs:268）与 review 会话 stale（:829/:844/:860）。
- git hooks 把 exit 3 显式翻译为「gap 非 pass」文案（pre-commit run() :30-32）。
- 测试锁契约：tests/engine-contract.test.mjs（87 行）。

**移植成本**：**低**。zcode-base 宪法已声明同契约（0/1/2/3/4），核对 zbase.mjs 各 case 是否补齐 exit 4 语义即可（zcode 有 receipt verify，应已有）。

**依赖**：无——是所有命令的地基。

---

## 16. tests/ 组织方式

**目的**：行为级测试驱动 CLI 子进程，零依赖跨 Node 20/22/24 与 Windows。

**实现摘要**：
- **16 个文件** = 15 个 `*.test.mjs` + `helpers.mjs`。按机制分组：`engine-contract`(exit 码契约)、`evidence`(账本/回执)、`review` / `review-stages` / `review-team`(审查三面)、`range-receipt`(range 回执)、`fast`、`memory`(recap/archive/sync)、`derived`(派生类：spec-view 等)、`discover`(catalog 发现)、`architecture`(arch/trend/cochange)、`release`、`fleet`、`installer`、`audit-scripts`(audit/ 四脚本)。
- **helpers.mjs**（42 行）提供：`dsb(args, opts)` spawn `dsb.mjs` 子进程返回 `{code, json, stdout, stderr}`（json = stdout 最后一行解析，设 `DSB_ROOT`）；`script(name, args)` 同型跑 audit/ 脚本；`tempDir(label)` 在 **os.tmpdir() 建一次性目录**（绝不污染宿主树）；`rmDir`。
- **怎么跑**：`npm test` → `node .dsh/base/audit/run-tests.mjs`（32 行 launcher）——Node 20 的 `--test` 不展开 glob，launcher 用 readdir 自己展开 `tests/*.test.mjs` 再 `spawn(process.execPath, ['--test', ...files])`，20/22/24 行为一致；无测试文件 → exit 3（nothing proved）。

**移植成本**：**低**。模式可直接套用；zcode-base 已有 tests/ 目录，补 helpers 的 spawn+tmpdir 模式与 launcher 即可。

**依赖**：node --test 内建 runner；无框架。

---

## 17. `.github/` + `cordis.patch.yml`

**目的**：CI 是第二执法缝（推已过 pre-push 还有 PR）；cordis.patch.yml 是宿主 profile 配置缝的文档化样例。

**实现摘要**：
- **`.github/workflows/gate.yml`**（1 个 workflow）：矩阵 `ubuntu-latest × windows-latest` × `node 22/24`（4 格，fail-fast:false）；fetch-depth:0；步骤序：**selftest（引擎先自证才有资格判仓）** → check-syntax → scan-secrets → manifest --check（完整性清单）→ run-tests（单测）→ dod（静态 DoD）→ `arch-trend --gate`（漂移棘轮）→ risk（`continue-on-error: true` advisory）→ doctor（`if: always()` 诊断）。
- **`cordis.patch.yml`**（.dsh/base/，1.6KB）：**不被自动读取**的注释样例，文档化 DSH 宿主 profile 补丁缝（`dsh --profile <n> --patch`）：agent-instructions maxBytes 提额（65536→131072，多嵌套 AGENTS.md 场景）、tool-result-pruner 阈值、tool-ralph maxRounds 32。全部条目注释掉——「文档化接缝，不静默改部署」。对 ZCode 无直接对应物（ZCode 配置在用户级 config.json）。

**移植成本**：**低**。gate.yml 改命令路径即成 zcode 的 CI；矩阵+「selftest 先行+doctor always」结构原样值得抄。cordis.patch.yml 无需移植（ZCode 无 profile 补丁机制）。

**依赖**：引擎各命令 + audit 脚本 + manifest.mjs（完整性清单，zcode 已有 `manifest` case）。

---

## 18. 八属性六档 + attributeReasons

**目的**：ISO/IEC 25010 对齐的属性词汇表 + 六档执法强度；降档到 minimal/none 必须留书面理由。

**实现摘要**：
- **词汇表**（`lib/core.mjs:15-24`）：`ATTRIBUTES = [security, safety, privacy, resilience, reliability, availability, performance, maintainability]`——比 zcode-base 多 availability/performance/maintainability 三属性。
- **六档**（core.mjs:27）：`TIERS = [critical, high, medium, low, minimal, none]`——比 zcode 五档多 `minimal`；`BLOCKING_TIERS = {critical, high}`（:30）；`REASON_REQUIRED_TIERS = {minimal, none}`（:33）。
- **catalog schema 形态**（catalog.json 实例）：`modules[].attributes: {"security": "critical", ...}`（8 属性名→档位字符串）；`modules[].attributeReasons: {"<attr>": "<书面理由>"}`（实例中空对象占位，:394）。
- **引擎校验**（lintCatalog graph.mjs:57-64）：未知属性名 → `UNKNOWN_ATTRIBUTE` error；未知档位 → `UNKNOWN_TIER` error；**tier ∈ {minimal, none} 且无对应 attributeReasons → `UNJUSTIFIED_TIER` error**（「opting out of governance must be a recorded decision」）。check 侧 attributes 数组也校验（:94-96）。
- 消费方：assessAttributes（反证覆盖门）、attributeAudit（接线审计）、review lens 裁剪（TIER_RANK ≥ low）、fitness 规则 minimumTier、riskScan UNWIRED_ATTRIBUTE。

**移植成本**：**中**。zcode 是五属性五档——扩成八属性六档 = 改词汇常量 + catalog schema 文档 + 所有遍历点（quality/fitness/catalog 三处 ATTRS 常量）+ 已有 catalog 数据迁移。机械但触点多。

**依赖**：核心词汇表，被 gate/review/fitness/risk/attributes 五处消费——先改它再改消费方。

---

## 19. 四份 docs 核心摘要

| 文件 | 解决什么问题 | 核心内容 |
|---|---|---|
| `.dsh/docs/OPERATING-MODEL.md`（12.6KB） | 「工作到底怎么流」——agent 与人各在何时签字 | 九阶段循环（Frame→Specify→Design→Plan→Implement→Verify→Review→Record→Release，每段有入口条件/产物/exit 门/签字人）+ 四签字闸（spec/design/phase/release，phase 闸由 diffHash 机器绑定）+ 证据五步 + 三审批档（LOW/MEDIUM/HIGH，HIGH=push/tag/deploy/密钥/迁移/依赖/waive/改 catalog 风险字段）+ 13 角色表（角色=skill）+ 10 条停止条件 + 回合输出契约（Phase/Gate/Artifact/Tier/Next） |
| `.dsh/docs/CAPABILITY-MATRIX.md`（15KB） | 六个同族脚手架的吸收/拒绝台账——每个能力要么有执法机制要么记录为何不做 | 52 行能力表：Absorbed/Adapted/Rejected 三判定 + 理由列；关键拒绝：宿主 hooks（DSH 无 hook 系统→执法移 git/CI）、markdown 子代理定义（角色=skill）、输出样式、dev-service 监督器；末尾 4 条未来提案规则（必须命名执法机制/命名能拦的事故/优先扩现有检查/宿主能力不存在即拒） |
| `.dsh/docs/ADOPTION.md`（10.4KB） | 「怎么装进已有仓」——三种起点一种引擎 | A0 批量安装（install.mjs 旗标 + 逐属性表）+ A 全新项目 / B 绿地(<50k 行) / C 百万行棕地十步序（先装不启用→30-150 业务域模块→catalog-lint 至 unmapped=0→arch-check --record 冻结存量债→棘轮进 CI→先给高危模块声明属性→每阻断属性接一个认领检查→高危模块嵌套 AGENTS.md→开 hooks/CI→才开始用循环）+ day/week/month 表 + 「40k unmapped 怎么办」（禁 catch-all、按顶层目录分桶迭代） |
| `.dsh/docs/ADR-CONTRACT.md`（886B） | ADR 文件契约——决策必须指向真实执法点 | `ADR-<NNNN>-<slug>.md`，号码 append-only；Status 非 retired 必须有 `Enforced-by:` 行，解析为四类之一（catalog check id / fitness 规则 id / 引擎能力 / `manual:<谁>`）；phantom 引用比没有更糟 |

**移植成本**：**低**（文档随机制走，机制移植后改宿主名与路径）。

---

## 20. `docs/research/ai-coding-agents-state-of-practice-2026.md` 关键结论

**性质**：搜索结果三角化的 state-of-practice 简报（作者自注：无全文抓取，数字均为「来源报告值」）。九节 + TOP10。对引擎设计有直接支撑的实证数据：

1. **审查循环是全场唯一大量化收益**：SWE-Review（arXiv 2607.06065）agentic review loop 把 Qwen3-30B 在 SWE-bench Verified 从 **27.5%→56.9%**，token 效率是独立重采样的 **6.5×**；Adversarial Review（arXiv 2608.18167）**3 个结构化分歧 agent 胜过 5 个共识 agent**——这组数字直接写在 quality.mjs 审查体系的设计注释里（:680-691）。
2. **未执法规则不仅无效且有害**：Guardrails Beat Guidance（arXiv 2604.11088）——规则会「扭曲」行为；克制型规则（"never X"）在压力下降解最快，需外部执法；规则数有合规天花板（加规则可能降低既有规则合规）——rulesAudit 的直接依据。
3. **AGENTS.md 长文件零收益**：两项独立研究（arXiv 2602.11988、2607.27250）发现上下文文件无可靠改进；建议 = 目录索引化 + 硬 token 预算 + 按触加载（嵌套 AGENTS.md 机制的依据）。
4. **compaction 不修正漂移**：ContextEcho（arXiv 2605.24279，23 模型）+ Compaction Cliff（arXiv 2608.22752，质量是悬崖非缓坡）——invariants 命令的直接依据（:484-494 注释原文引用）。
5. **指令文件是活跃攻击面**：Mitiga 发现指令文件内 **1,230+ 泄漏 API key** 与攻击者控制的 `ANTHROPIC_BASE_URL` 覆写；CSA 记录 README/injection 劫持——scan-instructions.mjs 头注释原文引用（:2-10）。
6. **指令文件攻击/上下文劣化由干扰物驱动**（Chroma 18 模型实测）——context-pack 预算+deny-list 依据。
7. 其他：组织级数据显示 AI PR 合并率约人类一半、METR RCT 资深开发者 **-19%** 速度（「审查已成瓶颈」）；SWE-bench 污染（2506.12286）；co-change 分析有学术基础（IEEE TSE 2011 doi:10.1109/TSE.2011.91）且在大重构上有已知假阳性模式。
8. **结尾自评**：治理处方（fitness function/ADR/漂移检测/SDD）几乎全部**未被度量**——被严格度量过的杠杆只有审查循环、上下文长度效应、compaction 失败、上下文文件零收益四项；scaffold 应假设自己的治理层未经验证并自我插桩（gate-audit 的存在理由）。

**移植成本**：**零**（纯文档，引用时可整体搬）。

---

## 21. dsb.mjs 主入口结构 + lib/ 划分

**目的/事实**：单文件 CLI 路由 + 七模块库。

**实现摘要**：
- **路由方式**：`COMMANDS` 普通对象（键=子命令名，含 `catalog-lint` 等带连字符键），`parseArgs`（dsb.mjs:41-56）支持 `--flag value`/`--flag=value`/布尔三形 + positional；`main()` 取 `positional[0]` 查表，未知命令 exit 3，`try/catch` 包裹（engine-error → exit 3）；`COMMANDS.verify = COMMANDS.gate` 别名（:138）。子子命令（task/review/waiver/receipt/fleet/catalog/fast）再读 `positional[1]`。**异步 stdin**：`receipt write`/`task start`/`review blue|lens`/`backlog add`/`waiver create` 走 `readStdin()`（:967-976，TTY 时空串）收 JSON。
- **命令面 40 个**：doctor/selftest/catalog-lint/catalog/impact/gate(=verify)/attributes/arch-check/arch-trend/fitness/adr-check/spec-lint/trace/skills-lint/agents-lint/budget/context-pack/receipt/waiver/task/ledger/gate-audit/risk/retention/diff-hash/review-pack/dod/sync-check/recap/archive/init/cochange/fleet/fast/rules-audit/invariants/review/spec/release/help。
- **lib/ 七模块行数与职责**：

| 模块 | 行数 | 职责 |
|---|---|---|
| core.mjs | 445 | 词汇表（8 属性/6 档/protected/EXIT）、repo 发现、DSB_BASE/DSH_HOME、原子写、sha256(LF)、glob 编译、git 访问（trackedFiles/changedPaths/canonicalDiff/diffHash/EMPTY_DIFF_HASH）、catalog 加载与 classifyPath、emit/note 输出契约 |
| graph.mjs | 946 | catalog-lint（含 attributeReasons 校验）、computeImpact 反向闭包、import 提取（11 语言族）、archCheck（禁边/层级/漂移/未用声明）、trend 棘轮、coChange、discoverCatalog+proposeAttributes+detectCommands |
| quality.mjs | 1048 | runCheck 四态、buildPlan、waiver、assessAttributes 反证、runGate 聚合、哈希链账本+gateLog+gateAudit、receipt（含 range）、assessBudget、task 信封、syncCheck、fast、review 全链、backlog |
| scan.mjs | 735 | fitness 九规则、adrCheck（phantom 检测）、specLint（EARS）、skillsLint、agentsLint、trace、rulesAudit |
| context.mjs | 709 | contextPack（P1-P5+deny list）、doctor、retention、riskScan、attributeAudit、memory（recap/invariants/ledgerHealth/archiveLedger/archiveChangelog）、specView、releaseReadiness |
| fleet.mjs | 341 | fleet.json 多仓清单：findFleet（祖先查找）、lint、impact（合同影响面/协调成本）、status（--deep 含各仓 dod/sync）、recap |
| selftest.mjs | 581 | 86 断言内建回归（纯函数+合成 fixture，<1 秒，不依赖宿主仓内容）——「引擎先自证才有资格判仓」 |

- 依赖方向被 catalog 的 forbiddenDependencies 硬约束（core←graph←quality←scan←context←selftest/cli，catalog.json :240-496）。

**移植成本**：结构参照成本 **零**（照抄架构即可）；zcode-base 是 306 行路由 + 19 小模块（平均 91 行），若吸收 dsh 机制建议按 dsh 的模块界重组或渐进合并。

---

## 22. package.json / CHANGELOG / LICENSE / .gitattributes / .editorconfig

**事实**：
- **package.json**：`name: dsh-base`，`private: true`，`type: module`，`license: MIT`，`engines.node >= 20`，**dependencies/devDependencies 全空**（零依赖是 ADR-0001）。17 个 scripts：doctor/selftest/test/dod/gate/impact/arch:check/arch:record/arch:gate/fitness/trace/risk/syntax/secrets/manifest:write/manifest:check/hooks:install。
- **CHANGELOG.md**（2.3KB）：仅 1.0.0 一节，16 条特性自述（含「40 子命令、五值退出码、九 lens 三 stage、86 自测断言 + 123 行为测试」等数字，可作能力清单速查）。
- **LICENSE**：标准 **MIT**（Copyright 2025 dsh-base contributors）。
- **.gitattributes**：`* text=auto eol=lf` 全仓 LF；*.ps1/*.cmd/*.bat CRLF；png/jpg/gif/pdf/zip binary——与 install 的 LF 归一化哈希配套。
- **.editorconfig**：utf-8 / lf / final-newline / 去尾空格 / 2 空格缩进；`[*.md] trim_trailing_whitespace = false`（markdown 换行语义）；`[*.ps1] crlf`。

**移植成本**：**零**（约定俗成，zcode-base 已有同类）。

---

## zcode-base 已有等价物对照表

| dsh 机制 | zcode-base 现状 | 差异一句话 |
|---|---|---|
| recap / invariants | 无（SessionStart hook 注入 progress 尾部） | dsh 是预算化派生摘要+漂移对抗，zcode 是原文注入；recap 有字符预算与截断标记 |
| sync-check + 3 git hooks | 无 sync-check；hooks 在 ZCode 用户级（7 事件），无 git hooks | 「三文件同步铁律」zcode 只有宪法条文无机器执法；git hooks 对 ZCode 用户完全可加 |
| review 全链（session.json/蓝/lens/verdict/stage/rounds/backlog） | red-blue-review skill（纯 prompt 协议） | dsh 把协议下沉引擎：diffHash 绑定、exit 4 stale、stage 门、lens 组队全机器判 |
| review-pack | 无专用命令 | 删除审计段+800 行溢写是独有细节 |
| budget | 无 | 38 行新函数 |
| rules-audit + scan-instructions | 无 rules-audit；无指令文件扫描 | zcode 宪法规则密度高但无执法点审计；指令文件攻击面 ZCode 同样存在 |
| skills-lint | skill-builder skill（prompt 约范） | dsh 是机器 lint（frontmatter/命名/长度/重复）；ZCode 规范阈值需重标定 |
| fast 四条件 | fast on/off/status 已有（state.mjs） | zcode：默认 24h、无上限、reason 可空、无 allowFastSkip 体系、无 DEBT 阻断 task/release |
| spec-lint(EARS) + trace | 无引擎命令（Product-Spec.md 无 id 制） | 引入需换需求文档范式（REQ-/NFR- id 制） |
| release + dod | release-builder skill（prompt）；无 dod | dsh release 9 条件聚合且 never tags；dod 12 步静态闸 |
| archive --apply | 无（progress.md 无界增长） | 53 行；append-only 归档+指针 |
| cochange | 无 | 124 行；git 历史耦合度量 |
| 嵌套 AGENTS.md + agents-lint | 无嵌套契约；module-catalog 无 riskTier 字段 | ZCode 宿主同样自动加载嵌套 AGENTS.md，机制直接适用 |
| protected attributes（含 privacy） | PROTECTED_ATTRS=[security, safety]（quality.mjs:13/waivers.mjs:7） | **privacy 不在 zcode 引擎 protected 集**——一行改动但语义升级 |
| install（--dry-run/--enable/--hooks/--stage/--verify/--targets-from/--json） | install 已有（含用户级 hooks 注册） | dsh 增量：`.dsh-base-new` 旁路不覆盖、LF 归一化比较、verify 先 stage 再测、批量 targets-from |
| exit code 0/1/2/3/4 | 宪法已声明同契约 | 核对 exit 4 是否全部落到位（receipt verify 已有） |
| 八属性六档 + attributeReasons | 五属性五档（catalog.mjs/quality.mjs/fitness.mjs 三处 ATTRS） | +availability/performance/maintainability、+minimal 档、+降档理由强制 |
| fleet（多仓合同层） | 无 | 独立模块 341 行，zcode 无多仓场景可缓 |
| dod / doctor / selftest / gate / quality / receipt / waiver / ledger / gate-audit / retention / risk / impact / context-pack / arch-check/trend / adr-check / fitness / catalog-lint / manifest | 均已有对应 case（zbase.mjs 19 case + 子命令） | 语义大体同源（同族脚手架），细节以各自实现为准 |
| gate 的 SKIPPED 态 + allowFastSkip | quality.mjs 已有 SKIPPED 态（lib/quality.mjs:99 `waivedSkip`，仅豁免驱动） | zcode 的 SKIPPED 只由有效豁免产生；dsh 另有 allowFastSkip 预标记 + fast 窗口驱动，且全 SKIPPED → gate=BLOCKED |

---

## 附：移植顺序约束（事实性依赖，非优先级建议）

1. **地基层**（无依赖）：EXIT 契约核对、PROTECTED_ATTRIBUTES 扩 privacy、八属性六档词汇表。
2. **单函数层**：budget、archive、cochange、sync-check、agents-lint、skills-lint、scan-instructions。
3. **组合层**：recap/invariants（依赖 task/fast/ledger/risk）、rules-audit（依赖最终命令面定稿，否则 PHANTOM）、fast 四条件（依赖 gate SKIPPED 态）。
4. **体系层**：spec-lint+trace（依赖需求 id 制落地）→ review 全链（依赖 diffHash+receipt）→ dod/release（依赖上述全部）。
5. git hooks + CI workflow 在 2 之后任意时点可接（ZCode 宿主 hooks 与 git hooks 并行不悖）。
