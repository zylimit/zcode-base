# runtime-harness 模块契约（.zcode/zbase.mjs + .zcode/lib/）

riskTier: critical——引擎本体：账本/门禁/锁/写预检。写坏这里 = 证据体系失真，一切下游证明作废。

## Purpose 用途

- 零依赖 Node ≥18 治理 CLI：hook 统一入口（7 事件）、四态门、哈希链账本、task 信封（knownHashes 基线）、
  impact 反向闭包、context-pack 预算打包、recap/invariants 派生摘要、sync-check、budget/archive、doctor/selftest/install。
- 消费方：ZCode 用户级 hooks（~/.zcode/cli/config.json → wrapper → 本入口）、git hooks（.zcode/githooks）、人。

## Boundaries 边界

- 允许触碰：`.zcode/zbase.mjs`、`.zcode/lib/**`。新增机制优先新建小模块（单一职责），不在既有模块里堆叠。
- 禁止触碰：`.zcode/state/**`（运行态，仅经 withStateLock/updateState 状态层访问）、`.zcode/harness/**`（契约面）、
  skills/commands/rules/docs（各自模块）。
- 依赖方向：只依赖 config/common；跨模块 import 保持单向（state ← receipts ← quality ← tasks ← hooks），禁止环。
- 新增 CLI verb 必须同步 zbase.mjs usage 与 README CLI 一览；新增 hook 行为必须更新 tests。

## Invariants 不变量

1. 退出码契约：0 通过 / 1 错误 / 2 hook 阻断 / 3 检查发现 / 4 账本校验失败。引擎任何异常路径不得假绿。
2. 状态写入一律 withStateLock 锁内读-改-写（updateState）；重计算（fingerprint/git/digest）在锁外完成后提交。
3. 所有模型可见/落盘出口先 redactSecrets 再截断（boundedHead/boundedTail/boundedText）；截断静默 = 缺陷。
4. 拒绝（deny）走 stderr + exit 2，永不受输出预算影响；hook additionalContext 走 boundedHookOutput 预算。
5. 哈希链账本 append 必须锁内（读尾算 prev + append 原子）；断链 fail-closed（exit 4）。
6. 写路径预检顺序：秘密路径 → 受保护路径 → symlink 逃逸 → ownedPaths 闸 → knownHashes 并发冲突；fail-visible，不静默放行。
7. 三性（security/safety/privacy）在 waiver/fast/gate 三消费点结构化拒绝，词汇表唯一事实源 = common.mjs PROTECTED_ATTRS。

## Verification 验证

- `npm test`（tests/ 全绿，零回归）；`node .zcode/zbase.mjs selftest`（120 模块 × 30k 路径 <2.5s）。
- `node .zcode/zbase.mjs doctor` exit 0；`node .zcode/zbase.mjs receipt verify` exit 0（链完整）。
- 改 hooks 行为：`node .zcode/zbase.mjs hook <event>` 管道模拟对应载荷断言 exit code 与输出。
- 改 state/锁/账本：并发用例（双进程 updateState 不丢增量）必须仍绿。
