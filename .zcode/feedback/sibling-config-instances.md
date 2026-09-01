---
id: sibling-config-instances
occurrences: 2
graduated: false
---

# sibling-config-instances

- 日期: 2026-09-01
- 来源: codex-base（feedback: bug-fix-scan-sibling-config-instances，hook timeout 修了 6 处中 1 处）+ cursor-base（feedback: config-defects-recur-across-sibling-instances）
- 信号: 配置形缺陷（超时/阈值/路径/模板）只修了报告的那一处
- occurrence: 2（codex、cursor 各记录一次）

## 现象（事故语境）

codex 的 hook timeout 事故：同类配置共 6 处，修复只改了被报告的 1 处——其余 5 处同病未愈，随后逐一复发。cursor 记录同型教训：配置形缺陷在同一设置的每个同类实例中复发，只修报告点=打地鼠。

## 根因

修复动作的颗粒度停在「报修单」而非「缺陷类别」；同类实例共用同一份错误模板/值。

## 规则（可执行表述）

修配置形缺陷后必须搜全部同类实例（同事件族/同值/同模板），逐处修或逐处确认无恙；回执列出查过的每个实例——没列实例清单的完成声明不算覆盖故障类别。

## 执法建议

回执信封 Verified 段落要求列同类实例清单（派单 Verification 字段预先点名）；与 `mem:config-defects-recur` 同族——那条管判定口径，本条管修复动作。
