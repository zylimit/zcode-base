# cc-base 增量机制报告（相对「dsh 已覆盖基线 + zcode v2.0 计划」的净增量）

> researcher 产出 · 2026-09-01。研究对象 `/home/z00632348/code/cc-base`（只读，未改动该仓任何文件）。
> 基线 = `.zbase/research/dsh-base-mechanisms.md` 全部 22 项机制 + zcode-base v2.0 计划（progress.md 2026-09-01 两条决策 + DEV-PLAN Phase 6-8 + v2.0 三缝执法/自我插桩/C/LICENSE 等工程配套）。
> 本文只列**基线没有的**机制。已覆盖项见文末对照表，不展开。
> 所有「文件:行号」相对 cc-base 仓库根。cc-base 规模：harness.mjs 3033 行 + 14 对 hook（.sh+.ps1 双写，sh 侧约 660 行）+ scripts 8 件约 1000 行 + tests 约 2400 行。
> 注：研究期间 zcode-base 正在 R1 结构迁移（runtime/ → .zcode/lib+harness），hooks 事件面未变（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop 七事件，无 SubagentStop/SessionEnd），本报告以迁移后路径为准。

---

## A. 会话级 hook 闸门组（最大增量面）

dsh 无 hook 宿主（执法全移 git/CI），zcode 有 hook 宿主但当前只有「危险命令/秘密读写/受保护路径/Stop 回执门」四类护栏。cc-base 注册了 14 个会话内闸门（`.claude/settings.json:5-125`），其中以下 8 个是基线外净增量。共同工程细节：全部走 `lib-fast-mode.sh` 总闸前导（fast 开启静默放行、库缺失 fail-closed，:1-24）；block 闸统一经 `lib-gate-log.sh:1-17` 写 `.claude/evidence/gate-block.log` 拦截台账（zcode 已有 logGate，等价）；sh 侧 `set -E + trap ERR` fail-closed（stop-gate.sh:17-23）。

### A1. no-direct-code-guard（主 Agent 不许直接写业务码）

- **目的**：把宪法「主 Agent 不亲手编码」从纪律变成 PreToolUse(Edit|Write) 硬拦截。
- **实现**：`hooks/no-direct-code-guard.sh`（29 行）。框架文件正则放行（`.claude/|CLAUDE.md|Product-Spec|DEV-PLAN|progress.md|*.md|*.json|*.sh` 等，:15-17）→ 业务源码路径（`(^|/)(src|app|lib|components|pages|api|server|client|utils|models|services)/`）命中即 exit 2 + gate_log（:20-27）。
- **规模**：29 行。
- **移植成本**：**低**（zcode PreToolUse 已有 Edit/Write 分支，加一个路径分类器即可；宪法纪律 3「主 Agent 唯一编排」目前零执法）。
- **价值**：中高——但有一个必须先实测的宿主前提：**ZCode 用户级 hooks 是否会对子代理（Agent 工具内）的工具调用触发**。若触发，implementer 子代理写 `src/` 会被同一条规则拦死，需按会话角色放行或改为「警告+台账不阻断」。cc-base 在 Claude Code 上默认只拦主会话工具调用，未处理该歧义。

### A2. three-file-sync-gate 挂 Stop 事件（会话结束即执法三文件同步）

- **目的**：代码/家底改了但 progress.md 未同步、或 Spec 与 CHANGELOG 未成对更新 → **会话结束（Stop）即拦停**，不等 commit。
- **实现**：`hooks/three-file-sync-gate.sh`（124 行）。`git status --porcelain -z -- .` NUL 解析（rename/copy 双段处理 :83-91）→ `classify_path` 归类（三文档命中 / 代码后缀 / `.claude/` 家底；排除 evidence/node_modules/out/dist :44-64）→ C1 代码脏而 progress 不脏（:96-99）、C2 Spec/CHANGELOG 单边（只在两份都存在时校验，缺一不强造 :102-111）→ block。子目录场景剥 `show-prefix` 前缀（:68-77）。
- **规模**：124 行。
- **移植成本**：**低**。dsh sync-check（zcode Phase 6.4 已计划）执法缝在 **git pre-commit**；本闸在同一判定逻辑上把缝前移到 **Stop 事件**——zcode 两个缝可以共用一个 lib 函数。
- **价值**：中高。zcode 现有 Stop 门只查回执不查记忆同步；「会话结束前拦」比「commit 前拦」更早暴露欠账。**注意 cc 记录的已知交互坑**：Stop 闸与异步 progress-recorder 存在瞬时死锁窗口（recorder 还没写完 progress 时闸会拦，靠 recorder 完成后自然放行；progress.md:71）——移植时考虑给「记录进行中」留豁免标志。

### A3. tdd-gate（red-locks 前置提醒 + marker 文件链）

- **目的**：派 implementer 做 GREEN 实现前若没有 RED 证据，注入 TDD 提醒（建议性，不硬拦）。
- **实现**：`hooks/tdd-gate.sh`（28 行）。PreToolUse(Bash) 命令含 `implementer|dev-builder|GREEN|编码实现` 且项目根无 `.claude/.red-verified`（tester 验红后 touch）也无 `.claude/.tdd-exempt`（显式豁免声明）→ stderr 提示两份操作指引（:18-26）。
- **规模**：28 行。
- **移植成本**：**低**（zcode 有 red-locks 纪律无 marker 链；两个空文件即状态机）。
- **价值**：中。把「先红后绿」从 skill 文本变成可观测状态标记链，且豁免必须显式留痕（`.tdd-exempt` 本身就是记录）。

### A4. recap-on-dirty（SessionStart 脏树校准提醒）

- **目的**：上个 session 中断/压缩后 progress.md 未必反映真实状态——SessionStart 时工作树非干净即注入「先 /recap 对照实际改动校准」提醒。
- **实现**：`hooks/recap-on-dirty.sh`（24 行）。`git status --porcelain | wc -l` > 0 → additionalContext 注入（:18-23）。
- **规模**：24 行。
- **移植成本**：**极低**（zcode sessionStart 注入函数里加一个 dirty 计数分支）。
- **价值**：中。zcode Phase 6.6 已计划 recap 注入 SessionStart；本闸补的是「注入内容应感知工作树脏净」这半步，与 recap 正好互补（cc 的动机注释即「PreCompact 不可注入、压缩后无新 SessionStart，用跨 session 脏树提醒覆盖状态漂移」，progress.md:11）。

### A5. check-evolution（SessionStart 播报待毕业 feedback 数）

- **目的**：feedback 积压不靠自觉发现——每次会话开始数一遍 FEEDBACK-INDEX 里未毕业条目，>0 提示派 evolution-runner。
- **实现**：`hooks/check-evolution.sh`（27 行）。`grep -c "^- \["` vs 带 `✅[已毕业]` 前缀的总数（:16-25）。
- **规模**：27 行。
- **移植成本**：**极低**（zcode 有 .agents/feedback/ + INDEX，同一计数逻辑）。
- **价值**：低-中。防进化引擎饿死（feedback 只进不出）。

### A6. subagent-acceptance-reminder（SubagentStop 注入验收提醒）

- **目的**：执行类子代理（implementer/code-reviewer/tester/deployer）返回瞬间，向主 Agent 注入「勿信自报、核客观证据（编译输出/运行器输出/部署三件套）」提醒——机制化回执信封的验收侧。
- **实现**：`hooks/subagent-acceptance-reminder.sh`（33 行）。matcher 限四执行角色；**重复触发去重**：同一完成事件可能重复触发（stop 闸拦回再停一次），按 agent_id（缺失则 session_id+type+transcript_path 哈希）记 `.claude/.subagent-reminded`（保留最近 50 条，:20-28）。
- **规模**：33 行。
- **移植成本**：**中**——**宿主前提未证实**：ZCode 是否支持 SubagentStop（或等价）事件。zbase hooks.mjs 现无此 case；若 ZCode 无此事件则不可移植。
- **价值**：低-中（zcode 回执信封 + Stop 回执门已承担大半语义；这是提醒层加固）。

### A7. pre-commit-check 的「按栈编译门」半段（PreToolUse 缝）

- **目的**：`git commit` 前只对 **staged 涉及的栈** 跑编译/语法门：TS→`tsc --noEmit`（探测 ≤3 层深 tsconfig，:28-39）、Python→`ruff check` 降级 `py_compile`（:41-59）；工具缺失降级跳过绝不卡死 commit。另一段（harness verify rc=2 阻断，:61-74）与 dsh pre-commit git hook + zcode 四态门同义，已覆盖。
- **规模**：82 行中约 35 行是净增量（栈编译段）。
- **移植成本**：**低**（zcode 计划中的 git pre-commit 可直接并入此段；PreToolUse(Bash) 自判 `git commit` 的触发方式——「matcher 失效就脚本内自判」本身是个可抄的稳健性细节，:14-17）。
- **价值**：中。dsh/zcode 的 pre-commit 面都是治理检查，无「提交物可编译」这一层；这是最廉价的防假绿。

### A8. stop-gate 连拦计数的「清单指纹」改进（对 zcode 现有机制的精化）

- **目的**：Stop 门连拦上限防死锁，但**只应对同一待审清单计数**——清单一变即清零重计，否则新欠账会被旧计数误放行。
- **实现**：`hooks/stop-gate.sh:59-82`。清单 `sort | cksum` 成指纹写 `.stop-gate-strikes`（`sig=/count=` 两行自描述，损坏当无状态重建）；同指纹连拦 ≥3 → 第 4 次放行 + systemMessage 醒目保留欠账提示；正常放行或清单变化即清零。
- **规模**：约 25 行。
- **移植成本**：**极低**。zcode `bumpStopCount(2)`（hooks.mjs stop()）无指纹——纯计数，变更集变了续命计数不清零。
- **价值**：低-中。一行语义修正：把「连续拦截次数」定义到「同一证据状态」上。

**同组内判定为不值得/已覆盖、不单列的**：`mark-review-needed` + `.needs-review` 按文件登记（56 行，flock 串行 :46-54、顶层锚定豁免 :35-43）——功能被 zcode「changedPaths+fingerprint+receipts」Stop 门覆盖，另建平行清单属双真相源（cc 自己在 research/harness-v2-cross-pollination.md 以同理由拒 cursor quality ledger）；`session-rules-banner`（zcode sessionStart 注入已同义）；`detect-feedback-signal`（zcode 已有）；`auto-push`（28 行：commit 后 ahead>0 自动 push，:21-27——**不建议移植**，与 dsh/zcode「push 是 HIGH 档人类行为」哲学正面冲突；其「PostToolUse 输出 schema 跨版本不稳，别解析退出码、改用 git 状态判断」的实现教训值得留档）；`kill-dev-ports`（20 行运维便利，端口清单写死，非治理面）；`dangerous-pkill-guard`（25 行——zcode 危险命令模式已覆盖该类，增量仅「锚定命令执行位置 `(^|;|&&|\|\||`|\$\()\s*pkill` 防 echo/grep 字符串误伤」的正则细节）。

---

## B. adapters——外部安全/质量工具按属性接线表

- **目的**：五性证据门的「真工具」供给层：harness 不捆绑不安装任何工具，只维护一张「工具 → 认领属性 → 命令模板 → 安装指引 → 诚实边界说明」的精选表；一条命令把工具接进 catalog.checks。
- **实现**：harness.mjs S14（:2662-2721）+ `harness/adapters.json`（105 行，11 工具）。`adapters list [--attribute x]`：报每个工具 `available`（PATH 探测 `whichCmd`）+ `wired`（catalog.checks 是否已接，:2685-2696）；`adapters add <id> [--dry-run]`：把 command/class/attributes 写进 catalog.checks 并回 `nextStep` 提示「模块 verification 引用它才会被选中——接线只是半步」（:2697-2718）。表内容：semgrep/osv-scanner/trivy/gitleaks/syft/presidio/stryker/schemathesis/k6/checkov/oslo，每条带 rationale（含诚实边界，如 presidio「它自己文档就说找不全，当一层不当边界」）；`class:runtime` 的 k6 结果按时间窗理解、不算工作树证据（rules/quality-attributes.md adapters 节）。
- **规模**：引擎约 60 行 + 数据表 105 行。
- **移植成本**：**低**。zcode 已有 `whichCmd`/runCheck/verifyPlan 全部下游设施与 catalog.checks schema——缺的只是这张表和两个子命令。
- **价值**：**高**。dsh 吸收清单里五性证据门只有 fitness 文本启发式；没有 adapters，zcode 的 security/privacy 属性证据永远只有「自家正则」一个来源。这是把八属性六档从词汇表变成真执法的最短路径。

---

## C. supervisor.mjs——开发态进程守护

- **目的**：长驻开发服务（dev server/worker）的宕机自愈：崩溃自动拉起（指数退避封顶 30s）、「活着但不服务」由健康探针连败 3 次杀掉重拉、重启风暴熔断 fail-visible 停手。
- **实现**：`scripts/supervisor.mjs`（365 行，零依赖）。守护进程 detached 自 spawn（:258-262）；`__run` 循环：stop.flag 轮询停机（跨平台无信号戏法，:208-211）、HTTP(S) 探针 2xx-3xx 判活（:110-120）、连败 3 次 killTree 重拉（:213-229）；重启窗口计数超限 → 置 `crashed` 并退出（「故障不是瞬时的就该人来看」，:186-200）；进程组 kill（POSIX 负 pid / win taskkill /T，:95-108）；status 以 **pid 实活性**为准不信上次落盘状态（:302-324）；start 确认 5s 内 liftoff 才报成功（「started with a dead pid is a false green」，:263-274）；日志 5MB 单代轮转。
- **规模**：365 行 + test-supervisor.sh 87 行（kill -9 拉起/熔断/stop 收敛实证）。
- **移植成本**：**低**（自包含单文件，无宿主耦合，可直接并入 `.zcode/scripts/`）。
- **价值**：**场景决定**——dsh 曾明确拒绝 dev-service 监督器（CAPABILITY-MATRIX，因 DSH 无此场景）；zcode 若用户常跑长驻 dev server（Web 项目线）则是 resilience 五性在开发态的唯一落地物；纯治理/CLI 场景则不值得带。定位纪律值得照抄：「开发态护栏，不是生产 init——生产仍归 systemd/k8s」。

---

## D. make-release.sh——发布打包自动化（私人内容剥离 + 打包后泄漏自验）

- **目的**：发版包 = git HEAD 已跟踪文件的干净快照，**机制与内容分离**：进化机制（EVOLUTION.md/evolution-engine/模板）保留，私人进化内容（feedback 顶层经验 *.md）剥离且索引重置为干净模板；打包后**解包扫描验证**没有私有泄漏——verify-not-assume 落到发布链。
- **实现**：`make-release.sh`（74 行）。`git archive HEAD` 解包（只含已跟踪文件，未 commit 的自然漏——cc 用「先 commit 再打包」纪律化解，progress.archive.md:33 R1）→ 删 feedback 顶层 *.md（保留 templates/）+ FEEDBACK-INDEX 重置模板（:25-31）→ 平台分支打包（MINGW 用 Compress-Archive+cygpath，其余 python3 zipfile，:37-44）→ **泄漏扫描**：解包遍历 names，feedback/ 下非 templates 非 INDEX 的 .md 存在即非零退出不发坏包（:46-71）。
- **规模**：74 行。
- **移植成本**：**低**（zcode 有 gh/release-builder 计划但 Phase 7.4 只有「九条件聚合 + never-tag」，无打包与隐私剥离这一段；zcode 同样有 .agents/feedback/ 私人内容面）。
- **价值**：高。这是 zcode 发版链目前缺的最后一环：把「发布三验」扩成「四验」——产物内容验证（无私人经验/密钥/运行态残留）。

---

## E. plan-lint——DEV-PLAN 静态质量门

- **目的**：把 dev-planner 的可执行性规则自动化：计划本身不得含占位符、Phase 结构必须完整、每个 Phase 必须有可执行 Task。
- **实现**：`scripts/plan-lint.sh`（89 行，python3 内嵌）。① 占位符禁令（TBD/TODO/待补充/待确定/**「类似 Task」「类似 Phase」「按需调整」「做相应修改」** 这类计划特有的偷懒词，代码围栏内跳过）；② 每个 `## Phase N` 段必须有 `**交付内容**/**关键文件**/**Task 清单**/**验收标准**` 四锚点；③ 每 Phase ≥1 条 `- **Task N.M：**` 条目。
- **规模**：89 行。
- **移植成本**：**低**（zcode 有 DEV-PLAN.md 与 dev-planner skill，无任何机器校验；锚点词按 zcode 模板字段改）。
- **价值**：中高。zcode 已计划 spec-lint（需求侧）与 skills-lint（技能侧）——**计划侧是三件套里漏掉的那件**；且「最坏执行者设防」的占位词表（连「类似 Task」都拦）比通用 TODO 检查严格一档。

---

## F. skill-description-lint 的③④两规则（触发式描述检查，基线的部分增量）

- **目的**：skill 靠 description 触发——描述若以流程总结作主体（「生成 X / 支持 Y / 分阶段 Z」）而无触发条件，模型会读摘要跳过正文导致漏触发。
- **实现**：`scripts/skill-description-lint.sh`（116 行）。①存在 ②≤180 字 与 dsh skills-lint（NO_DESCRIPTION/TOOL_LONG）重叠；**净增量是 ③④**：③ 必须触发式开头（含「当…时」或「由…调用」，:30-36）；④ 无触发条件时禁流程总结词作主体（生成/通过/分阶段/输出/支持/执行/内置/维护，:38）。frontmatter 块标量（`>`/`|` 折叠续行）手写解析 :42-66。
- **规模**：116 行（增量约 30 行规则）。
- **移植成本**：**极低**（并入 zcode Phase 7.1 skills-lint 即可）。
- **价值**：中。zcode 17 个 skill 的 description 就是路由面；这条 lint 防的是「skill 写了但永远不触发」的静默失效——cc 靠它在 v1.6.0 清扫过 11 个 skill 的流程概括尾巴（progress.archive.md:40）。

---

## G. test-routing——宪法声明 ↔ 磁盘实体双向一致性检查

- **目的**：主控文件（CLAUDE.md/AGENTS.md）声明的 agent 表、skill 清单与磁盘实际目录必须双向一致：声明了不存在的 = 幽灵登记；磁盘有未登记的 = 孤儿 skill。
- **实现**：`tests/test-routing.sh`（80 行，python3 内嵌）。① 调度表里 `.claude/agents/<name>.md` 抽取的声明集 == 磁盘 agents/*.md；② [可用技能] 段 `/name -` 行登记的每个 skill 有 `skills/<name>/SKILL.md` 实体；③ 反向：每个 skills/<name>/ 都在主控登记（防孤儿）。
- **规模**：80 行。
- **移植成本**：**低**（zcode 有 manifest（文件级 hash 清单）但无「宪法声明 vs 磁盘」语义级校验；对 AGENTS.md 工作流路由表 + .zcode/skills/ 跑同款双向断言即可）。
- **价值**：中。文档漂移是这类框架的高频病（cc 用它抓到过 ARCHITECTURE 计数错、rules 幽灵调用等 10 处漏，progress.md:27）。

---

## H. live 路由行为测试体系（本报告最大单项增量）

- **目的**：验证框架最大的未验证面——**「该调的 skill 真会被调吗？调 skill 前有没有偷跑？」**。静态一致性检查（G 项）只证明规则写对了，不证明 LLM 真的照做。
- **实现**：三层金字塔（`tests/run-all.sh` 73 行编排）：
  1. **selftest.sh**（69 行）——断言库自验，无需 LLM：用手造 fixture（good-run.jsonl / premature-run.jsonl / **cross-line-decoupled.jsonl**）验证断言函数本身判得对，含「预期失败」用例（断言库把偷跑误判 PASS 才算 selftest 失败）。cross-line fixture 是对抗样本：目标 skill 名只在别的事件文本里被提到——证明裸 grep 两次独立匹配会假绿，必须锁同一 tool_use 行。
  2. **静态层**（test-setup/test-routing/闸回归等 9 套）——无需 claude CLI。
  3. **live 层**（`cases/todo-app-triggers-product-spec.sh` 48 行、`cases/bug-report-triggers-bug-fixer.sh` 44 行、`cases/test-skill-behavior.sh` 159 行）——真跑 `claude -p --output-format stream-json` 拿事件日志断言。**默认 opt-in**（`RUN_LIVE_SKILL=1`，防烧 token）；**环境探针**：第一个 case 兼探针，认证失败 / 无任何 Skill 事件（OAuth-LiteLLM 代理已知不产 Skill 事件）→ SKIP 全部带诊断，**SKIP≠PASS 不假绿**。
  - 断言库 `tests/test-helpers.sh`（107 行）：`assert_skill_invoked`（先抽 `"name":"Skill"` 行再匹配 skill 参数——锁同一 tool_use，:25-44）；`assert_no_premature_action`（第一个 Skill 调用前的 tool_use 剔除允许清单 `Skill|TodoWrite|Read` 后有残留即偷跑 FAIL；全程无 Skill 调用也 FAIL，:46-75）；`assert_order` / `assert_contains`。
- **规模**：断言库 107 + selftest 69 + live cases 约 250 + run-all 73 ≈ 500 行。
- **移植成本**：**中**。逻辑全可搬；硬前提是 **ZCode CLI 是否有 headless 模式（-p 等价）+ 事件流日志（stream-json 等价）**——需实测；事件字段名（`"skill":` 等）按 ZCode Skill 工具调用格式适配。断言库与 fixture 方法论零依赖可直接搬。
- **价值**：**高**。zcode 宪法的「1% 即调 + 逃逸借口拦截」目前和 cc 一样只有 prompt 约束、零行为验证；dsh 吸收清单里 tests 重组（Phase 7.6）只覆盖引擎行为测试。cc 的实践还证明这件事本身有坑可踩（代理环境不产 Skill 事件），探针设计是现成答案。

---

## I. 识栈静态检查工具 static-check.sh（code-review Stage 0 的可执行化）

- **目的**：单模型审查的机械化补偿——静态绿才进语义审查；模型无关、工具缺失跳过不卡死。
- **实现**：`hooks/static-check.sh`（66 行，**非注册 hook**，是 code-review Stage 0 主动调的工具）。按栈分发：shell→shellcheck、python→ruff 降级 py_compile、TS→探测全部 ≤3 层深 tsconfig 且该目录有 node_modules 才跑 `npx --no-install tsc --noEmit`；PRUNE 排除 node_modules/.git/dist/build/.venv/out 及框架自身目录；未识别到栈 → 明说跳过。
- **规模**：66 行。
- **移植成本**：**低**。zcode code-review skill 的 Stage 0 目前是纯 prompt 条目（「lint/format 零新增告警」）；此工具把它变成可执行命令（可挂 pre-commit 或 receipt 的 verification）。
- **价值**：中。与 dsh/zcode 治理检查正交——治理门管「流程合规」，这个管「代码本身过得了机器检查」。

---

## J. CoVe 逐条对抗验证协议（从 workflow fan-out 中提炼的可移植模式）

- **目的**：审查产出的每条 finding 必须自带「可独立判定的验证问题 + 证据句柄」，再由**不同的验证者逐条独立核验**（默认怀疑：证据不足即判不真）——把「审查结论」变成「被独立复核过的结论」。
- **实现**：`.claude/workflows/code-review-fanout.js`（94 行）。FINDINGS_SCHEMA 强制每条 finding 含 `verificationQuestion` + `evidence`（:23-43）；pipeline(维度→审查) → parallel(每条 finding 派不同 lens 的 code-reviewer 亲自重验证据句柄) → 只回传 `isReal=true` 的确认清单（:59-93）。宿主 API（Dynamic Workflows 的 agent/pipeline/parallel/schema）为 Claude Code 专属，脚本本身不搬；**协议可搬**：verificationQuestion 字段 + 「verifier 必须亲自重跑证据」+ 默认怀疑立场。
- **规模**：协议部分约 20 行 schema 约束。
- **移植成本**：**低**（作为 review 全链/red-blue-review 的 findings schema 扩展字段 + Judge 前置核验步骤；zcode Phase 7.3 review 引擎化正好在改这个面）。
- **价值**：中。与 dsh lens 协议（finding 必须 file:line 或 reproduction）互补：dsh 管 finding 可定位，CoVe 管 finding 被反驳过。**cc 自己的 Pinned 教训要一起带走**：「可执行外部证据是承重墙，对抗式立场/多视角只是廉价补充」（progress.md:10，引 ICLR 2024「LLMs Cannot Self-Correct Reasoning Yet」+「Stop Overvaluing Multi-Agent Debate」）——CoVe 的价值在证据锚定字段，不在多 agent 形式。

---

## K. 设计层双 skill（UI 管线补位）

- **K1 design-brief-builder**（`.claude/skills/design-brief-builder/SKILL.md` + 模板）：把用户模糊视觉感受（「我要高级感」）逼成结构化 Design-Brief.md。方法论纯 prompt 可搬：选择题优先（永给 2-3 个具体选项）/ 参考锚定（「像 Linear 还是像 Notion」）/ 感受翻译（感受→设计语言→复述确认）/ 不问像素 / 联网优先查当前趋势。规模约 120 行 skill。**移植成本：低；价值：取决于产品定位**——zcode 若面向带 UI 的产品线（SiteMaster 角色本就含全栈交付），这是「需求→计划」之间缺失的设计层；纯后端/治理场景不值得。
- **K2 design-maker**（同目录）：读 Spec+Brief 经 **Open Design CLI（odc）外部 daemon** 生成可交互 HTML 设计稿（单文件离线自包含、状态变体完备、真实数据非占位）。**依赖 odc 外部环境，宿主/环境绑定，不建议直接搬**；「一份 HTML 产物两用（开发参照 + 干系人评审）」的交付物形态可留作设计阶段出口定义。规模约 200 行 skill。
- 接线位：CLAUDE.md 任务 11 步中「设计规范→设计图」两步 + 设计优先级铁律（设计稿 > Design-Brief > Spec 的视觉参照序，CLAUDE.md:45）。

---

## L. dfx-designer 的设计期扩展（12 维过堂 + 六要素场景 + 评审双模式）

- **目的**：把 DFX 从「运行时属性词汇表」（dsh/zcode 已计划的 8 属性 6 档）扩成**设计期方法论**：12 维逐维过堂（每维「软件语境定义→典型度量→设计对策→验证落点」）。
- **实现**：`.claude/skills/dfx-designer/SKILL.md`。相对引擎词汇表的净增量：① 12 维比 8 属性多出设计期维度——**可服务性/可安装性/可测试性/可修改性/归一化/成本**（硬件域翻译到软件语境，如可制造性→CI 构建效率）；② **六要素场景**逼可测（来源/刺激/环境/制品/响应/响应度量，例：「支付高峰期下游超时时订单模块 30s 内恢复、错误率<0.1%」）；③ **双模式**——Design-in 前移定档 + Review 评分卡（满足/风险/缺口+整改）评审既有架构；④ 档位经济学与取舍显性化（维度打架处逼用户排序，记录被牺牲方）；⑤ 「可度量或不写」——写不出数字+单位+测法的诉求退回重问。
- **规模**：skill 文本约 300 行（含模板）。
- **移植成本**：**低**（纯 skill 文本扩写，落点仍是 catalog attributes，与 Phase 8.1 八属性词汇表正交衔接）。
- **价值**：中高。zcode dfx-designer 现在只有五性定档；「怎么把属性逼成可验收指标」正是 dfx skill 的核心空缺，六要素场景是现成答案（且与 spec-lint 的 NO_METRIC/NO_ACCEPTANCE 检查天然咬合）。

---

## M. 小颗粒语义增量（各 <30 行改动，合并列出）

| # | 机制 | 实现 | 移植成本 | 价值 |
|---|---|---|---|---|
| M1 | **跨文件同族聚类毕业**：feedback 毕业不只看单条 occurrences≥3，同一失败模式**跨文件**出现 3+ 次（多条各 1 次）同样达标 | EVOLUTION.md:15（首例：「远端实况实查」三事故聚类毕业） | 低（evolution-engine skill 判据一句话） | 中——防同族教训分散在各条目里永不毕业 |
| M2 | **修复熔断闸**：同一 bug 修复尝试累计 ≥3 次仍未转绿 → 强制熔断回根因（架构假设/前提条件/怀疑层错了），不许再打补丁 | skills/bug-fixer/SKILL.md:100-103 | 低（zcode bug-fixer 现只有「二次出现=系统性」条目，无尝试次数熔断） | 中——补「修不动」这个维度的止损 |
| M3 | **归档阈值自动触发**：每次 record 后检查条目数，>100 即同批自动归档（「自动化是硬要求而非可选」）；归档文件头记录归档原因（recap 变慢才归、只增不删） | CLAUDE.md:303；progress.archive.md:4 | 低（zcode Phase 6.3 archive 是手动命令+ledgerHealth 提示；加一个阈值分支） | 中——防「知道该归档但一直没归」 |
| M4 | **recap 恢复必读三份**：只读 progress.md 不算恢复完成，须 progress+Spec+CHANGELOG 三份存在即读 | CLAUDE.md:191,308（源自 feedback recap-recovery-must-read-spec-and-changelog） | 极低 | 低-中——zcode 恢复流程与 dsh recap 计划合并时带上此判据 |
| M5 | **gate-audit 注册清单自动推导**：只把「source 了 lib-gate-log 的 hook」算注册闸（信息类 hook 永不拦截，不纳入则必然误报死闸）；扫主仓+所有 worktree 的账本暴露 worktree 漂移 | scripts/gate-audit.sh:29-33, 20-27 | 低 | 低——zcode gate-audit 已有 + v2.0 自我插桩已计划；「注册闸按能否产生台账自动推导」这一条防误报的设计值得对齐 |
| M6 | **hook matcher 失效自判**：Claude 的 `if = Bash(git commit*)` matcher 不稳 → 全部改为脚本内自判命令字符串（pre-commit-check.sh:14-17、auto-push.sh:11-14、kill-dev-ports.sh 头注） | 各 hook 前导 | 极低 | 低-中——ZCode hook matcher 语义若同样有坑（OQ-2 正在实测），这是现成的稳健写法 |

---

## N. progress.md / progress.archive.md 经验沉淀（教训/决策，任务要求单列）

> 来源：progress.md Pinned（:6-17）/ Decisions（:48-84）/ progress.archive.md（54 行）。只列对 zcode-base 有迁移意义的；纯 Windows/PS 宿主坑（PS 5.1 GBK、ASCII、#22700 等）归入「不适用」一句话。

**教训（可直接进 zcode 规则/feedback 的）**：
1. **单模型审查承重墙**（Pinned :10）：每个判断必须锚定可执行外部证据（运行器/编译/grep/Spec 比对）；对抗立场与多视角 lens 只是廉价补充——依据 ICLR 2024「LLMs Cannot Self-Correct Reasoning Yet」（纯提示词自我修正会反噬）+「Stop Overvaluing Multi-Agent Debate」（同模型 debate 等算力打不过简单投票）。→ 对 zcode v2.0 review 引擎化的直接校准：lens 协议的价值在**结构化证据要求**，别指望「多角色扮演」本身提质。
2. **打 git tag 前必须先查远程**（Pinned :12）：`git ls-remote --tags origin` 在先，本地无 tag ≠ 远程无 tag（曾因此打出冲突 tag）。
3. **mtime 判 TTL 不可靠**（archive :15）：文件操作会意外刷新 mtime，开关文件一律存 `expires_epoch` 与当前秒比较——zcode fast 已用 expiresAt，同结论再确认。
4. **hook 输入 schema 跨版本不稳就别依赖**（auto-push.sh:5 注）：旧实现读了不存在的 `.tool_exit_code` 导致永不 push——改用 git 状态判断。→ ZCode OQ-2（hook schema 字段实测）的先例：宁可读外部可验证状态，不读 schema 里拿不准的字段。
5. **live 路由测试的代理环境坑**（Decisions :82）：OAuth/LiteLLM 代理下 headless CLI 不产 Skill 事件 → live case 全 FAIL 但非回归；判影响面的准绳是「改动是否触碰路由规则文件」。→ H 项环境探针的存在理由。
6. **Stop 同步闸与异步 recorder 的死锁窗口**（Decisions :71）——A2 移植时的已知坑。
7. **闸靠数据留不靠感觉留**（CLAUDE.md:280 + feedback/gates-need-empirical-validation.md）：长期全绿零拦截的闸应简化或删——zcode v2.0「自我插桩/检查有效性计数」已计划，方向一致，cc 提供了判据文案（「加闸要能说出它挡住过什么」）。
8. **「验收五步闸」的两起翻车案例**（Pinned :14）：PS 5.1 git fatal 误判 + 远程 tag 误判——都发生在「查了但没读到位」：查证后再结论的关键不是「去查」，是**读到位、不被表层信息覆盖已查到的证据**（Decisions :59）。

**决策（取舍逻辑，供 zcode 对照）**：
1. **双真相源拒斥**（Decisions :50 + research 台账）：拒 cursor quality ledger、拒 task-owned 基线、拒 SubagentStop 机械拦截——理由全是「与既有单一真相源冲突/误伤率未知」。zcode 引入任何新状态文件（needs-review/strikes 等）前应过同一关：它和 receipts/ledger 是不是两套真相？
2. **轻量否决线**（Decisions 2026-06-14 :58）：不碰多模型/复杂编排/CI 溯源（当时）；后为大仓能力破例但论证了「缩小活动范围的确定性计算 ≠ 编排复杂度」（:73）。→ zcode 取舍论证方式的范本。
3. **实现载体否决假 TS 双写与 bash/ps1 双写**（:74）：选 Node 单文件——zcode runtime 本就是 Node 单实现，此决策事后看正确（cc 的全部 PS 5.1 坑 zcode 架构性免疫）。
4. **默认关闭、catalog 唯一开关**（:75）：机制密度对轻量项目是过度设计——与 zcode 现状一致。
5. **量化指标否决**（2026-06-15 :62）：撤回「agent 定义加量化成功指标（diff 行数/覆盖率）」——specification overfitting（arxiv 2403.08425），指标钉进目标会牺牲真实任务质量；用定性 DoD。→ 对 zcode 回执/验收指标设计的直接警示。
6. **「明确不做」清单制度**（progress.md:109-113 + 将来事 :126）：condenser LLM 摘要、trajectory 回放、自建 benchmark——防过度工程的显式负面清单。zcode progress 有 Open Issues 但无「明确不做」段，形式值得抄。

**progress.archive.md 归档实践**（任务点名项）：手动触发的 append-only 归档（早期 Done 搬迁、只增不删、文件头写归档原因「正文 ~180 行 recap 变慢」）——与 dsh archive --apply 同源同语义，**机制已被基线覆盖**；增量仅 M3 的「阈值自动触发」与「归档原因记录在案头」两个细节。家族共识：归档是为了 recap 恒定成本，不是为了删历史。

---

## O. 宿主专属 / 判定不适用（甄别结论，防误搬）

| 项 | 判定 | 理由 |
|---|---|---|
| `.sh`/`.ps1` 全量双写 + test-hook-parity.sh（111 行）+ fix-platform.sh/.ps1（120 行）+ setup 平台路由/-win/-mac/-ubt + settings merge 清异平台残留 | **不适用** | 根因是 Claude Code settings.json 的 hook command 平台绑定（README:83-110）；ZCode 用户级 config.json 挂 node wrapper，node 本身跨平台——**zcode 架构已结构性消解该问题**，双写+parity+fix-platform 全部无需。cc 的 PS 5.1/GBK/#22700 教训仅在该架构下成立 |
| code-review-fanout.js 的宿主 API（agent/pipeline/parallel/phase/schema） | **不适用（脚本）／可搬（协议）** | Dynamic Workflows 是 Claude Code 专属；ZCode 主 Agent 用 Agent 工具 fan-out 可达近似效果，CoVe 协议已拆出为 J 项 |
| PreCompact hook 不可注入的结论 | **宿主事实，仅参考** | Claude Code 限制；ZCode 压缩事件能力待实测（cc 的替代方案=跨 session 脏树提醒，即 A4，可搬） |
| bypassPermissions 默认模式 | **不搬** | ZCode 权限模型不同；且与治理哲学（审批三档）张力大 |
| odc（Open Design CLI）依赖 | **不搬** | 环境绑定外部 daemon（K2 已述） |

---

## P. 已覆盖项对照（深读过、确认基线内，不作为增量报告）

- **harness.mjs 13 子命令**（doctor/diff-hash/selftest/catalog-lint/impact/context-pack/receipt/verify/waiver/attributes/arch-check/fitness/adr-check/arch-trend）：与 zcode 已有 19 case + dsh 计划逐项同源（cc 自述即 cursor/codex/pi 交叉授粉产物，dsh 报告 §21-22 已覆盖同源物）；规模层细节（glob 编译缓存/NUL 分隔/maxTrackedPaths 截断保守降级）zcode 已有（终验记录：selftest 120 模块×30k 路径 722ms）。
- **install/FRAMEWORK-MANIFEST 分层升级**（.framework-new 旁路/LF 归一化 SHA/运行态排除/私有 feedback 不装+INDEX 重置）：= dsh install 增强（Phase 7.5）+ zcode 已有 manifest；cc 增量仅「settings merge jq 缺失降级」属宿主专属。
- **red-blue-review.sh 证据包凑包**（删除审计/diff 溢写）：= dsh review-pack。
- **gate-audit 主体 / doctor / fast-mode / gen-manifest / detect-feedback-signal / session-rules-banner**：zcode 已有等价物（主体差异已并入 M5/A5）。
- **feedback 体系（INDEX/templates/38 条内容）与 EVOLUTION 四层**：zcode 已有同构（.agents/feedback + evolution-engine）；净增量仅 M1 聚类毕业。
- **rules/ 五件下沉 + 指针式加载**：与 zcode rules/ 四件同构（cc 的「强制指针句」写法相同）。
- **三文件同步铁律 / 回执信封六字段 / 派单包六字段 / 审批三档 / 四步走 / per-Task 闭环 / 修复后从 Stage 0 重审**：zcode 宪法已有同文（同族同源）。
- **research/ 六篇家族仓分析**：cc 对 cursor/codex/pi/grok/ccb 的台账——zcode 的并行三路研究（含本报告）已在做同类事；其中 cursor/codex 精华（五性分级/覆盖判定/arch-check/fitness/adapters/审计法）经 cc 已进其 harness，zcode 经 dsh 基线 + 本报告 B 项同样可得，无需二手引用。

---

## 附：事实性依赖关系（非排序）

- A 组全部依赖 zcode hook 宿主能力实测（A1 的子代理触发域、A6 的 SubagentStop 存在性、M6 的 matcher 语义=OQ-2）——建议先于移植完成一次 ZCode hook 行为实测。
- H 依赖 ZCode headless CLI + 事件日志能力实测；断言库/fixture/selftest 层无依赖可先行。
- B（adapters）依赖 catalog.checks 与 runCheck/verifyPlan（zcode 已有），零新增依赖。
- A2 与 Phase 6.4 sync-check 共用判定函数；A7 与 Phase 6.4 pre-commit git hook 共用缝位。
- J 依赖 Phase 7.3 review 引擎化的 findings schema 定稿时一并扩字段，避免二次改协议。
- C/D/E/F/G/I/M 组彼此独立，无依赖。
