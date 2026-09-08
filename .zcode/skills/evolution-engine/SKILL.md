---
name: evolution-engine
description: 周期性复盘时使用：评估 feedback 条目毕业（判据=同族失败模式聚类）、清理过时规则、提出宪法/rules/机制的修订提案。
---

# evolution-engine：进化引擎

## 触发

- 用户要求复盘/沉淀。
- feedback 条目出现同族失败模式聚类达标（见四层进化②），或单条 occurrence 攒高（参考信号）。
- 阶段收尾/发版后。

## 毕业判据（B3 修正）

**主判据 = 同族失败模式聚类**：跨条目识别同一根因的失败模式，同族合计 ≥3 即可合并毕业（按失败模式聚合，不按条目计数）——同族教训分散在各条目各 1 次，按条目数就永不毕业。
**单条 occurrence ≥3 降为参考信号**，不单独触发毕业——数字可审计≠数字承载价值（对齐教训 `spec-overfitting-quantitative`：把毕业钉死在计数上，执行方凑够数字即算毕业，真实模式识别被牺牲）。单条高 occurrence 提示「该条目频发」，仍须归入同族分析后才构成毕业理由。

## 四层进化

| 层 | 内容 | 判据 |
|---|---|---|
| ① 经验积累 | feedback-writer/feedback-observer 落条目 | 不靠主 Agent 自觉 |
| ② 规则毕业 | 重复教训升级为宪法/rules/执法机制 | 同族失败模式聚类合计 ≥3（见「毕业判据」节）；occurrence 数为参考信号 |
| ③ Skill 优化 | 某 Skill 来源反馈持续偏低 → 调 Skill 本身 | 定期复盘触发词与流程 |
| ④ Skill 自动生成提案 | 某**操作模式**反复出现（≥5 次）但无 Skill 覆盖 → 提议新建（走 skill-builder） | 从 feedback 条目与 progress 决策流水中找重复模式，不凭印象；新建/重大改版须经验收对（TDD 红锁必做，A/B 盲评可选——见 skill-builder「改版验收」） |

## 流程

1. **盘点**：读 `.zcode/feedback/FEEDBACK-INDEX.md` 全量条目 + occurrence；`node .zcode/zbase.mjs feedback list` 取单条高频候选（机器只数单条 occurrence——同族聚类判断在本步做：按根因/规则面给条目分族，同族合计 ≥3 的族整体进候选）。
2. **毕业评估**（同族聚类达标或单条高频的候选）：
   - 值得机制化 → 提案 hook 规则 / runtime 检查 / catalog 禁边（最高形态：执法）。
   - 值得进规则 → 提案写入宪法「核心纪律」或 rules/ 对应细则。
   - 只是场景特例 → 合并进相近条目，不膨胀规则。
   - 落地标记 → 批准毕业后条目 frontmatter 改 `graduated: true` + `graduatedAt: <日期>` + `graduatedTo: <机制落点一句话>`，FEEDBACK-INDEX 对应行同步（`feedback lint` 契约：graduated 缺失/非 bool 即 error）。
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
