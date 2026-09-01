---
id: config-defects-recur
occurrences: 2
graduated: false
---

# config-defects-recur

- 日期: 2026-09-01
- 来源: cursor-base（feedback: config-defects-recur-across-sibling-instances）+ codex-base（feedback: bug-fix-scan-sibling-config-instances）
- 信号: 「修好了」的判定只覆盖被报告的那一处配置
- occurrence: 2（cursor、codex 各记录一次）

## 现象（事故语境）

cursor/codex 同族教训：配置形缺陷（超时/阈值/路径/模板）在同一设置的每个同类实例中复发——修复报告点只是打了地鼠的第一下；codex 的事故是 hook timeout 共 6 处只修 1 处。

## 根因

完成声明的颗粒度锚在「报修的那个实例」而非「故障类别」；同类实例共享同一份错误模板/值，天然同病。

## 规则（可执行表述）

配置形缺陷的完成声明必须覆盖**故障类别**而非单个实例：判定「这是什么类别的缺陷」→枚举该类别全部实例→逐处修或确认无恙。与 `mem:sibling-config-instances` 同族——本条管判定口径（声明覆盖类别），那条管修复动作（扫全部同类实例并回执列清单）。

## 执法建议

code-review 对「只提单点修复」的配置类 diff 提问同类实例清单；evolution-engine 可评估把「同类实例清单」做成回执必填项的门槛。
