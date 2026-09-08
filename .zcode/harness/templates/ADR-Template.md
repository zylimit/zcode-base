# ADR-NNNN: <标题>

- 状态: Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- 日期: YYYY-MM-DD
- 决策人: <谁拍板>
- 真相源: <本决策所依赖事实的权威文件/命令——写明哪个文件/哪条命令是这件事的真相（如 `.zcode/lib/quality.mjs` 现状或 `node .zcode/zbase.mjs receipt verify` 输出），本 ADR 从它推导>
- Enforced-by: <机器执法检查名，如 arch check / catalog lint / fitness / adr check>（必须真实存在，幽灵引用会被 `adr check` 拦截）

<!-- 真相源作者规则：日期 ≥ 2026-09-08 的新 ADR 缺「真相源」行会被 `adr check` 判 error；
     值内反引号包裹的仓内路径会被实存校验（指向虚空=error）；占位形态（尖括号整值包裹=本模板
     原文没改）与空值同样 error；命令/URL 形态只查非空。 -->

## 背景

<为什么现在要决策：约束、痛点、触发事件>

## 决策

<拍板结果，可执行、可验证的表述>

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| A | … |
| B | … |

## 后果

- 正面：…
- 负面/代价：…
- 需要跟进：…

## 执法方式

<声明由哪个检查落地：module-catalog 禁边 / layers / verification-matrix 检查 / hook 规则。引用必须能被 `node .zcode/zbase.mjs adr check` 解析。>
