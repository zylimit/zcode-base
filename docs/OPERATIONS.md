# OPERATIONS——操作者 runbook

精确命令、按序执行。耗时为本仓实测（WSL2 / Node ≥20 / 2026-09-03，量级供预期管理，不是 SLA）。
退出码约定：`0` 通过 / `1` 错误 / `2` 阻断（hook·dod·release）/ `3` 检查发现·degraded / `4` 账本校验失败。

## 日常循环——编辑后验证

何时跑：每次改代码后、commit 前。

```bash
npm test                                              # ≈8.5s  全量单测（改任何代码后的第一道）
node .zcode/zbase.mjs impact --paths <改动文件逗号串>   # ≈0.1s  反向依赖闭包——受影响面先看清
node .zcode/zbase.mjs gate <check>                    # ≈0.2~5s  受影响检查落账（gate 名单=verification-matrix 带 command 的 checks；harness-unit-tests 最重 ≈5s）
node .zcode/zbase.mjs sync-check                      # ≈0.1s  三文件同步执法（代码改了、progress.md 没记=红）
```

受影响 gate 怎么选：`impact` 的 fanout 模块 × `.zcode/harness/verification-matrix.json` 各 check 的 `scope` 取交集；拿不准就跑整段 run-all。

## 收官发版

何时跑：里程碑收口、准备打 tag。顺序不可换：本地全绿 → 提交推送 → **独立**核查 CI → release 装配证据 → 人工 tag。

```bash
npm run run-all                                       # ≈17s  本地复刻 CI 全序列 15 步（gate.yml 同源；任一步红先修再走）
git add -A && git commit -m "<批次说明>" && git push
gh run list --commit "$(git rev-parse HEAD)" --json conclusion   # ≈0.9s  独立核查 CI 判决——不信自报（feedback 铁律：unknown is not a pass）
# 可选：把人工/外部检查绑定到将被 tag 的范围（range receipt）——发布时树 clean、指纹形态退化为 headCommit，
# range 形态钉住「上一个 tag..HEAD」：HEAD 一动即失效，diffHash 复算一致才新鲜
node .zcode/zbase.mjs receipt write --check <人工检查名> --status PASS --note "<证据>" --base <上一个tag或基线ref>
node .zcode/zbase.mjs release                         # ≈1.4s  发布十二条件证据装配（READY=exit 0；tag/push 永不由它执行）
git tag vX.Y.Z && git push origin vX.Y.Z              # 人工——tagging/pushing 是 HIGH 档人类行为
```

## review 流——结构化分歧审查

何时跑：高价值/高风险变更、发布前复核、`catalog.review.requireForFinish` 要求时。
前置：工作树有变更（干净树无可审查对象，先制造合法变更再开审）；lens 名单与待报状态用 `review status` 查。

```bash
node .zcode/zbase.mjs review start                    # ≈0.1s  开审（绑定当前 diff；tag/origin/main 自动定 base）
node .zcode/zbase.mjs review blue <<< '{"claims":[{"claim":"边界路径已验证","evidence":"node -e 0 → exit 0"}]}'   # ≈0.1s  自证必须带证据
node .zcode/zbase.mjs review lens correctness <<< '{"executor":"code-reviewer","findings":[]}'    # ≈0.1s  stage 1
node .zcode/zbase.mjs review lens reliability <<< '{"executor":"code-reviewer","findings":[]}'    # ≈0.1s  stage 2
node .zcode/zbase.mjs review lens resilience  <<< '{"executor":"code-reviewer","findings":[]}'    # ≈0.1s  stage 3
node .zcode/zbase.mjs review verdict --reviewer auditor --notes ok  # ≈0.1s  裁定由已记录事实计算，不是断言
```

stdin JSON 形态（blue/lens 都是单行 JSON 走标准输入）：

```json
{"claims": [{"claim": "边界路径已验证", "evidence": "node -e 0 → exit 0"}]}
```

```json
{"executor": "code-reviewer", "findings": [{"severity": "error", "location": "src/a.mjs:42", "summary": "越界输入未拦截"}]}
```

finding 必须 `location`（`file:line`）或 `reproduction`（别人能跑的命令）二选一；`severity ∈ error|warning|info`；`executor` 与实现回执相同会被 verdict 拒绝（职责隔离红线）。退出码：协议违规 `1` / FIX_REQUIRED `2` / degraded（空 diff）`3` / stale（开审后树变了）`4`。

## 大仓导航

何时跑：`.zcode/harness/module-catalog.json` 存在的仓，动代码前先定位、装配上下文。

```bash
node .zcode/zbase.mjs catalog lint                    # ≈0.1s  模块账本校验（unmapped 路径=error）
node .zcode/zbase.mjs impact --paths src/lib/foo.mjs  # ≈0.1s  反向依赖闭包（谁会被这次改动波及）
node .zcode/zbase.mjs context pack --budget 8000      # ≈0.1s  预算化上下文（秘密/构建产物/运行态永不入包）
node .zcode/zbase.mjs spec view --paths src/lib/foo.mjs  # ≈0.1s  受影响模块的需求切片（改前先看需求怎么说）
```

## 快速参考

| 命令 | 耗时 | 何时跑 |
|---|---|---|
| `node .zcode/zbase.mjs doctor` | ≈0.6s | 环境自检（目录/hooks/账本/契约一致性） |
| `node .zcode/zbase.mjs selftest` | ≈0.2s | 引擎冒烟（120 模块规模） |
| `node .zcode/zbase.mjs task status` | ≈0.1s | 恢复会话先看任务态 |
| `node .zcode/zbase.mjs fast status` | ≈0.1s | 每次会话播报（防忘关证据贷款窗口） |
| `node .zcode/zbase.mjs quality status` | ≈0.1s | 五性覆盖现状 |
| `node .zcode/zbase.mjs quality verify` | ≈0.1s | 反证优先覆盖判定（uncovered 阻断 exit 3） |
| `node .zcode/zbase.mjs receipt verify` | ≈0.1s | 哈希链校验（断链 exit 4） |
| `node .zcode/zbase.mjs receipt stats` | ≈0.1s | 账本四态统计 |
| `node .zcode/zbase.mjs gate <check> [--executor tester]` | ≈0.2~5s | 跑 matrix 声明的检查并落账 |
| `node .zcode/zbase.mjs dod` | ≈0.6s | 静态 DoD 12 步聚合（blocking 失败 exit 2） |
| `node .zcode/zbase.mjs release` | ≈1.4s | 发布十二条件证据装配（READY=exit 0） |
| `node .zcode/zbase.mjs budget` | ≈0.1s | 变更爆炸半径四指标（超限 exit 1：拆分或记 ADR） |
| `node .zcode/zbase.mjs recap` | ≈0.1s | 预算化恢复摘要 |
| `node .zcode/zbase.mjs invariants` | ≈0.1s | 不可谈判集 + State 块 |
| `node .zcode/zbase.mjs plan` | ≈0.1s | 当前任务的 verification plan |
| `node .zcode/zbase.mjs sync-check` | ≈0.1s | 三文件同步执法 |
| `node .zcode/zbase.mjs trace` | ≈0.1s | 需求可追溯（悬空引用 fail） |
| `node .zcode/zbase.mjs spec-lint` | ≈0.1s | 需求可判定性（EARS） |
| `node .zcode/zbase.mjs skills-lint` | ≈0.1s | 改 skill 后 |
| `node .zcode/zbase.mjs agents-lint` | ≈0.1s | 改嵌套模块 AGENTS.md 后 |
| `node .zcode/zbase.mjs scan-instructions` | ≈0.1s | 改指令文件后（八规则安全扫描） |
| `node .zcode/zbase.mjs plan-lint` | ≈0.1s | 改 DEV-PLAN 后 |
| `node .zcode/zbase.mjs rules-audit` | ≈0.1s | 宪法规则执法覆盖审计 |
| `node .zcode/zbase.mjs test-routing` | ≈0.1s | 宪法声明 ↔ 磁盘一致性 |
| `node .zcode/zbase.mjs classifier lint` | ≈0.1s | 改 classifier 规则后（向量自测） |
| `node .zcode/zbase.mjs feedback lint` | ≈0.1s | feedback 条目契约校验 |
| `node .zcode/zbase.mjs feedback list` | ≈0.1s | 毕业候选（occurrences≥3） |
| `node .zcode/zbase.mjs fitness` | ≈0.4s | 五性接线审计 |
| `node .zcode/zbase.mjs fitness scan` | ≈0.1s | 变更代码反模式五规则 |
| `node .zcode/zbase.mjs risk scan` | ≈0.1s | 失败连击与危险状态 |
| `node .zcode/zbase.mjs gate-audit` | ≈0.1s | 死闸审计（从未拦过的门） |
| `node .zcode/zbase.mjs effectiveness` | ≈0.1s | 闸有效性（每规则 deny/observe/allow） |
| `node .zcode/zbase.mjs adapters` | ≈0.7s | 外部工具目录（available/wired） |
| `node .zcode/zbase.mjs cochange` | ≈0.1s | git 历史共变反查模块边界 |
| `node .zcode/zbase.mjs review status` | ≈0.1s | 审查会话进度与待报 lens |
| `node .zcode/zbase.mjs review-pack` | ≈0.1s | 审查证据包（Commits/Diffstat/删除审计） |
| `node .zcode/zbase.mjs waiver list` | ≈0.1s | 豁免清单 |
| `node .zcode/zbase.mjs arch check` | ≈0.1s | 架构执法（禁边/未声明依赖） |
| `node .zcode/zbase.mjs arch trend` | ≈0.1s | 架构债务趋势 |
| `node .zcode/zbase.mjs adr check` | ≈0.1s | ADR 幽灵引用检测 |
| `node .zcode/zbase.mjs manifest check` | ≈0.1s | 完整性清单（漂移 exit 3） |
| `node .zcode/zbase.mjs golden record` | ≈2.5s | 行为基线重录（行为演化后） |
| `node .zcode/zbase.mjs golden check` | ≈2.7s | 行为尺子比对（漂移 exit 1） |
| `node .zcode/zbase.mjs retention prune --dry-run` | ≈0.2s | 留痕清理预演（去 --dry-run 才真删） |
| `node .zcode/zbase.mjs archive` | ≈0.1s | progress.md 归档预演（--apply 才搬） |
| `npm run coverage` | ≈11.6s | 覆盖率（advisory） |
| `npm run run-all` | ≈17s | 本地复刻 CI 全序列（发版前必跑） |
