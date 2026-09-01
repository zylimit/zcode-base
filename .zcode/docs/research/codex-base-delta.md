# codex-base 增量机制报告（相对 dsh-base 基线 + zcode-base v2.0 计划）

> researcher 产出 · 2026-09-01。研究对象 `/home/z00632348/code/codex-base`（只读，未改动任何仓文件）。
> 基线 = `.zbase/research/dsh-base-mechanisms.md`（dsh 全部核心机制已被 zcode v2.0 计划吸收）+ zcode-base 现有引擎（`.zcode/lib/` 19 模块 1735 行 + `zbase.mjs` 306 行；注意主 Agent 重构进行中，`.agents/`→`.zcode/` 迁移发生在本次研究期间，本报告 zcode 对照均以 `.zcode/lib/` 现状为准）。
> 本报告只列**基线未覆盖的增量**：dsh 没有、zcode 也没有/没计划的。所有「文件:行号」相对 codex-base 仓库根。引擎规模：harness.mjs 170 + lib/ 18 模块约 3800 行 + scripts/ 596 行 + tests/ 1445 行 + docs/ 15 篇 ≈ 14365 行（含文档）。
> codex-base 是 OpenAI Codex CLI 宿主脚手架（config.toml 原生 hooks / .codex/agents/*.toml 原生 sub-agent / safety.rules 原生 exec rules）。宿主专属机制见第 4 节甄别。

---

## 0. 一句话总览

codex-base 与 dsh-base 是同族但**互补取向**的两支：dsh 把执法缝放在 git hooks + CI（宿主无 hook 系统），codex 把执法缝全部压进**宿主 hook 事件 + 运行时状态机**（task baseline / evidence 文件 / 完成门 / 跨进程锁）。codex 最大的增量不在单个检查，而在三处 zcode 完全没有的骨架：**① 声明式 verification plan（按风险/影响组队 + 依赖 DAG + 资源锁）**、**② evidence 文件三重完整性（模型只见摘要，证据逐字节可复验）**、**③ 运行时韧性件（跨进程文件锁 + 损坏隔离 + Stop 三振放行 + 服务监督熔断）**。

---

## 1. 引擎核心增量（dsh 基线未覆盖）

### 1.1 shell 语义解析命令分类器（tokenizer + wrapper 剥壳 + 嵌套递归）

**目的**：正则模式表可被 `sudo timeout 5 git reset --hard`、`bash -c "rm -rf /"`、`env VAR=1 curl -d@.env ...` 等变形绕过；语义解析把「真正的程序名与参数」挖出来再判定。 <!-- scan-instructions:ignore -->

**实现摘要**（`.codex/runtime/lib/hooks.mjs`）：
- `shellTokens`（:269-311）：手写 shell tokenizer——引号状态机、`$(...)`/反引号/`*`/`?` 标记 dynamic、换行视为 `;`、`>>`/`||`/`&&` 合并操作符、`>` 与 `|`/`;`/`&` 分 kind。
- `effectiveWords`（:37-62）：剥壳 wrapper——`env VAR=1`、`sudo -u root`、`nice -n 5`、`timeout -k 1 -s TERM 5`（WRAPPER_SKIP_VALUE 表 :17-24，值旗标跳两格）、`command/exec/nohup/time` 平剥。注释点名历史缺陷：「`timeout 5 git reset --hard` 曾被分类为运行名为 5 的程序」。
- `nestedShellPayloads`（:64-79）：`bash/sh/zsh -c`、`pwsh -Command` 的 payload 递归再分类（depth≤3，:118-123）。
- `segmentsWithJoiners`（:81-88）+ `gitInvocation`（:327-339，git 全局选项含值跳格后取子命令）：管道跨段语义——`previousFetches`（:124-126）记住上一段是 curl/wget/iwr，当前段是解释器且 joiner=`|` → `remote-pipe-to-shell`。
- `classifyDangerousCommand`（:99-154）：11 条正则规则（reset --hard / clean -fdx / force push 负向断言 `--force-with-lease` 放行 / fork bomb / dd of=/dev/ / mkfs / shutdown）+ 语义判定（rm -rf 组合旗标、Windows `del /s /q`/`rd`、`Remove-Item -Recurse -Force`、根目标递归 chmod/chown `rootishTarget` :90-97）。
- 修复史：progress.md 2026-08-07 决策「危险命令分类器可被 wrapper/嵌套 shell 绕过」——本机制是对 cursor-base 已证实缺陷类别的修复。

**规模**：约 350 行（hooks.mjs 内嵌）。

**移植成本**：**中**。纯函数零依赖，但 zcode 现状是 `cfg.risk.confirm.dangerousCommands` 正则表（`.zcode/lib/hooks.mjs:66-84`）——移植要么替换正则表为语义分类器前置层，要么把正则规则挂进 `classifyDangerousCommand` 的 rules 数组（后者更平滑）。

**价值判断**：高价值——正则表是 zcode 现有 hook 执法面最大的已知绕过面（`checkBashCommand` 逐条 `new RegExp(pattern)` 直测命令串），codex 这套是已修复、已测试（tests :1104 硬化用例）的实现，直接可用。

### 1.2 秘密外发/复制拦截 + 融合参数形态提取

**目的**：秘密不止能被读（zcode 已拦 secret-read），还能被 `curl -d @.env` 外发、被 `cp id_rsa /tmp/` 复制、被 `dd if=.env` 读出——融合形式 `-d@.env`、`file=@id_rsa` 把路径藏进参数值里。 <!-- scan-instructions:ignore -->

**实现摘要**（hooks.mjs:156-211）：`SECRET_READERS`/`SECRET_COPIERS`/`EGRESS_COMMANDS` 三张命令表；`secretTokens`（:171-183）对每个 token 额外提取 `@path$` 与 `key=@path` 两种融合候选再匹配 basename；管道语义：`cat .env | curl -d @-` 跨段 pipedSecret（:189-194）；`dd if=<secret>`（:202-207）。secret 名单配置驱动（harness.json `security.secretNames/secretExtensions/allowedSecretTemplates`——`.codex/harness.json:46-75`，含 `.env.example` 模板白名单）。 <!-- scan-instructions:ignore -->

**规模**：约 55 行。

**移植成本**：**低**。zcode 已有 `secretReadPatterns/secretWritePatterns` 配置位，加 EGRESS/COPIER 分类与融合提取即可。

**价值判断**：值得——这是「密钥不入上下文/不出网」红线的机器闭环，zcode 目前只堵了读和写两个口。

### 1.3 全局输出脱敏 redactSecrets（所有证据/日志/hook 通道默认过一遍）

**目的**：证据文件、gate-log、hook additionalContext、错误消息——任何模型可见/落盘通道都可能带入凭据；脱敏必须在输出边界统一做，不靠每个调用点自觉。

**实现摘要**（`.codex/runtime/lib/common.mjs:71-98`）：13 类模式（sk-/ghp_/glpat-/xox/AKIA/AIza/JWT 三段/DB 连接串 userinfo/AWS·OPENAI·ANTHROPIC 环境变量赋值/Authorization header/password=token=/PEM 私钥块），`boundedText`（:94-98，全引擎唯一的文本截断入口）**先 redact 再截断**——因此 evidence、gate-log（audit.mjs:21-24）、hook 输出（hooks.mjs:653-664）、CLI 错误（harness.mjs:162）全部自动覆盖。与 fitness 扫描的刻意解耦见 progress.md 2026-08-07：脱敏可以过度匹配（无害），扫描规则过度匹配是噪音。

**规模**：28 行 + 消费点遍布。

**移植成本**：**低**。zcode 的 `writeReceipt` note、`logGate`、hook emit 是三个集中出口，各包一层即可。

**价值判断**：值得——zcode 现状 receipt note 直接落 `out.slice(-2000)`（`.zcode/lib/quality.mjs:35`），命令输出里的 token 会原样进账本（账本文件在 .zbase 之外是否入库取决于用户 .gitignore，风险真实）。

### 1.4 写路径预检 + task ownedPaths 执法（scope 从派单字段变机器闸）

**目的**：派单 Scope 是 prompt 约束；codex 把它变成 PreToolUse 阻断——任务外的写路径直接 deny，且检测「同路径被任务外进程改过」的并发冲突。

**实现摘要**：
- 工具写路径提取 `candidateWritePaths`（hooks.mjs:228-250）：按工具名模式（write/edit/create/delete/move/…）+ 路径键集合（path/paths/file/target/destination/from/dir…）递归提取；apply_patch 补丁文本解析 `patchPaths`（:213-218，`*** Add/Update/Delete File:` 行）。
- shell 写路径提取 `shellWritePaths`（:361-388）：重定向目标、`tee/touch/mkdir/rm`、`cp/mv` 末操作数、PowerShell `Set-Content -Path`/`Copy-Item -Destination` 命名参数（`parameterValues` :351-359）。
- 路径策略 `pathPolicyReason`（:397-408）+ `validateWriteTarget`（:410-416，`resolveForWrite` common.mjs:117-138 对**每个存在的祖先做 realpath 逃逸检测**，防 symlink 链跳出仓）；阻断 `.git`、dependencyDirs、secret 名单。
- `preflightTaskWrites`（tasks.mjs:113-126）：任务基线存 `knownHashes`（startTask 时对 owned+tracked+dirty 路径逐文件 digest，tasks.mjs:43-48）；写前比对当前 digest——不一致即 `TASK_CONCURRENT_CHANGE`「Owned paths changed outside the active task; coordinate before writing」。
- PostToolUse `refreshTask`（tasks.mjs:128-149）成功写后更新 knownHashes 与 touchedPaths。

**规模**：约 160 行（hooks 120 + tasks 40）。

**移植成本**：**中**。zcode tasks.mjs（63 行）已有 envelope/ownedPaths/baseline fingerprint，缺 knownHashes 与写路径提取两块；apply_patch/Edit/Write 工具输入形态对 ZCode 需按宿主工具名适配（zcode 现只匹配 `Edit|Write|ApplyPatch|MultiEdit` 取 file_path，无 shell 写目标提取）。

**价值判断**：值得——这是「最小副作用/Scope 铁律」唯一的机器执法路径；其中**并发写冲突检测**（knownHashes）单独就值回票价：多子代理并行时 prompt 级 scope 完全不设防。

### 1.5 guardrail-asset-write 软执法（护栏资产改动：不拦但必留痕+播报）

**目的**：框架自身资产（config/runtime/rules/agents）被模型改动是最危险的腐败面，但硬拦会阻断合法维护——执法分两档：关键路径写入放行但 gate-log 记 `guardrail-write` + systemMessage 当场播报「Verify this change is intended; doctor will flag critical drift」。

**实现摘要**（hooks.mjs:452-481）：PostToolUse 成功写入后过滤 `GUARDRAIL_PREFIXES`（.codex/config.toml、harness.json、runtime/、rules/、agents/）；`appendGateLog({kind:'guardrail-write'})` + systemMessage；与 doctor 的 managedDrift（doctor.mjs:113-128，install-manifest digest 比对分 critical/customized）构成「当场播报 + 事后审计」双闸。

**规模**：约 30 行。

**移植成本**：**低**。zcode 已有 protected-write 硬阻断（`.zcode/lib/hooks.mjs:100-104`）与 logGate；加一个「软层」分支（zbase 引擎文件路径前缀）即可。

**价值判断**：值得——zcode 目前对自身引擎文件是「全硬拦」，维护自身时反而碍事；两层执法（用户级 config/引擎=播报审计，账本/门禁注册=硬拦）更符合实际。

### 1.6 SubagentStop 回执信封六字段机器校验（+ SubagentStart 注入）

**目的**：回执信封（Status/Changed/Verified/Not verified/Needs review by/Evidence）在 zcode 是宪法条文；codex 在 SubagentStop hook 里用正则逐字段校验，缺字段 → `decision: block` 逼子代理补全。

**实现摘要**（hooks.mjs:539-557）：`subagentStop` 对 `last_assistant_message` 逐字段 `new RegExp("(^|\\n)Field\\s*:","i")` 检测，missing 列表进 block reason；`subagentStart`（:539-548）注入「depth is one / 必须回信封 / DONE 不是验证」+ 当前任务 ownedPaths。**宿主依赖**：需要宿主提供 SubagentStart/SubagentStop 事件——ZCode 现注册 7 事件（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop）无 Subagent 事件，**需先核实 ZCode 是否支持**（系统提示提到 ZCode 子代理返回最终文本给主 Agent，若无 SubagentStop 事件则此机制不可移植，只能退化为主 Agent 验收时校验）。

**规模**：19 行。

**移植成本**：低（若宿主有事件）/ 不可移植（若无）。

**价值判断**：若 ZCode 有 SubagentStop 则强烈值得（宪法纪律变机器闸）；否则跳过。

### 1.7 Stop 门按 unresolved-state 键的三振放行

**目的**：完成门把会话锁进死循环（每次 Stop 都被 block）本身是韧性缺陷；同一未解决状态最多拦 3 次，之后**显式放行**（systemMessage「Human review is required; the task is still incomplete」）+ gate-log 记 `stop-release`。

**实现摘要**（hooks.mjs:559-608）：`stopStrike`（:564-572）以 `sha256(taskId + fingerprint + missing 清单)` 为 key 计数（**不同缺失原因各自计数**，修好一项不会误耗另一项的额度）；`stopBlock`（:574-588）≥3 → 放行+升级；`stop`（:590-608）聚合 completionStatus 的 checks/review/attributes 缺口；completion 门评估自身异常也走 block（fail-visible，:604-607）。

**规模**：50 行。

**移植成本**：**低**。zcode 已有简化版（`bumpStopCount(2)` 全局计数，`.zcode/lib/hooks.mjs:145-152`）；升级点 = 按「缺失项哈希」分键 + stop-release 也入 gate-log（zcode 已记 exhausted）。

**价值判断**：值得做小升级——全局计数的问题是一个顽固缺失项会耗尽所有额度，或两个不同缺失项交替各计一次永不触发；按状态分键是正确做法。

### 1.8 声明式 verification plan（按风险/影响组队 + 保守扩散 + planHash + 空计划阻断）

**目的**：gate 不该是「想起哪个跑哪个」；该跑什么由 task risk、受影响模块声明、全局策略三者确定性推导，plan 本身被 hash 绑定进回执。

**实现摘要**（`.codex/runtime/lib/quality.mjs:107-163`）：`verificationPlan` 数据流——matrix.riskChecks[task.risk] 起始组（`reasons[id]=['risk:high']`）→ 受影响模块 `module.verification` 并集（reasons 追加 `module:<id>`，来源可追溯）→ `impact.expandedToAll`（unmapped/shared/global/truncated 触发，catalog.mjs:227-233）时并入 `matrix.conservativeChecks`（reasons `conservative-impact`）→ 依赖闭包（`dependency-of:<id>`）→ 拓扑序输出，每 check 携带 reasons。`planHash = sha256(stableJson(base))`；`empty: checks.length===0` 显式标记（注释：「空计划是配置失败不是绿灯」，completionStatus :430-438 把 empty 列为阻断项）。gate 选跑子集也强制带上依赖闭包（:368-379）。

**规模**：57 行（+ catalog 保守扩散判定）。

**移植成本**：**中**。zcode 已有 verification-matrix（`checks[{name,command,proves,scope}]`）与 runGate 单检查执行；缺 riskChecks 分组、module.verification 关联、保守扩散组、planHash——zcode 的 impact.mjs 已产出 affectedModules，组队逻辑可以直接挂上。

**价值判断**：**本报告最高价值项之一**——zcode 的 quality verify 反证门回答「属性有没有被证明」，但「这次变更该跑哪些检查」目前全靠派单自觉；plan 把它变成 impact 的确定性函数，与 zcode 已有的 impact/catalog 无缝咬合。

### 1.9 检查依赖 DAG + 资源锁 + 平台声明

**目的**：检查之间有依赖（build 过了才能 test）；并发 gate（hook 进程 + 主 Agent 同时跑）会对同一状态目录互踩。

**实现摘要**：matrix check 字段 `dependencies/resourceLocks/platform`（validateMatrix 逐字段校验 quality.mjs:50-81，环检测 `topologicalOrder` :89-105 抛 MATRIX_CYCLE）；执行时依赖未过 → BLOCKED「dependency did not pass」（:311-313）、平台不符 → BLOCKED（:315-317）、`withResourceLocks`（:278-283）按 check 声明嵌套取 `stateFile('resource-locks/<name>.lock')`。matrix 实例（`.codex/harness/verification-matrix.json`）：harness-tests dependsOn harness-validate、pack-check dependsOn [manifest-check, harness-tests]，resourceLocks 区分 harness-state/framework-manifest/npm-pack。

**规模**：约 60 行。

**移植成本**：**低-中**。拓扑排序 17 行直搬；资源锁依赖 1.13 的文件锁先落地。

**价值判断**：值得——zcode matrix 增加三个可选字段即可向后兼容；依赖声明让「测试在构建前跑必失败」这类废话错误消失。

### 1.10 evidence 文件 + 三重完整性（模型只见摘要，证据逐字节可复验）

**目的**：zcode 回执把命令输出尾部 2000 字符塞进 note——既是截断损失又可能带秘密；codex 把**全量脱敏输出**写独立 evidence 文件，回执只带 `evidencePath/evidenceBytes/evidenceHash`，验证时逐字节复检。

**实现摘要**：写入（quality.mjs:341-357）：`boundedText(reason+stdout+stderr, evidenceChars=200000)` → `harness-state/evidence/<task>/<check>-<ts>-<pid>.log` 原子写 → 回执记 bytes+hash。验证（receipts.mjs:55-88 `validateVerification`）：evidencePath 必须相对且不含 `..`（EVIDENCE_PATH_UNSAFE）→ realpath 必须落在 `harness-state/evidence` 内 → 逐字节长度+sha256 比对（EVIDENCE_TAMPERED/EVIDENCE_MISSING）。doctor 校验 receipt.schema 必须含这三个字段（doctor.mjs:134-142）。CLI 层 `modelBounded`（harness.mjs:19-25）超 modelChars=12000 直接抛错，不静默截断。

**规模**：约 80 行。

**移植成本**：**中**。zcode 账本（ledger.jsonl + 哈希链）已绑定 fingerprint；增量 = note 换成 evidence 句柄 + receipts 验证路径补三重校验 + retention 对 evidence 的清理（codex retention 保护「活跃 task 引用 + 窗口内每 (task,check) 最新回执」的 evidence 永不删，retention.mjs:46-60——删了旧回执就不可复验，这是 zcode 引入 evidence 后必须跟的配套）。

**价值判断**：值得——「证据优先铁律」的物理层；zcode 现在 note 截断 2000 字符意味着长测试输出里的失败详情经常被截掉，回执的证明力打折。

### 1.11 completionStatus 完成门聚合（optional FAIL 也阻断 + review scope 匹配）

**目的**：task finish 不该是 `--force` 就能过；完成 = required 检查全可接受 + review（按风险）+ 属性覆盖 + 账本链四项联合判定，且**可选检查跑失败同样阻断**。

**实现摘要**（quality.mjs:422-505）：required check 逐项判（新鲜 PASS / 快照匹配 / fast 窗口匹配的 SKIPPED / 未过期 waiver）；「optional planned check failed; executed failures are never acceptable」（:473-481，注释：「可选失败与 gate 静默唱反调是已知失败模式」——cursor-base 吸收的修复）；review 门（:483-492）：`requiresReview && risk∈{medium,high} && !fast.active` 时要求 review receipt——验证链 + **scope/exclusions 与 task ownedPaths 排序比对**（scopeMatches，review 回执的审查范围过期即不算）+ APPROVE + 无 blocker/high 未解决 finding；`trailingFailStreak`（:236-243）连续 FAIL≥3 → reason 追加「stop retrying, run root-cause analysis (bug-fixer)」；`complete` = checks.every && review.acceptable && attributes.acceptable（:503）。

**规模**：84 行。

**移植成本**：**中**。zcode task finish（63 行 tasks.mjs）需扩成聚合判定；review 部分依赖 zcode v2.0 计划中的 review 引擎化（dsh 基线 #3）——codex 的增量细节是 **scopeMatches 与 ownedPaths 比对**（dsh review 绑 diffHash 但未绑 scope 与任务归属）与 **requiresReview 按 risk 档触发**。

**价值判断**：值得，但放在 review 引擎化之后——它是 dsh review 全链的收口件，把「审查过」从「有张回执」变成「审的就是这个任务的这些路径」。

### 1.12 executor 角色绑定（高风险检查必须 tester 执行）

**目的**：职责隔离（写测者≠被测作者）是 zcode 宪法第 4 条，但纯 prompt；codex 在 gate 回执上记 `executorRole/executorId`，完成门校验高风险回执的 executorRole==='tester'。

**实现摘要**：gate 入口校验 executor 格式（quality.mjs:382-388，role 正则 `^[a-z][a-z0-9-]{0,31}$`）；回执落 executorRole/executorId（:305-306）；completionStatus（:456-459）：`task.risk==='high' && !fast.active && receipt.executorRole !== 'tester'` → 不可接受「high-risk checks require a fresh tester-executed receipt」。

**规模**：约 15 行核心。

**移植成本**：**低**。zcode receipt write 已是子代理落账的入口，加 executor 字段 + finish 校验即可。

**价值判断**：值得——一行校验把宪法最常被违反的条文（主 Agent 顺手自测自过）变成机器拒绝，杠杆比极高。

### 1.13 跨进程文件锁（ownerToken + pid 存活检测 + stale 突破）

**目的**：hook 是宿主 spawn 的独立进程——SessionStart 与 PreToolUse 可能并发读写 state.json；进程内互斥完全不设防，丢更新必然发生。

**实现摘要**（`.codex/runtime/lib/state.mjs:44-89`）：`open(lockPath,'wx')` 独占创建 → 写 `{pid, ownerToken, createdAt}`；EEXIST 时：age>staleMs(120s) 且 `lockOwnerAlive`（pid 0 信号探测，EPERM 视为存活）→ 删锁重试；timeout(15s) → LOCK_TIMEOUT；释放时读回 ownerToken 匹配才 unlink（防误删他人的锁）。`readState/writeState/updateState/appendLedger` 全走锁 + 原子写（:98-149）；check 的 resourceLocks 与 lease ledger 都复用同层（quality.mjs:278-283、leases.mjs:124）。并发正确性有专门测试（tests :158「cross-process state updates use a lock and do not lose increments」）。

**规模**：46 行。

**移植成本**：**低**。

**价值判断**：**必须**——这不是可选增强，是 zcode 引擎现存的数据丢失缺陷面（zcode hooks 与主 Agent CLI 同时跑时 loadState→saveState 读改写无锁）；v2.0 重构动 state 层时应顺手带上。

### 1.14 损坏状态隔离 quarantine（不 brick 也不静默重建）

**目的**：state 文件 JSON 损坏时，静默重建=丢证据，硬失败=整个 harness 不可用；正确行为是移开原件、留痕、按默认值继续、事件可见。

**实现摘要**（state.mjs:9-40）：`quarantineState` 改名 `<file>.corrupt-<ts>` + 追加 `quarantine.jsonl`（ts/file/quarantinedAs/error 前 400 字符）；`readState/updateState` 捕 JSON_PARSE_FAILED 走隔离（:104-106/:130-135）；`quarantineEvents`（:30-40）供 risk scan 消费——`risk('high','state-quarantined','verify no work was lost')`（risk.mjs:73-75）+ SessionStart 注入。运营纪律（docs/OPERATIONS.md）：「核对隔离原件确认无工作丢失，不要删除取证文件」。

**规模**：50 行。

**移植成本**：**低**。

**价值判断**：值得——「失败必须可见」红线的状态层实现；成本 50 行换「断电/半写状态文件不会让整个框架拒绝服务」。

### 1.15 fast windowId 绑定（SKIPPED 只在开启它的窗口内有效）

**目的**：dsh fast 四条件（zcode 已计划吸收）覆盖了封顶/reason/DEBT，但 SKIPPED 回执与 fast 窗口无绑定——旧窗口的 SKIPPED 在新窗口会被误认有效。

**实现摘要**（quality.mjs:245-270 + :450-454）：`setFastMode on` 每次生成 `windowId: randomUUID()`；SKIPPED 回执记 `fastModeWindow`；completionStatus 接受 SKIPPED 的条件含 `receipt.fastModeWindow === fast.windowId`（同一窗口）且 createdAt ≤ expiresAt；窗口字段缺失 → `invalid` 态显式报「quality skips are disabled until Fast Mode is re-enabled」（SessionStart 也播报，hooks.mjs:499）。

**规模**：约 20 行。

**移植成本**：**低**。zcode fast 已有 state（.zcode/lib/state.mjs），加 windowId 字段 + receipt 校验。

**价值判断**：值得——是 dsh fast 方案之上的正确性补丁（dsh 用「gate 记录含 fastMode 标志」但无窗口身份）；v2.0 吸收 fast 四条件时应一并带上，避免二次返工。

### 1.16 path lease 路径租约（advisory 并发写协调）

**目的**：多 writer 并行时 ownedPaths 不重叠只是约定；lease 把「我正在写这些路径」变成可查询、可冲突检测、可过期的仓内记录。

**实现摘要**（`.codex/runtime/lib/leases.mjs` 189 行）：acquire（owner/taskId/worktree/integrationOwner/hours 1-720）——同 owner+task+paths 幂等返回原 lease；路径重叠检测 `leasePathsOverlap`（相等/祖先/子孙，Windows 折叠大小写 :103-109）→ `LEASE_CONFLICT` 带 conflicts 明细；过期在下一次操作时惰性转 expired；release 仅 owner；ledger 走 updateState 锁。**诚实边界**：`LEASE_ADVISORY` 常量随每个返回值下发「repository-local coordination hints, not OS locks or cross-host enforcement」（:8）。配置无 services 时零开销。risk scan 消费过期/将过期 lease（risk.mjs:58-63）。

**规模**：189 行。

**移植成本**：**低-中**。独立模块，仅依赖 state 层（锁+原子写）。

**价值判断**：中性偏值得——zcode v2.0 主 Agent 唯一编排 + 子代理串行的默认下用处有限（与 dsh fleet 同样的「多仓/多 writer 场景」疑问）；但若吸收 1.4 的 ownedPaths 执法，lease 是其并行安全的自然补件，成本低可一起做。

### 1.17 dev-service 监督器（退避重启 + 健康探针 + 重启风暴熔断）

**目的**：开发服务（dev-server/watcher）崩溃后 AI 会话里没人拉起；挂着但 wedged（进程活着端口不响应）比崩溃更隐蔽。

**实现摘要**（`.codex/runtime/lib/services.mjs` 240 行）：`superviseService`（:89-160）detached 常驻循环——spawn + 状态文件 + 日志（5MB 轮转 .1，appendLog 失败绝不连带服务 :71-81）；health 探针（:109-121）可配置命令按 intervalMs 跑，连续 failures 次失败 →「Alive but wedged is still down」terminate 走重启路径；重启窗口计数（:142-158）：windowMs 内 >maxRestarts → **熔断**：status=crashed、守护退出、note「restart storm: supervision halted pending investigation」；指数退避 `backoffMs*2^n` 封顶 backoffMaxMs；stop 经哨兵文件轮询 + 宽限期后直接 SIGTERM 兜底（:190-210）；start 等待 supervisor 报告 running 才返回（:178-187）。risk scan 报 crashed/dead 为 high（risk.mjs:83-86）。dsh 曾明确拒绝此机制（CAPABILITY-MATRIX「dev-service 监督器」），codex 是族内唯一实现。

**规模**：240 行。

**移植成本**：**中**。独立模块零耦合（只依赖 state/common）；但 detached 进程模型在 ZCode/WSL 环境需实测（progress.md Risk：Windows detached 语义未复验——反向提醒 Linux 也需验证）。

**价值判断**：场景依赖——仅当 zcode-base 的目标项目常态跑本地 dev 服务时值得；纯库/CLI 项目用不上。若做，熔断器思想（反复失败→停下要人看）单独适用于 zcode 其它层。**不建议 v2.0 首批吸收**，因为 zcode 定位是治理脚手架而非运行时，且这是 dsh 明确拒绝过的方向（两族分歧点，说明非共识刚需）。

### 1.18 canonical fingerprint 含 untracked 内容字节 + 防注入细节

**目的**：zcode fingerprint 对 untracked 只 hash **路径清单**（`.zcode/lib/git.mjs:61-76`：`sha256(list.sort().join('\n'))`）——新增一个未跟踪文件后**改其内容**不会改变 fingerprint，旧回执为新内容背书；codex 把 untracked 内容字节编进 hash，并堵住测量层的注入与截断。

**实现摘要**（`.codex/runtime/lib/git.mjs`）：
- `canonicalGitDiff`（:126-201）：staged/unstaged 用 `--binary --no-ext-diff` 固定前缀 diff；untracked 逐文件 `长度:路径:类型:内容长度:` 前缀 + 内容字节——类型标记 `symlink:not-followed`（junction/symlink 只记到链接根，不读目标，:156-159）/`special:not-read`/`missing`；`realpath` 解析出仓 → `GIT_PATH_ESCAPE`（:173）。
- 防注入：diff 的 pathspec 一律 `:(literal)` 前缀（:104-109，注释：「路径来自仓库元数据，仍强制字面量」）；baseline revision 先 `rev-parse --verify --end-of-options`（:88，防 `--upload-pack` 类参数注入）。
- 截断响亮失败：`GIT_MAX_OUTPUT` 256MiB（:17-20，环境变量可调），`result.outputTruncated` → `GIT_OUTPUT_TRUNCATED`「refusing to bind truncated measurement」（:24-29）——runProcess（common.mjs:176-181）把静默截断变成可观察标志。
- 非 git 环境：`NON_GIT_BINDING` 显式哨兵（`DEGRADED:NON_GIT:NO_CANONICAL_DIFF`，:9-13），且 task 级 freshness 直接 fail-closed（quality.mjs:21-31）「固定 sentinel 不得生成可完成 task 的 receipt」。

**规模**：约 200 行（git.mjs 主体）。

**移植成本**：**低-中**。zcode fingerprint 骨架已在；增量 = untracked 内容进 hash（+symlink 不跟随）+ literal pathspec + 截断抛错（zcode 已有 truncated 标志但 fingerprint 只在 stop 门消费它，git 命令输出本身无上限保护）。

**价值判断**：值得——untracked 内容盲区是 zcode 证据链的真实漏洞（回执 fresh 判定 `e.content.fingerprint === ver.currentFingerprint`，.zcode/lib/quality.mjs:92，而 currentFingerprint 对 untracked 内容变化不敏感）；WIP 阶段文件全是 untracked，恰好是最需要证据绑定的时刻。

### 1.19 hook/CLI 输出预算（boundedHookOutput 递归限长 + modelChars 硬限）

**目的**：hook additionalContext 无限长会撑爆模型上下文；CLI JSON 输出无上限会整屏倾倒；预算必须在边界强制且超限失败可见。

**实现摘要**：`boundedHookOutput`（hooks.mjs:653-664）：递归 `limitStrings`（字符串 min(limit,3000)、数组 slice 20、对象逐值）→ 序列化仍超限 → 再裁 additionalContext → 仍超 → deny 场景替换为通用拒绝文案（保证拒绝永远可达）；`modelBounded`（harness.mjs:19-25）：CLI 结果 JSON 超 `outputLimits.modelChars`(12000) 抛 `MODEL_OUTPUT_LIMIT`（**不静默截断**——截断的 JSON 是坏的）；`SessionEnd` 内联封顶 sessions 记录（hooks.mjs:610-623，retention at write time）。config 三个通道预算（harness.json:6-10：hookChars 4000/modelChars 12000/evidenceChars 200000）。

**规模**：约 50 行。

**移植成本**：**低**。zcode hook emit（`.zcode/lib/hooks.mjs:20-23`）加 bounded；CLI 输出加 modelChars。

**价值判断**：值得——zcode SessionStart 注入与 receipt note 目前均无预算；配合 dsh recap 预算化机制（已计划吸收）构成完整的上下文防线。

### 1.20 context-pack 高级预算（定点迭代收敛 + 分级裁剪 + 摘要/证据分离）

**目的**：包的序列化长度里含 budget 数字自身——裁剪改变长度又改变 budget 字段， naive 做法死循环或不收敛；裁掉什么必须有优先序且全程留痕。

**实现摘要**（`.codex/runtime/lib/context.mjs`）：`serializePack`（:96-118）迭代 ≤12 轮至 serializedChars/Bytes **定点收敛**，packHash 含 budget 字段；`fitContextPack`（:132-212）裁剪序：impact classifications → omitted 明细 → included 内容（最长文件尾部裁，每次超额+64）→ included 条目 → canonical diff → impact 细节 → task 细节，每级记 `truncation.reasons` 与各级 dropped 计数；最小安全 envelope 装不下 → `CONTEXT_BUDGET_TOO_SMALL` 拒绝写 evidence（:204-210）；`modelSummary`（:223-275）模型只见元数据+evidencePath/bytes/hash，逐级可摘除字段至 modelChars；文件级安全 `regularContextFile`（:28-58）逐段 lstat+realpath——symlink/junction/逃逸一律 omitted 带理由；**denied 路径出现在变更集 → canonical diff 整体替换为占位+hash**（:310-314，秘密变更内容不得经 diff 进包）。symlink 子孙枚举问题（Git for Windows junction）有专门处理与测试（tests :531）。

**规模**：约 280 行。

**移植成本**：**中**。zcode context.mjs 已有 pack 与 deny-list；增量在收敛算法、分级裁剪序、摘要/证据分离（依赖 1.10 evidence 层）、symlink 逐段检测四处。

**价值判断**：值得但可分批——「denied 变更 → diff 整体省略」和「全量入证据/模型见摘要」两点应随 evidence 层一起落；定点收敛与裁剪序属于打磨，v2.0 可先记录模式后补。

### 1.21 fitness 代码反模式五规则 + 行内抑制

**目的**：zcode fitness 是接线审计（属性声明 vs 认领检查）；codex fitness 是**变更代码的反模式扫描**——两类互补，前者查治理接线，后者查代码本身。

**实现摘要**（`.codex/runtime/lib/fitness.mjs` 132 行）：五规则——`no-secret-literal`（error，高置信 token 格式+引号字面量赋值，刻意比脱敏窄，:18-30 注释）、`no-pii-in-logs`（error，console.log/loggger.* 带 email/ssn/passport/credit_card 等字段）、`empty-catch`（warning，含 Python `except: pass`）、`unbounded-retry`（warning，while true + retry 关键词）、`todo-without-owner`（info）；`harness-fitness:ignore <rule>` 本行或上一行抑制（:81-87）——**抑制注释留在 diff 内可见**；只扫变更路径（≤2000 文件/1MB/200 findings 封顶，超限标 truncated）；secret 名单路径跳过。本仓自检 0 error 0 warning（自食其力证据）。

**规模**：132 行。

**移植成本**：**低**。独立扫描函数；zcode 已有 fitness 命令位，可做 `fitness scan` 子命令与现有接线审计并存。

**价值判断**：值得——五条规则全是 zcode 宪法已有红线的机器化（失败必须可见=empty-catch；PII 不入日志=隐私红线）；行内抑制「在 diff 内可见」的设计避免了抑制本身变成暗门。

### 1.22 doctor 的 managedDrift + bootstrap 出厂态警告

**目的**：装出去的框架被谁改过（漂移检测）；以及反方向——**catalog/matrix 还是我们出厂的原样**（用户没定制就依赖 affected/gate，等于什么都没证明）。

**实现摘要**（`.codex/runtime/lib/doctor.mjs`）：`managedDrift`（:113-128）读 install-manifest.json 逐文件 digest 比对，分 critical（config/harness.json/runtime/agents/rules）与 customized 两档；bootstrap 检测（:191-201）：catalog lint 失败但 catalog digest === 出厂 manifest 值 → warning「Module catalog is still the scaffold bootstrap; customize it before relying on affected checks」（matrix 同理）。AGENTS.md 字节预算（:171-173：>32KiB error、>24KiB warning）。runtime 卫生（trackedRuntime :106-111，harness-state 除 .gitignore 外不得有 tracked 文件）。

**规模**：约 60 行。

**移植成本**：**低**。zcode 已有 manifest 命令 + doctor；加两段比对即可。

**价值判断**：值得——「出厂态 bootstrap 检测」是 zcode 安装到新项目后的真实盲区：默认 catalog+matrix 情况下 impact/verify 全绿但全是脚手架默认值；一句 warning 廉价且关键。

### 1.23 installer 事务性（staging 备份 + 逆序回滚 + post-verify + uninstall + 故障注入）

**目的**：dsh install 的旁路不覆盖（已计划吸收）解决「不破坏用户文件」；codex 进一步解决「安装到一半失败后目标仓处于半装状态」。

**实现摘要**（`scripts/lib/installer.mjs` 238 行 + `scripts/lib/files.mjs` 222 行）：plan/apply 分离——plan 阶段逐文件 hash 三态判定（unchanged/create/update/conflict-sidecar，conflict sidecar 带时间戳+hash 前缀防堆积 files.mjs:209-222）+ obsolete 文件两态（未被改→remove-obsolete；被改→preserve-obsolete）；apply 阶段每个 mutation 先备份进 `install-staging-<id>/backup/`，逐项执行后**整体 post-verify**（逐文件 digest 复核 :121-126），任一失败 → 逆序回滚（:143-151）→ 写 install-receipt（status: committed / rolled-back / **rollback-incomplete** 三态留痕）；uninstall 只删仍等于基线的文件+清空目录（:171-238）；`pack-check`（codex-base.mjs:73-86）npm pack --dry-run 比对：harness-state/私密 feedback/项目四文档（Product-Spec/DEV-PLAN/progress）**禁止进包** + manifest 文件全在场；故障注入 `CODEX_BASE_INSTALL_FAIL_AFTER=n`（:99,:118）供测试断言回滚（tests :1020「rejects unsafe manifests and rolls back injected failures」）；`assertSafeTarget`（files.mjs:131-149）拒绝文件系统根/home/源码树上下（含 realpath 双查）。

**规模**：460 行（两文件）。

**移植成本**：**中**。zcode install 已有（含用户级 hooks 注册，codex 没有的部分）；增量 = staging/回滚/post-verify/receipt 四件 + uninstall + pack-check（zcode 发布面若有 npm pack 场景）。

**价值判断**：值得吸收其中一半——回滚+post-verify+install-receipt 应该做（安装器写坏用户仓是最高破坏性操作之一）；uninstall 与故障注入属于维护仓自用，可缓。注意与 dsh install 增量（旁路/LF 归一化/verify 先 stage）合流成一次 install 重构，避免两轮返工。

### 1.24 风险扫描信号集（相对 zcode 的净增信号）

**实现摘要**（`.codex/runtime/lib/risk.mjs`）：stale-task（活跃任务 >72h 建议重切）、fail-streak（同 check 连续 FAIL≥3 → high「stop retrying and run root-cause analysis」）、ledger 不可读（与断链分开报）、lease 过期/将过期、fast 过期（旧 SKIPPED 失效预告）、stop-strikes 计数≥2（预告 3 次将放行）、quarantine 事件（最近 5 条）、service crashed/dead、evidence 超 retention 限、**每个 risk 都带下一步动作**（docs 定义「names the risk, the evidence, and the next action」）。SessionStart 注入非 info 级 top3（hooks.mjs:504-512），risk scan 自身失败 →「Treat harness state as unknown, not healthy」。

**规模**：111 行。

**移植成本**：**低**（信号随各机制落地自然可用；zcode risk.mjs 已有 scan 骨架）。

**价值判断**：随机制走——单独列出的原因是「每个风险带下一步动作」与「扫描失败=状态未知」两条设计纪律值得在 zcode 扩 risk 信号时遵守。

---

## 2. Product-Spec / DEV-PLAN 自举方式（任务点名关注）

**codex 自举结构**（维护面 vs 复制面显式分离）：

- **Product-Spec.md**（312 行，v3.0）：REQ-001~024 编号制 + 非功能需求（**性能预算数字化**：PreToolUse <100ms、SessionStart/Stop 中型仓 <2s、60 万行 impact<5s/lint<10s、模型可见输出 ≤12000 字符）+ 明确非目标 + 成功标准（可判定的「相对路径逃逸/symlink 逃逸被阻断」式验收句）+ **「验收边界」一节**：「本 Spec 定义 harness 自身。目标项目的业务 Spec……由目标项目维护」——脚手架与目标项目的需求边界显式声明，防止把框架需求混进用户 Spec。
- **复制面/维护面分离**（Spec §4）：目标项目只复制 `AGENTS.md + .codex/ + .agents/`；`Product-Spec/DEV-PLAN/progress/docs/scripts/tests/FRAMEWORK-MANIFEST` 全部留在维护仓且 **pack-check 机器强制不进包**——「脚手架的项目记忆不是用户的项目记忆」。
- **DEV-PLAN.md**（548 行）：交付策略（串行 writer 纪律）→ 技术栈表（**每行带「原因」列**：为什么 Node ESM——Windows/Linux 同一实现零 shell 双写）→ ASCII 依赖图（P1 宿主契约→P2 runtime→…→P8 对抗审查）→ Phase×Task，每 Task 五字段 Goal/Scope/Dependencies/Verification/**Expected**（期望输出——比 Verification 多一层「跑完应该看到什么」的阳性断言，如「每个注册 event 恰好一个 command hook」）→ 每 Phase 末尾**验收命令块**（可直接复制执行的真实命令）。
- **REQ↔机制回链**：progress.md 每条 Decision 标注对应 REQ 号（v3 = REQ-019~024）与 evidence 文件清单。

**移植成本/价值**：zcode v2.0 引入 spec id 制（dsh spec-lint 已计划）时，codex 三个细节值得并入模板：① 非功能需求的数字化性能预算（可被性能测试消费，tests :1057 就是按 Spec 的 5s/10s 预算写的）；② DEV-PLAN Task 的 Expected 字段（期望输出）；③ 复制面/维护面分离 + pack-check 强制（zcode 若有安装/发布面，框架自身的 progress/feedback 不得流向目标项目）。成本：低（模板级改动）。

---

## 3. scripts/ 与 docs/ 结构、tests/ 组织

**scripts/（维护仓专属，不进复制面）**：`codex-base.mjs`（136 行单入口：manifest write/check、doctor、validate、pack-check、install/upgrade/uninstall --dry-run）+ `lib/files.mjs`（manifest 构建/LF 归一化 hash/安全路径/sidecar）+ `lib/installer.mjs`（事务）。全部 JSON 输出（机器可测试）。zcode 的 runtime/zbase.mjs 对应物已有；**差异**：codex 把「维护仓专属命令」（pack-check/manifest）与「目标项目运行时」（harness.mjs）物理分成两个入口两个目录——目标项目永远看不到维护命令。zcode v2.0 若合并引擎，这个「维护面/运行面分离」的目录纪律值得保留。

**docs/（15 篇）结构**：运行契约（PROTOCOLS——每条协议一段，如 Ledger Chain 的容忍规则原文）+ 运维手册（OPERATIONS——命令+故障恢复剧本：Gate FAIL 连 3 次转 bug-fixer、账本断链处置、install rollback-incomplete 处置）+ 设计文档（ARCHITECTURE/QUALITY-ATTRIBUTES/RED-BLUE-REVIEW/ROLE-CONTRACTS/LARGE-REPO-GUIDE/ISOLATION-PROFILES）+ **元文档**（CROSS-POLLINATION 吸收拒绝台账、HARNESS-AUDIT 深度审计、MIGRATION-MAP、AGENT-ROLES-SPEC-NOTES、CAPABILITY-MATRIX、ADOPTION）。相对 dsh 四件套的净增：
- **HARNESS-AUDIT.md**（311 行）：三仓深度审计方法论——三问框架（已被真实代码+测试证明有效？只是文档承诺/宿主专用/大仓失控？宿主原生已有什么？）+ 逐仓「值得吸收/不能盲从」双向清单（如 pi-base 的 impact 未传播反向依赖、context pack 偏目录摘要、质量策略双重来源等**反面教训**）。**这正是本次研究任务的方法论原型**——zcode 做 v2.0 三仓研究时的报告骨架可以直接采用。
- **CROSS-POLLINATION.md**：吸收/拒绝台账 + **Recurring Review Checklist**（触发条件：姊妹仓有 release/核心工作流变化/用户要求/活跃开发期每月一次；分类 adopt now/adapt later/reject 写理由/parent-only；「优先可执行检查与发布门禁，不加常驻 prompt 文本」）。dsh CAPABILITY-MATRIX 是一次性台账，codex 把它变成**周期性流程**。价值判断：值得——zcode 三仓研究做完后应有此台账防止后人重复评估或无据吸收。
- **ISOLATION-PROFILES.md**：并行写隔离的诚实档案（4 profile + 「不宣称 Docker 级隔离」+ worktree 规则：只删自己建的、删除需确认）。zcode 并行子代理场景同样适用，成本零（纯文档）。

**tests/harness.test.mjs**（1445 行单文件 46 用例）组织特点：按机制域分块（state/lease/fingerprint/task/hook wire/catalog/context/gate/receipt/ledger/fitness/arch/installer/performance/classifier）；三处值得抄的测试技术：
1. **并发正确性测试**（:158）：两进程并发 updateState 不丢增量——直接测 1.13 的锁。
2. **性能预算测试**（:1057）：64 模块/600k 行合成 fixture 断言 impact<5s、lint<10s——「抓数量级回归」（cursor-base 吸收），把 Spec 的性能预算变成回归测试。
3. **对抗性测试**：分类器硬化用例逐条列变形攻击（:1104）；账本篡改三态（编辑/中段删/尾截，:711）；evidence 篡改（:669）。zcode tests/ 已有基础，这三类是测试方法增量。成本：低（模式照抄）。

---

## 4. 宿主专属机制甄别（不适用 ZCode，或需适配）

| 机制 | 位置 | 判定 |
|---|---|---|
| `.codex/agents/*.toml` 角色定义 + `sandbox_mode`（researcher/code-reviewer 等 read-only 沙箱；write 角色最小权限）+ `[agents] enabled=false` 机械断 depth=1 | .codex/agents/ 9 个 toml | **宿主专属**。ZCode 无 sandbox_mode/子代理 toml 概念；depth=1 由 zcode 宪法+派单纪律承担。但「**只读角色与写角色分级**」的思想在 ZCode 有对应物（子代理说明里写明只读），无法机器化 |
| `.codex/config.toml` hooks 注册（8 事件单 dispatcher + command_windows 双平台 + SessionEnd 3s 上限匹配宿主） | .codex/config.toml | **宿主专属**。zcode 已走用户级 `~/.zcode/cli/config.json`（ADR-0006）；「SessionEnd 类事件按宿主超时上限收紧」的**纪律**对 ZCode hook 注册同样适用（若 ZCode 事件有不同超时限制） |
| `safety.rules` prefix_rule DSL（forbidden/prompt/allow 三档 + pattern 数组匹配 + **match/not_match 内嵌测试向量**） | .codex/rules/safety.rules 124 行 | **宿主专属**（Codex execpolicy 原生格式）。可借鉴的通用点：① 三档决策（禁/确认/放行）比 zcode 的二档（拦/放）细——`git push origin`（放行但需授权）与 `git push -f`（禁）分流；② **match/not_match 测试向量写进规则文件本身**——规则自带单元测试，防止规则改坏。zcode 的 dangerousCommands 配置表可升级为 `{pattern, decision, match, notMatch}` 结构 |
| doctor 校验 codex CLI 0.146.x 版本容差 | doctor.mjs:178-184 | 宿主专属形态；**「宿主版本容差核对」对 ZCode 通用**（zcode doctor 应核对 ZCode CLI 版本兼容窗口，值得确认现状） |
| PowerShell 100% ASCII 强制 + validatePowerShell | doctor.mjs:95-104；progress.md Pinned | 宿主/平台专属（Windows PS 5.1 代码页问题）。zcode 环境为 WSL，无 .ps1 资产则不适用 |
| `test-skill-behavior.sh`（codex exec --ephemeral 黑盒行为回归，默认 skip 环境变量开启） | .agents/skills/skill-builder/scripts/ | 半通用：**「Skill 路由行为回归」的思路通用**（临时目录装脚手架→喂 prompt→断言输出含预期路由），但驱动命令是 codex exec；ZCode 若有等价 headless CLI 可平移，否则缓 |
| `design-maker` 依赖 odc（Open Design CLI daemon） | .agents/skills/design-maker/SKILL.md | **环境专属工具依赖**。见 5.1 的拆分判断 |

---

## 5. Skill 面与 .agents/ 增量

### 5.1 design-brief-builder（视觉方向采访 Skill）

**目的/摘要**（`.agents/skills/design-brief-builder/SKILL.md` 264 行 + 模板 176 行）：产品经理工作流里「模糊的视觉需求→可执行 Design-Brief」的采访协议——**选择题优先**（永远给 2-3 个具体选项不给开放题）、**参考锚定**（「像 Linear 还是像 Notion？」替代抽象形容词）、**联网优先**（设计趋势/竞品先 WebSearch 再推荐，明确「不凭过期记忆」）、**感受翻译**（「高级感」→「深色主题低饱和度大留白衬线标题」，翻译完复述确认）、**不问像素**（圆角阴影交给下游）。输出 Design-Brief.md 供设计工具与 dev-builder 双消费。依赖检测：Product-Spec 缺失→先路由 product-spec-builder；设计工具 MCP 缺失→降级手动模式。

**移植成本**：**低**（纯 Skill 文件）。**价值判断**：值得——填补 zcode 17 skills 里「Spec→DEV-PLAN 之间视觉/设计层」的空档，其「选择题优先/参考锚定/感受翻译」采访纪律甚至超出设计场景本身可复用。

### 5.2 design-maker（odc 生成可交互 HTML 设计稿）

133 行。依赖 odc daemon（环境专属），产物 demo/index.html「一份两用：开发照着实现/干系人浏览器直接看」，五原则（完整页面覆盖/状态完备（空/加载/错误/激活态）/文档驱动/真实内容不用 Lorem ipsum/离线自包含单文件）。**价值判断**：工具链不通用，**不建议移植**；但「Spec 每个有 UI 的功能必须有对应页面+关键状态变体」的验收式设计产出纪律，可并进 zcode design-brief 或 dev-builder 的 UI 任务定义，成本一句话。

### 5.3 skill-builder 的两个机器闸脚本

- `skill-description-lint.sh`（约 60 行 bash+python3 内嵌）：SKILL.md frontmatter（name kebab-case、description 非空且 **≤180 字符**——「description 写成流程摘要会导致路由失效」是 codex 实测教训，progress.md 2026-06-15 落地记录）。zcode 计划吸收 dsh skills-lint（frontmatter/命名/体积全量 lint）后此脚本被覆盖，仅 180 字符阈值这条经验需并入。
- `test-skill-behavior.sh`：见 4 节甄别。

### 5.4 EVOLUTION.md 四层进化 + 反馈 UX 分级

**摘要**（`.agents/EVOLUTION.md` 30 行）：四层——①经验积累（feedback-observer 记录）→②规则毕业（重复 3+ 次→提议升级正式规则；zcode evolution-engine 已有）→③Skill 优化（某 Skill 来源反馈持续偏低→调 Skill）→④**Skill 自动生成**（某操作模式反复出现 5+ 次但无 Skill 覆盖→提议新建）。UX 纪律四级：记录无感（子代理静默）/归纳无感/有待处理轻触（一行提示）/执行变更每条需用户确认。SessionStart 注入 feedback 待处理数（hooks.mjs:503，读 FEEDBACK-INDEX.md 统计 `[已毕业]` 标记，:516-526）。

**成本/价值**：文档级成本；第④层与「UX 分级」是 zcode evolution-engine 之上的净增两层——值得把第④层写进 zcode evolution-engine 的提案类型清单，「无感/轻触/确认」三档写进 feedback-evolution 的 UX 约定。

---

## 6. 经验教训与决策沉淀（progress.md + feedback，单独列节）

> codex-base 的 progress.md 是族内最厚的决策账本（111 行，Pinned 7 条/Decisions 15 条/Risks 9 条）。对 zcode v2.0 直接有用的教训，按主题归类：

**引擎设计教训**（多数已被 v3 修复吸收，对 zcode 是「免重蹈」清单）：
1. **正则命令分类必被 wrapper/嵌套 shell 绕过**（2026-08-07 Decision）——sudo/env/timeout 穿透 + `bash -c` 递归是已证实攻击面；zcode 现有正则表面临同类问题。
2. **测量截断静默绑定错误证据**（同日）——git 输出超限必须响亮失败而非截断后当完整结果用；「measurement overflow is always a loud failure, never an empty or partial result」（git.mjs 注释）。
3. **空验证计划 = 配置失败不是绿灯**；**optional 检查失败同样不可接受**——「可选失败与 gate 静默唱反调是已知失败模式」（quality.mjs 注释）。
4. **质量策略双重来源必漂移**（HARNESS-AUDIT §4.5）——配置允许自定义与 resolver 硬编码并存 →「运行器按 A 完成门按 B」；只保留一个权威 plan。zcode v2.0 合并引擎时警惕 catalog/config/matrix 多处硬编码同一词汇表（dsh 基线也指出 zcode 三处 ATTRS 常量）。
5. **代码扫描规则与脱敏规则必须解耦**（2026-08-07）——脱敏可过度匹配（无害），扫描过度匹配是噪音灾难（`token = argv[i]` 全误报）；「高置信 token 格式+引号字面量」是扫描侧的正确口径。
6. **失败连击要有熔断语义**——同 check 连续 FAIL≥3 停止重试转根因分析（bug-fixer）；写在 completionStatus reason 与 risk scan 两处。
7. **修配置型故障要扫全部同类实例**（feedback: bug-fix-scan-sibling-config-instances）——「完成声明须覆盖故障类别而非单个实例」；源自 hook timeout 修了 6 处中一处的真实事故。

**工程纪律教训**：
8. **三文件恢复铁律**（Pinned 2026-07-30 + v1.1.8 整版强化）——/recap 后必须同步读 progress+Spec+CHANGELOG（+DEV-PLAN），只读 progress 不算恢复、缺失必须明说并降级；曾为此发过一整个 patch 版本并配静态锚点测试。zcode 宪法已有同条铁律，codex 的加码是**用测试锚点守护恢复行为**。
9. **临时豁免必须显式定界**（2026-07-18 ×3 条）——「本轮不测试不检视」写成带日期的 Pinned 条目且明确「仅本轮、不得据此裁剪最终能力」；事后（2026-07-30）补「质量规则恢复」决策显式关闭豁免。**豁免的生命周期管理**（开启留痕→到期显式关闭）比豁免本身更重要。
10. **品牌/资产保护入规则**（feedback: preserve-brand-assets）——清理精简前先盘点品牌资产，默认保留，删除需用户确认；源自 Logo 误删事故（从 git 历史恢复）。
11. **多 repo 提交隔离**（feedback: multi-repo-commit-isolation）——多仓 add/commit/push 必须逐仓独立执行各自验收，耦合脚本造成「半成功」烂局。
12. **研究下钻不能用 fan-out 冒充深度**（feedback: recursive-research-depth-not-fanout）——每层须有独立研究边界/证据路径/共识分歧与上层验证。
13. **主 Agent 独立判断不盲从子代理**（feedback: native-subagent-research + 2026-07-18 Pinned）——fresh 子代理研究后主 Agent 必须亲读关键材料核对证据。

**规模/性能教训**：
14. **glob 编译缓存的量化动机**——「coverage lint 对每 tracked path × 每 pattern 重编译正则在 60 万行尺度主导运行时」（catalog.mjs:27-29 注释）；600k/64 模块合成 fixture 的性能预算测试回填（Spec 数字 ↔ 测试互证）。zcode 大仓定位相同，lint/impact 的性能回归应有同款 fixture 测试。
15. **平台证据诚实**——Risks 节明确「v3 证据产生于 WSL2/Node24/Codex 0.146.1，Windows 实机未复验」；HARNESS-AUDIT 明确「未把无法联网包装成已查询最新网页」（代理 407 失败时改用本地缓存手册并声明）。证据边界的自我标注纪律本身值得抄。

**自举边界决策**：
16. **复制即用 + 双面分离**（2026-07-18 Decisions）——脚手架交付=复制最小运行资产（AGENTS.md+.codex/+.agents/），维护资产归拢源仓；「目标项目根目录必须清爽」。
17. **撤销双宿主**（2026-07-20）——同仓双宿主（Codex+Grok）尝试后回滚，恢复纯 Codex 单独维护。对 zcode 的镜像教训：**一套引擎绑一个宿主的事件/配置面**，抽象多宿主只会两边都做不深。
18. **非 Git 项目 fail-closed**（2026-07-30）——可以降级跑 hooks/doctor/catalog，但 task 级证据链直接拒绝（不接受固定 sentinel 为旧代码背书）。「降级可以，伪造保证不行」的边界划法。

---

## 7. 规模与成本汇总表

| # | 机制 | 文件:行 | 规模 | 成本 | 价值一句话 |
|---|---|---|---|---|---|
| 1.1 | shell 语义分类器 | hooks.mjs:17-153,269-339 | ~350 行 | 中 | 高——zcode 正则执法面的已知绕过口的已测试修复 |
| 1.2 | 秘密外发/复制拦截 | hooks.mjs:156-211 | ~55 行 | 低 | 值得——密钥红线补上「出网」这个口 |
| 1.3 | 全局输出脱敏 | common.mjs:71-98 | 28 行 | 低 | 值得——zcode receipt note 现在原样落命令输出 |
| 1.4 | 写路径预检+ownedPaths+并发检测 | hooks.mjs:213-250,361-450; tasks.mjs:34-48,113-149 | ~160 行 | 中 | 值得——Scope 从 prompt 变机器闸，knownHashes 并发检测独有 |
| 1.5 | 护栏资产软执法 | hooks.mjs:452-481 | ~30 行 | 低 | 值得——播报+审计两档比全硬拦合实际 |
| 1.6 | SubagentStop 信封校验 | hooks.mjs:539-557 | 19 行 | 低/不可 | 取决于 ZCode 是否有 Subagent 事件，先核实 |
| 1.7 | Stop 三振按状态分键 | hooks.mjs:559-608 | 50 行 | 低 | 值得小升级——zcode 全局计数会误耗额度 |
| 1.8 | verification plan | quality.mjs:107-163 | 57 行 | 中 | **最高价值之一**——「该跑什么」变 impact 的确定性函数 |
| 1.9 | 检查依赖 DAG+资源锁 | quality.mjs:89-105,278-317 | ~60 行 | 低-中 | 值得——matrix 加三个可选字段向后兼容 |
| 1.10 | evidence 三重完整性 | quality.mjs:341-357; receipts.mjs:55-88 | ~80 行 | 中 | 值得——证据链物理层，note 2000 字符截断伤证明力 |
| 1.11 | completion 完成门聚合 | quality.mjs:422-505 | 84 行 | 中 | 值得——review 引擎化后的收口件 |
| 1.12 | executor 角色绑定 | quality.mjs:382-388,456-459 | ~15 行 | 低 | 值得——一行校验执法宪法第 4 条，杠杆最高 |
| 1.13 | 跨进程文件锁 | state.mjs:44-89 | 46 行 | 低 | **必须**——zcode 多进程并发读写 state 是现存缺陷 |
| 1.14 | 损坏状态隔离 | state.mjs:9-40 | 50 行 | 低 | 值得——失败可见红线的状态层 |
| 1.15 | fast windowId | quality.mjs:245-270,450-454 | ~20 行 | 低 | 值得——dsh fast 方案的正确性补丁，随 fast 一起做免返工 |
| 1.16 | path lease | leases.mjs（全文件） | 189 行 | 低-中 | 中性——单 writer 默认下用处有限，若做 1.4 可顺手 |
| 1.17 | 服务监督熔断 | services.mjs（全文件） | 240 行 | 中 | **不建议 v2.0 吸收**——zcode 是治理脚手架非运行时，且是 dsh 明确拒绝过的分歧方向 |
| 1.18 | untracked 内容入指纹+防注入 | git.mjs:104-208 | ~200 行 | 低-中 | 值得——zcode 指纹对 untracked 内容盲区，WIP 期恰最需绑定 |
| 1.19 | hook/CLI 输出预算 | hooks.mjs:646-670; harness.mjs:19-25 | ~50 行 | 低 | 值得——与 recap 预算构成完整上下文防线 |
| 1.20 | pack 定点收敛+分级裁剪 | context.mjs:96-275 | ~280 行 | 中 | 分批——「denied 变更省略 diff」「摘要/证据分离」先做，收敛算法后补 |
| 1.21 | fitness 代码反模式五规则 | fitness.mjs（全文件） | 132 行 | 低 | 值得——宪法红线（失败可见/PII）的代码级机器化 |
| 1.22 | managedDrift+bootstrap 警告 | doctor.mjs:113-128,186-201 | ~60 行 | 低 | 值得——装出后的出厂态盲区一句 warning 廉价关键 |
| 1.23 | install 事务性 | scripts/lib/installer.mjs+files.mjs | 460 行 | 中 | 半吸收——回滚/post-verify/receipt 做，uninstall/故障注入缓；与 dsh install 增量合流一次做 |
| 5.1 | design-brief-builder | .agents/skills/design-brief-builder/ | 440 行 | 低 | 值得——填补视觉层空档，采访纪律可复用 |
| 5.2 | design-maker | .agents/skills/design-maker/ | 133 行 | 低 | 不移植——odc 环境专属；状态完备纪律一句话并入 |
| §2 | Spec/PLAN 自举细节 | Product-Spec.md/DEV-PLAN.md | 模板级 | 低 | 值得——性能预算数字化/Expected 字段/双面分离三件 |
| §3 | 测试三技术+元文档流程 | tests/; docs/ | 模式级 | 低 | 值得——并发测试/性能预算测试/对抗测试 + 吸收台账周期化 |

---

## 8. 与 dsh 基线的重叠排除说明（防重复吸收）

以下 codex 机制经比对**已被 dsh 基线覆盖**（zcode v2.0 计划吸收中），本报告不再列为增量，仅注差异：

- **protected attributes 含 privacy**：codex `PROTECTED_ATTRIBUTES={security,safety,privacy}`（quality.mjs:13）与 dsh #13 相同，且 codex 额外把「security class 或带保护属性 → allowFastSkip 直接 MATRIX_INVALID」（quality.mjs:73-76，配置期就拒绝，而非运行期过滤）——这个**配置期前置校验**细节 dsh 放在 catalog-lint（PROTECTED_FAST_SKIP），语义等价。
- **fast 四条件**：codex 有 reason 吗？**没有**——codex `setFastMode` 不收 reason、上限 720h（dsh 是 8h 封顶+reason 必填，dsh 更严）；codex 净增仅 windowId（已列 1.15）。
- **review 回执**：codex 是单条 receipt（record），无 dsh 的 session/lens/stage/verdict 体系；codex 净增仅 scopeMatches/requiresReview 细节（已并入 1.11）。
- **哈希链账本**：zcode 已有；codex 净增仅 head 锚的「截断到空账本也可检出」判定（receipts.mjs:40-45，head !== previous 即使全删链式条目也断）——zcode 若采用 head 锚需含此用例。
- **gate-audit**：zcode 已有；codex 净增 gate-log 轮转（.1 一代）与 entry 上限。
- **retention prune**：zcode 已有 days 维度；codex 净增「保护活跃引用」规则（已并入 1.10 配套）。
- **arch 棘轮/adr-check/cochange**：codex arch=baseline 棘轮+scan 实边（zcode/dsh 均已有同类）；codex scanRealEdges 只做 relative imports 并显式声明语言边界（「bare specifiers are out of scope and said so」）——诚实边界声明值得注意但非机制增量。
- **GLOB_CACHE**：zcode catalog 若无编译缓存，此为 60 万行性能必件（catalog.mjs:29-39）——归入 §3 性能测试条目一并落地。

## 9. 未尽事项

- `.codex/harness-state/` 下的 gate-log.jsonl/sessions.json 为运行态实例数据，未逐一核验内容（与机制无关）。
- `.codex/harness/schemas/*.json`（4 个 JSON schema）与 templates（ADR/MODULE-CAPSULE/PROJECT-MAP）未逐行读——schema 形态与 dsh ADR-CONTRACT 同类；MODULE-CAPSULE 模板与 zcode 计划中的嵌套 AGENTS.md 同位。
- tests/harness.test.mjs 仅读用例名与关键段（:1057/:1104/:711/:669/:158/:1020），未逐行核验断言实现。
- zcode-base `.zcode/` 迁移进行中（研究期间目录在动），对照基于 2026-09-01 时刻的 `.zcode/lib/` 快照；若主 Agent 重构已改写 state/tasks/git 层，1.13/1.4/1.18 的「zcode 现状」描述需按最新代码复核。
