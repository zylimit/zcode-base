---
name: evolution-engine
description: 周期性复盘时使用：评估 feedback 条目毕业（occurrence ≥3）、清理过时规则、提出宪法/rules/机制的修订提案。
---

# evolution-engine：进化引擎

## 触发

- 用户要求复盘/沉淀。
- feedback 条目 occurrence ≥3（INDEX 中标记毕业候选）或聚类毕业达标（见下）。
- 阶段收尾/发版后。

## 四层进化

| 层 | 内容 | 判据 |
|---|---|---|
| ① 经验积累 | feedback-writer/feedback-observer 落条目 | 不靠主 Agent 自觉 |
| ② 规则毕业 | 重复教训升级为宪法/rules/执法机制 | occurrence ≥3，或**聚类毕业**：同一失败模式跨多条 feedback 各 1 次、合计 ≥3 也达标（首例「远端实况实查」式——同族教训分散在各条目里数不到 3 就永不毕业，聚类按失败模式聚合而非按条目计数） |
| ③ Skill 优化 | 某 Skill 来源反馈持续偏低 → 调 Skill 本身 | 定期复盘触发词与流程 |
| ④ Skill 自动生成提案 | 某**操作模式**反复出现（≥5 次）但无 Skill 覆盖 → 提议新建（走 skill-builder） | 从 feedback 条目与 progress 决策流水中找重复模式，不凭印象 |

## 流程

1. **盘点**：读 `.zcode/feedback/FEEDBACK-INDEX.md` 全量条目 + occurrence；`node .zcode/zbase.mjs feedback list` 取毕业候选。
2. **毕业评估**（occurrence ≥3 或聚类达标的候选）：
   - 值得机制化 → 提案 hook 规则 / runtime 检查 / catalog 禁边（最高形态：执法）。
   - 值得进规则 → 提案写入宪法「核心纪律」或 rules/ 对应细则。
   - 只是场景特例 → 合并进相近条目，不膨胀规则。
3. **Skill 层评估**：③ 调优候选 + ④ 新建提案（≥5 次重复模式）——提案走 skill-builder，新建属 HIGH 审批。
4. **规则减脂**：找出从未被引用/已被机制覆盖/互相矛盾的规则，提案删除或合并——规则膨胀是另一种防腐失效。
5. **提案闸**：修订宪法/rules/hook 属 HIGH 审批（存量资产铁律）——列提案清单交用户拍板，不擅自改。
6. 批准后执行修订 + `node .zcode/zbase.mjs manifest generate`（家底文件变了，安装基线同步）+ progress.md 记 Decisions。

## UX 三档（进化动作对用户的可见度）

| 档 | 动作 | 语义 |
|---|---|---|
| 记录无感 | feedback 落条目、occurrence 递增 | 记录不打扰 |
| 轻触提示 | 毕业候选/待处理数播报（一行） | SessionStart 已自动注入，看到即可 |
| 变更确认 | 任何实际修订（毕业/删规则/新建 Skill）逐条经用户确认 | HIGH 审批，不默认执行 |

## 纪律

- 每次进化只做增量修订，不推倒重写（保护血泪迭代的家底）。
- 修订后的风格与原文无缝（禁 AI 味）。
- 拒绝的提案留痕（为何拒绝），防重复评估。

## 回执

毕业/合并/删除清单 + 修订 diff + 用户批准记录。
