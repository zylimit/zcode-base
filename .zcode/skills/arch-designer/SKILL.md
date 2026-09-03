---
name: arch-designer
description: M/L 档项目进入架构设计、需要模块划分/分层/技术选型/ADR 决策，或 module-catalog 需要建立与修订时使用。
---

# arch-designer：架构设计

## 目标

产出与代码互相执法的架构：Architecture-Design.md（人读）+ module-catalog.json（机器执法）+ ADR（决策留痕）。架构不被执法就是装饰。

## 七大原则

1. 单一职责：模块只有一个变化的理由。
2. 依赖向下：layers 声明自上而下，依赖只许向下（arch check 执法）。
3. 显式契约：公共接口进 MODULE-CAPSULE，不靠口口相传。
4. 高内聚低耦合：一起变的放一起，不一起变的隔开。
5. 最小知识：模块只认识直接依赖，反向依赖闭包交给 impact 工具。
6. 失败隔离：单模块劣化不级联（对应韧性档位）。
7. 演进友好：破坏性变更有流程（ADR + 消费者核对），不是悄悄改。

## 流程

1. 读已签字 Spec；大仓项目先 `node .zcode/zbase.mjs catalog init` 看草案（dry-run 默认；采纳须 `--apply` 写盘）。
2. 模块划分 → 逐模块填 `.zcode/harness/module-catalog.json`：name/globs/deps/layer/attributes（五性档位建议，DFX 阶段细化）/reason。
3. 声明禁边 `forbidden`（如 analytics 禁碰 pii-store）与 layers。
4. `node .zcode/zbase.mjs catalog lint` 零错误；存量仓 `node .zcode/zbase.mjs arch check` 有违例 → 评估后 `arch baseline` 固化为已知债务（棘轮：新债零容忍）。
5. 关键决策逐个写 ADR（`.zcode/harness/templates/ADR-Template.md` → `.zcode/docs/adr/NNNN-*.md`），Enforced-by 引用真实检查（`adr check` 拦幽灵引用）。
6. 核心模块写 MODULE-CAPSULE（`.zcode/harness/modules/<name>.md`）。
7. 架构签字闸：用户确认当前版本。

## 架构看护（持续职责）

- 需求变更影响模块边界 → 同步修订 catalog + ADR。
- 定期 `arch trend`：债务只许减不许增。
- 新模块必须先入 catalog 再动代码（unmapped 会触发保守 fanout，代价是全量验证）。

## 回执

Architecture-Design.md + catalog（lint 通过证据）+ ADR 清单 + 基线债务数 + 待签字项。
