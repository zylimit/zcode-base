---
name: evolution-engine
description: 周期性复盘时使用：评估 feedback 条目毕业（occurrence ≥3）、清理过时规则、提出宪法/rules/机制的修订提案。
---

# evolution-engine：进化引擎

## 触发

- 用户要求复盘/沉淀。
- feedback 条目 occurrence ≥3（INDEX 中标记毕业候选）。
- 阶段收尾/发版后。

## 流程

1. **盘点**：读 `.zcode/feedback/FEEDBACK-INDEX.md` 全量条目 + occurrence。
2. **毕业评估**（occurrence ≥3 的候选）：
   - 值得机制化 → 提案 hook 规则 / runtime 检查 / catalog 禁边（最高形态：执法）。
   - 值得进规则 → 提案写入宪法「核心纪律」或 rules/ 对应细则。
   - 只是场景特例 → 合并进相近条目，不膨胀规则。
3. **规则减脂**：找出从未被引用/已被机制覆盖/互相矛盾的规则，提案删除或合并——规则膨胀是另一种防腐失效。
4. **提案闸**：修订宪法/rules/hook 属 HIGH 审批（存量资产铁律）——列提案清单交用户拍板，不擅自改。
5. 批准后执行修订 + `node .zcode/zbase.mjs manifest generate`（家底文件变了，安装基线同步）+ progress.md 记 Decisions。

## 纪律

- 每次进化只做增量修订，不推倒重写（保护血泪迭代的家底）。
- 修订后的风格与原文无缝（禁 AI 味）。
- 拒绝的提案留痕（为何拒绝），防重复评估。

## 回执

毕业/合并/删除清单 + 修订 diff + 用户批准记录。
