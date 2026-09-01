---
name: feedback-writer
description: 用户给出修正、批评、改进意见，或 UserPromptSubmit hook 注入反馈信号提醒时必须使用。把反馈落成结构化条目。
---

# feedback-writer：反馈记录

## 触发

- 用户说出修正/批评/改进意见（「不对」「错了」「应该」「又出现」「上次说」…）。
- UserPromptSubmit hook 注入 `[zcode-base] 检测到修正/反馈信号` 提醒——**处理完用户请求后必须调用本 skill，不可忽略**。

## 流程

1. 处理完用户当前请求（先解决问题，再记录）。
2. 判断信号类型：流程问题 / 技术判断错误 / 机制缺口 / 偏好。
3. 写条目到 `.zcode/feedback/<kebab-case-title>.md`（模板：`.zcode/harness/templates/Feedback-Template.md`）：
   - 现象（客观证据：命令输出/exit code/文件路径，不含 PII/密钥）
   - 根因（机制问题还是执行问题）
   - **规则（可执行表述**：「以后遇到 X 就做 Y」，不是态度倡议）**
   - 执法建议（是否值得机制化：hook 规则/runtime 检查/流程闸）
4. 已有同类条目 → occurrence +1（不新建重复文件）。
5. 更新 `.zcode/feedback/FEEDBACK-INDEX.md`（条目/occurrence/毕业状态）。

## 毕业机制

- occurrence ≥3 → evolution-engine 评估毕业：进宪法/rules/机制化（hook 或 runtime 检查）。
- 机制化的反馈从「自觉」变「执法」，是最高形态。

## 纪律

- 不记录空泛感受（「用户不太满意」）；只记录可复现的问题与规则。
- 条目风格贴合现有条目（无缝，禁 AI 味元叙事）。
