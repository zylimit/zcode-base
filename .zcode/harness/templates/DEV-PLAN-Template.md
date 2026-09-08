# DEV-PLAN — <项目名>

版本: v0.1 ｜ 前置: Product-Spec（已签字）+ Architecture-Design（M/L 档已签字）+ DFX-Spec

<!--
  作者规则（dev-planner 消费）：Phase 排序 = 价值交付与关键未知优先，不只依赖正序——
  最先做能验证关键未知（OQ/技术风险）或最早交付可感业务价值的最小切片，
  依赖正序只在同价值档内作 tie-break；纯依赖正序会把「理解错误最后才暴露」埋进时间表。
  「价值/未知」列是派单信封 Business 字段的来源之一（连同 Spec 业务上下文）。
-->

## 阶段规划

### Phase 1: <名称>（目标一句话）

| Task | 内容 | 模块 | 风险 | 验证 | Expected（期望输出） | 价值/未知 |
|---|---|---|---|---|---|---|
| 1.1 | … | <module> | low | <command + expect> | <跑完应该看到什么：比 Verification 多一层阳性断言，如「每个注册 event 恰好对应一个 command hook」> | <交付什么业务价值 / 依赖 OQ-N 哪个未决项> |
| 1.2 | … | | | | | |

- Phase 完成闸: `/zbase:verify` 全绿 + `quality verify` 无 blocking + 用户确认

### Phase 2: …

## 计划自检（dev-planner 出口前）

- [ ] 每个 Task 一个可独立验收切片（>60min 预估 = 拆）
- [ ] 每个 Task 有 Verification（命令+期望）与 Expected（期望输出的阳性断言）
- [ ] 每个 Task 有「价值/未知」锚点（业务价值或 OQ 依赖，至少一项写实）
- [ ] Phase 排序按价值交付与关键未知优先（不只依赖正序）
- [ ] 依赖顺序正确（被依赖方先做）
- [ ] 单 writer 资产（共享契约/schema/迁移/lockfile）不并行
- [ ] 大仓项目：Task 标注受影响模块（impact 结果）

## 里程碑与回滚点

| 里程碑 | 判据 | 回滚方式 |
|---|---|---|
| M1 | … | git tag / release artifact |
