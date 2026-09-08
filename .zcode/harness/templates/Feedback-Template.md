---
id: <kebab-case-title>
occurrences: 1
graduated: false
date: YYYY-MM-DD
basis: <依据：用户原话一句或触发事件——可追溯到「谁在什么时候说了什么/发生了什么」>
scope: <适用范围：何时适用、何时不适用的边界——过宽的规则会被错误触发，过窄的永不触发>
supersedes: <取代：本条修正了哪条旧条目（填旧条目 id），无取代关系留空>
trace: <溯源：触发事件的日期与上下文（哪次对话/哪个事故/哪个仓）>
---

<!--
  作者规则（feedback-writer 消费，feedback lint 执法）：
  frontmatter = 机器契约（id=文件名 / occurrences / graduated / date + 四新字段）；
  正文 = 人读档案。date 以 frontmatter 为准（正文「日期」行给读者，双轨以 frontmatter 收敛）。
  四新字段（basis/scope/supersedes/trace）对 date ≥ 2026-09-07（B3 生效日）创建的条目必填：
  basis/scope/trace 非空，supersedes 键必须在场（值可空——「没有取代关系」也是回答过这个问题）；
  生效日前的存量条目不追溯填充（旧条目照旧合法，见 feedback-writer 兼容条款）。
  supersedes 非空时：被取代条目不删（append-only 资产），在 FEEDBACK-INDEX 标注被取代关系。
-->

# <kebab-case-title>

- 日期: YYYY-MM-DD（与 frontmatter date 一致）
- 来源: <会话/审查/事故>
- 信号: <触发词或场景>
- occurrence: 1（毕业判据 = 同族失败模式聚类，单条 occurrence 是参考信号——见 evolution-engine）

## 现象

<当时发生了什么，含客观证据（命令输出/exit code/文件路径）>

## 根因

<为什么会这样； distinguish 机制问题 vs 执行问题>

## 规则（可执行表述）

<以后遇到 X 就做 Y；写成能被主 Agent 直接执行的指令，不是态度倡议>

## 执法建议

<可选：是否值得机制化——hook 规则 / runtime 检查 / 流程闸；机制化后就从「自觉」变成「执法」>
