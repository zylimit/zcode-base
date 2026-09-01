---
id: main-agent-no-direct-coding
occurrences: 4
graduated: false
---

# main-agent-no-direct-coding

- 日期: 2026-08-13
- 来源: 家族脚手架跨仓实践；2026-09-01 复发记录来自 cc-base A1（no-direct-code-guard 硬拦闸）
- 信号: 主 Agent 自己写代码/自己审自己/自己测自己；上下文被实现细节撑爆
- occurrence: 4（毕业：已进宪法纪律 3/4）

## 现象

主 Agent 亲自编码后：审查与测试由同一上下文完成（共同盲区）；主 Agent 上下文被代码细节淹没，编排质量下降；验收以自述为准。

## 根因

角色不隔离导致「自己检查自己」；实现细节不必进编排者上下文。

## 规则

编码/审查/测试/部署四环节主 Agent 一律委派 fresh 子代理，只写派单（六字段）+ 验收（客观证据）；子代理不再派子代理；写测者≠被测作者。

## 执法建议

已进宪法 + rules/orchestration.md（派单/回执契约）；文档类（Spec/progress）不受此约束。

### 2026-09-01 复发（cc-base A1）：硬拦前先走台账模式

cc-base 把本条做成 PreToolUse(Edit|Write) 硬拦截（框架文件正则放行 + 业务源码路径命中即 exit 2 + gate-log 留痕），但留有未解宿主歧义：**用户级 hooks 是否对子代理（Agent 工具内）的工具调用触发**——若触发，implementer 子代理写 `src/` 会被同一条规则拦死。zcode 对应决策（Task 10.3）：**主 Agent 直接写业务码应记 gate-log（台账执法先行，不硬拦）**，硬拦形态待 OQ-4（ZCode 子代理触发域）实测后再接线；宪法纪律 3 已加句尾括注标注该接线条件。
