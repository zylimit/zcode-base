# Review Receipt — <task-id> / <review-round>

## 审查范围

- diff: <commit range / 文件清单>
- Spec 引用: <REQ/Task 条目>

## Stage 0 — 静态闸

- [ ] lint/format 零新增告警
- [ ] 无调试残留（console.log/debugger/注释掉的代码块）
- [ ] 无密钥/PII 硬编码

结论: PASS / FAIL（FAIL 则修复后**从 Stage 0 重审**）

## Stage 1 — Spec 合规

- [ ] 实现与 Spec 条目逐条对上（列对照表）
- [ ] Out of Scope 未越界
- [ ] 错误/边界/空状态路径已处理

结论: PASS / FAIL

## Stage 2 — 代码质量

- [ ] 遵循 Existing Pattern（最近现有模式）
- [ ] 无空 catch / 静默吞错 / 无调用方的兼容层
- [ ] 公共接口稳定性核对（消费者已核对）

结论: PASS / FAIL

## Findings

| # | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | P1/P2/P3 | file:line | … | … |

## 对抗轮次

- 轮次: <n>/2（封顶 2 轮，到顶转 deferred：问题/严重度/为何不修/负责人）
- red-locks: 缺陷是否已先锁定失败测试: 是/否

## 裁定

- [ ] ACCEPT（三 Stage 全过）
- [ ] FIX_REQUIRED（列修复项）
- [ ] NEEDS_MORE_EVIDENCE（列补证命令）
