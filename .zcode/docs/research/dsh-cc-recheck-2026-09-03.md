# dsh-base / cc-base 复查裁决（2026-09-03）

范围：仅两仓（用户指定），2026-09-01 上轮研究之后的净增量（dsh 24 commits / cc 36 commits），双 researcher 并行深挖 + 主 Agent 亲验关键红项。方法：逐 commit diffstat + 重点 commit 全文细读 + 双向对照（每个候选去 zcode-base 实读对应实现）。

## 双仓独立同证（最高立项信号）

- **cochange 共变反查边界**：dsh `6af50bd`（graph.mjs:coChange，coupling=count/min(solo)，>8 模块 commit 排除，minSample 30，BOUNDARY_SUSPECT/accepted 带理由）与 cc `62fe100`（cmdCoChange，git log -z quotePath=false，>30 文件 commit 排除，共现≥5，默认 advisory/--gate opt-in，带分母不给合成分）独立同型。共识要点：启发式只报不闸（默认 rc 0）、批量提交排除、显著性别合成单一分数。→ 立项 `cochange`（合并两家长处：dsh 的 accepted 声明面 + cc 的 --gate 语义与分母输出）。
- **catalog 事实草稿生成**：dsh `55f8dd7` discover 与 cc `9395d5c` init 独立同型——「事实机器产（目录/import 边/build manifest），后果人决策（riskTier/attributes/forbiddenDeps 列 needsDecision）」，草稿自跑 catalog-lint 保开箱 rc 0。→ 立项 `catalog init`（大仓启用门槛从手写 catalog 降到一条命令）。

## A 类：现存缺陷（主 Agent 亲验红，建议立即修）

1. **parseArgs 未知 flag 假绿**（cc `64d9b8f` 同型）：zbase.mjs:14-26 任何 `--xxx` 无条件收进 flags。亲验：`task status --nonsense-flag` exit 0、`doctor --verbose-typo` exit 0。高危形态：`--exector` 拼错静默丢 executor = 治理参数假绿。修法：verb→flags 白名单表（照抄 cc SUBCOMMAND_FLAGS 模式，从源码 flag 读取点反推），未知 flag → usage 错误 exit 1，selftest 双向钉死。
2. **禁边进棘轮基线豁免**（cc `4b14be8` 论点原样适用）：graph.mjs check() 三类 violations 同等处理，baselineWrite() 把 FORBIDDEN_EDGE/LAYER_VIOLATION 一并 `reason:'legacy'` 入基线 → 存量禁边永久豁免。修法：FORBIDDEN_EDGE/LAYER_VIOLATION 不参与基线豁免永远 fail（显式声明的边界不是债），baselineWrite 拒收这两类；undeclared/cycles 保留棘轮语义。trend() 计数比较顺带升级集合比较（信息级）。
3. **readLines 窄形态 fail-open**（cc `44b3739` 同型窄面）：core.mjs:92-95 对「存在但读失败」走空数组路径——state 目录被剥权时 verifyLedger 报 0-entries intact。修法：exists 但 read 抛错时上抛 fail-visible。

## B 类：流程与发版门（正对本仓 09-02 manifest 漏检事故）

4. **release 加 ci-status 条件**（cc `4bf5d2e`）：`gh run list --commit <HEAD>` 精确实查（本地 status 的 ahead/behind 是缓存可任意旧）；UNKNOWN≠PASS 明说；gh 缺失走 DEGRADED 附安装指引。顺手加 worktree-clean（要发的=被测的）。
5. **验收铁律两条**（cc `81e1387`+`2df0e72`，feedback 全文值得读）：①收官/发版前 `gh run list` 独立核查与本地测试并列非可选——「本地全绿≠CI 会绿」（两仓都为此付过学费）；②跨环境修复只记「已修未验」，CI 判决后再改口。误诊修正版教训：不是「闸在响没人听」（会导向加通知的错误解法），是「验收方没去接早就存在的信号」。

## C 类：机制级立项（高价值）

6. **cochange**（见双源同证）。
7. **catalog init**（见双源同证）。
8. **CI 外部安全门**（dsh `fda169e`）：gitleaks engine-native（单二进制可本地跑，缺失诚实 BLOCKED）+ semgrep CI-only（需 Python，接 catalog 会让本地 gate 永久 BLOCKED——dsh 的分层拒绝理由已写进其 progress）。gate.yml 加 security-scan job（ubuntu 单次）；gitleaks 认领进本仓 matrix。
9. **specView 需求切片**（dsh `54ca45b`）：trace rows × computeImpact 交集，预算化渲染，noLink 诚实信号（受影响模块 cite 零需求时报「此变更不可追溯」而非空列表）。大仓 Spec 只增不减，实现者读全量成本线性涨——需求面渲染是缺口。
10. **rules-audit 深度**（cc `1fd76a5`/`cbfa004`/`0912ac8`）：加 phantom 类（引用像执法点的 token 但不存在——最严重形态，读起来被执法实际没执）+ 粗体 M 判据 + 接 dod 阻断（现 advisory ratio 0.167）+ 按 M 判据索引化 AGENTS.md（cc 宪法 M 率 11%→22.5%，真靠自觉的条目标 [P]）。我们执法面动态枚举已比 cc 聪明，缺的是 phantom 类与阻断接线。

## D 类：局部吸收（中）

11. invariants 补 State 块 + `boundToCurrentDiff`（最后闸 diffHash==当前指纹，「上次绿灯是不是这次的」一眼判；cc `07ed8ff`；压缩后回注 hook 等 ZCode 压缩事件实测 OQ 再接）。
12. review verdict 加 authorship 查询（lens 报告者 ∈ diff 作者集 → 拒 ACCEPT 点名；cc `8bb579b`；我们派单回执自带 executor 标识，数据源比 cc 自报记账更可靠）。
13. agents-lint 判定升级（空节/中英标题/fence 跳过/一节一 credit/undecidable 态；cc `9291705`；缺段从 warning 升 error 接 dod）。
14. run-all.mjs：本地一键复刻 CI 全序列（gate 八连发+dod+scan+catalog+manifest）——「只放 CI 就重演事故根因：本地跑的和 CI 跑的不是同一件事」（cc `248219a`）；gate.yml 加 weekly schedule（环境漂移不等 push）与失败 artifact 上传。
15. golden 行为基线锁（cc `8af3e2c`）：下次引擎大改前建全 verb 快照尺子（双向场景校验+<ENV> 遮罩+投用前突变实测标定）。
16. range receipt（dsh `300d995`）：`receipt write --base <tag>` 绑定 tag..HEAD 范围而非工作树指纹——clean tree 上发布范围的回执语义缺口。
17. OPERATIONS.md 运维 runbook（dsh `23ac8a4`）：按 daily/deadline/review/release 场景的「exact commands, in order」+实测耗时——我们只有体系视角文档无操作视角。
18. install hooks exec bit 进 git index（dsh `0c32f81`）：`git add --chmod=+x`——我们 doctor.mjs:637 同坑（Windows 装+stage 克隆到 Linux 后 hooks 不可执行）。
19. coverage advisory（dsh `fda169e`）：Node 原生 --experimental-test-coverage，continue-on-error，零依赖契合。
20. review profile 降档还款执法（dsh `28bb5f2`+`300d995`）：release/dod 查 review.profile 非默认即阻断——两仓都缺，先到者得。

## 留档不做（附理由）

- fleet 层多仓契约面（dsh `6af50bd`）：视家族拓扑定，纯单仓用户用不上；若要做先记 ADR。
- PostCompact/PreCompact/SubagentStop hook（cc）：Claude Code 专有事件，ZCode 七事件面无——引擎命令侧先行，hook 等 OQ 实测。
- 白名单窗口哈希（cc `f3cbbcc`）：我们 scan-instructions 零豁免设计架构性免疫；教训入 feedback 备未来豁免面设计。
- PowerShell 双写/parity/ps1 行为测试（cc `248219a`）：node 统一实现架构性免疫（win-verify.ps1 是测试驱动非被测对象）。
- dsh run-tests launcher/invariants/release 九条件/review 引擎/fast mode/sync-check/manifest 等：已等价或我们更强（详见 researcher 对照，不赘）。

## 优先序建议

A1+A2（红，小改大益）→ B4+B5（正对昨天事故，发版门+铁律）→ C6+C7（双源同证机制）→ C8-C10 → D 按需。预计 A+B 一个批次可收；C 各 200-500 行引擎面独立立项。
