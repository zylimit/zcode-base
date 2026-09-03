# lib 七模块界契约（.zcode/lib/：core/graph/writes/quality/scan/context/hooks/doctor + 兼容 shim 面）

riskTier: critical——引擎本体：账本/门禁/锁/写预检。写坏这里 = 证据体系失真，一切下游证明作废。

## Purpose 用途

- 零依赖 Node ≥18 治理引擎，按 dsh 七模块界组织（Task 8.10 重组，git 历史经旧文件 shim 可达）：
  - `core.mjs`：词汇表/退出码/脱敏（原 common）+ 配置路径（config）+ 跨进程锁/quarantine/stop-strikes/fast（state）+ git 访问层（git）。
  - `graph.mjs`：catalog 装载/归类/lint + impact 反向闭包 + arch 禁边执法/棘轮/ADR 幽灵 + agents-lint。
  - `writes.mjs`：写路径预检（独立小层：quality(tasks) 与 hooks 共同消费，拆开消环）。
  - `quality.mjs`：五性覆盖/门 + receipts 哈希链账本 + tasks 任务信封/completion 门 + waivers + plan 组队 + budget + review 引擎 + audit（gate-log/死闸/rotateGateLog）。
  - `scan.mjs`：fitness 接线审计/反模式扫描 + skills-lint + scan-instructions + rules-audit/test-routing/plan-lint + feedback lint。
  - `context.mjs`：context-pack + risk + retention + memory（recap/invariants/archive）+ sync-check + release（dod/十二条件）。
  - `hooks.mjs`：7 事件统一 hook 入口（拦截/放行/留痕/恢复注入/Stop 三振/写预检接线）。
  - `doctor.mjs`：doctor/selftest/install + manifest 维护。
- 其余同名旧文件（common/config/state/git/catalog/…/manifest.mjs 共 26 个）是**纯 re-export shim**：保旧 import 路径兼容（测试与外部消费方），新代码一律 import 新模块。

## Boundaries 边界

- 允许触碰：`.zcode/lib/**`。新机制放进**对应的七模块**（按上面职责归类）；确需新顶层模块时同步 module-catalog 禁边与本契约。
- 禁止触碰：`.zcode/state/**`（运行态，仅经 withStateLock/updateState 状态层访问）、`.zcode/harness/**`（契约面）、skills/commands/rules/docs（各自模块）。
- 依赖方向（module-catalog forbidden 硬执法，`arch check` 零违例）：
  `core ← {graph, writes} ← quality ← scan ← context ← {hooks, doctor}`；zbase.mjs/shim 面在链顶。**禁止环、禁止反向 import、禁止真实模块 import shim**（shim 仅为兼容测试/外部）。
- 新增 CLI verb 必须同步 zbase.mjs usage 与 README CLI 一览；新增 hook 行为必须更新 tests。

## Invariants 不变量

1. 退出码契约：0 通过 / 1 错误 / 2 hook 阻断 / 3 检查发现 / 4 账本校验失败。引擎任何异常路径不得假绿。
2. 状态写入一律 withStateLock 锁内读-改-写（updateState）；重计算（fingerprint/git/digest）在锁外完成后提交。
3. 所有模型可见/落盘出口先 redactSecrets 再截断（boundedHead/boundedTail/boundedText）；截断静默 = 缺陷。
4. 拒绝（deny）走 stderr + exit 2，永不受输出预算影响；hook additionalContext 走 boundedHookOutput 预算。
5. 哈希链账本 append 必须锁内（读尾算 prev + append 原子）；断链 fail-closed（exit 4）。
6. 写路径预检顺序：秘密路径 → 受保护路径 → symlink 逃逸 → ownedPaths 闸 → knownHashes 并发冲突；fail-visible，不静默放行。
7. 三性（security/safety/privacy）在 waiver/fast/gate 三消费点结构化拒绝，词汇表唯一事实源 = core.mjs PROTECTED_ATTRS（原 common.mjs，经 shim 同址可达）。
8. shim 只做 re-export：`export * from './<新模块>.mjs'`——出现任何实现代码即违例（兼容面不得长行为）。

## Verification 验证

- `npm test`（`node .zcode/scripts/run-tests.mjs` launcher 展开 tests/*.test.mjs；全绿零回归）；`node .zcode/zbase.mjs selftest`（120 模块 × 30k 路径 <2.5s）。
- `node .zcode/zbase.mjs doctor` exit 0；`node .zcode/zbase.mjs receipt verify` exit 0（链完整）；`node .zcode/zbase.mjs arch check` exit 0（七模块界零违例）。
- 改 hooks 行为：`node .zcode/zbase.mjs hook <event>` 管道模拟对应载荷断言 exit code 与输出。
- 改 state/锁/账本：并发用例（tests/concurrency.test.mjs 双进程 updateState 不丢增量）必须仍绿。
- 性能锚点：tests/performance.test.mjs（64 模块/30k 路径合成仓 lint <2.5s、impact <5s、500 untracked fingerprint <3s）抓数量级回归。
