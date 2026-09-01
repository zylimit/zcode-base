# DEV-PLAN — <项目名>

版本: v0.1 ｜ 前置: Product-Spec（已签字）+ Architecture-Design（M/L 档已签字）+ DFX-Spec

## 阶段规划

### Phase 1: <名称>（目标一句话）

| Task | 内容 | 模块 | 风险 | 验证 | Expected（期望输出） |
|---|---|---|---|---|---|
| 1.1 | … | <module> | low | <command + expect> | <跑完应该看到什么：比 Verification 多一层阳性断言，如「每个注册 event 恰好对应一个 command hook」> |
| 1.2 | … | | | | |

- Phase 完成闸: `/zbase:verify` 全绿 + `quality verify` 无 blocking + 用户确认

### Phase 2: …

## 计划自检（dev-planner 出口前）

- [ ] 每个 Task 一个可独立验收切片（>60min 预估 = 拆）
- [ ] 每个 Task 有 Verification（命令+期望）与 Expected（期望输出的阳性断言）
- [ ] 依赖顺序正确（被依赖方先做）
- [ ] 单 writer 资产（共享契约/schema/迁移/lockfile）不并行
- [ ] 大仓项目：Task 标注受影响模块（impact 结果）

## 里程碑与回滚点

| 里程碑 | 判据 | 回滚方式 |
|---|---|---|
| M1 | … | git tag / release artifact |
