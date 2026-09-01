---
id: gate-earns-place
occurrences: 1
graduated: false
---

# gate-earns-place

- 日期: 2026-09-01
- 来源: cc-base（CLAUDE.md:280 + feedback: gates-need-empirical-validation）
- 信号: 一道闸长期全绿、零拦截记录，但仍以「安全」为由留着
- occurrence: 1

## 现象（事故语境）

cc 立场：闸靠数据留不靠感觉留——长期全绿零拦截的闸应简化或删（「加闸要能说出它挡住过什么」）。留着没挡过任何东西的闸，成本是误伤、维护与注意力的持续消耗。

## 根因

闸的存废凭「感觉安全」而非拦截台账；无数据的保守=不可证伪的保守。

## 规则（可执行表述）

每道闸定期过 effectiveness 账：说不出挡住过什么的闸（unexercised）要么补证据（真实拦截场景演练），要么简化/裁撤——裁撤留痕，需要时再加回来。

## 执法建议

zcode 已接线：`zbase effectiveness`（Task 10.2）按 gate-log 派生每规则 deny/observe/allow+unexercised 清单；evolution-engine 周期复盘消费该报告做闸的增删裁决。
