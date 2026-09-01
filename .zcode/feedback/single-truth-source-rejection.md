---
id: single-truth-source-rejection
occurrences: 3
graduated: false
---

# single-truth-source-rejection

- 日期: 2026-09-01
- 来源: cc-base（Decisions + research 台账：三次同理由否决）
- 信号: 想引入一个新的状态文件/平行清单记录已被账本记录的东西
- occurrence: 3（拒 cursor quality ledger、拒 task-owned 基线、拒 SubagentStop 机械拦截）

## 现象（事故语境）

cc 三次否决新机制（quality ledger、task-owned 基线、SubagentStop 机械拦截），理由全部相同：与既有单一真相源（receipts/ledger）冲突、误伤率未知——两套真相必漂移，漂移时无法裁决谁对。

## 根因

新状态文件解决了表面问题（记录），却制造了结构问题（双源同步义务）；同步义务无人认领时漂移是时间问题。

## 规则（可执行表述）

引入任何新状态文件前先过「两套真相」关：它与 receipts/ledger/state 是不是同一事实的两个记录？是→扩展既有账本而非新建；否→写明裁决序（谁赢）与同步责任，否则不建。

## 执法建议

ADR 决策模板加一栏「真相源对照」；review backlog/新 state 文件的提案默认携带该栏，缺栏=提案不完整。
