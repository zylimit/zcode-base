# <模块名> 模块契约

> 四段骨架（agents-lint 校验）：Purpose / Boundaries / Invariants / Verification。
> riskTier ∈ {high, critical} 的模块目录必须放置本契约（宿主自动按目录注入）；
> 正文保持精简（≤12000 bytes）——检查优先于常驻文本，写不清的约束应该变成检查而不是再加一段话。

## Purpose 用途

- 本模块解决什么问题、属于哪一层、谁是消费方。（一段说清，不超过 5 行）

## Boundaries 边界

- 允许触碰：路径/职责范围。
- 禁止触碰：越界目标（其他模块的内部、全局配置、运行态数据……）。
- 依赖方向：可依赖谁、被谁依赖（与 module-catalog deps 一致）。

## Invariants 不变量

- 永远为真的约束（退出码契约、锁与原子写、脱敏边界、fail-visible……）。
- 违反任何一条 = 缺陷，不是风格问题。

## Verification 验证

- 本模块的行为证明方式：命令 + 期望输出（node --test / doctor / lint / receipt）。
- 改动本模块必须跑的最小检查集。
