---
description: 记录一条反馈/教训到 .zcode/feedback/（结构化 + occurrence 计数）。
argument-hint: "[现象+根因+规则一句话]"
---

# /zbase:record

1. 调用 feedback-writer skill。
2. 内容：$ARGUMENTS
3. 产出 `.zcode/feedback/<kebab>.md`（现象/根因/可执行规则/执法建议）+ 更新 FEEDBACK-INDEX（同类 occurrence +1）。
4. occurrence ≥3 的条目提示 evolution-engine 毕业评估。
