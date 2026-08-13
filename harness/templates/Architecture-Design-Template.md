# Architecture-Design — <项目名>

版本: v0.1 ｜ 状态: Draft | Signed ｜ 日期: YYYY-MM-DD

## 1. 需求映射

| Spec 条目 | 架构承接 |
|---|---|
| REQ-1 | … |

## 2. 分层与模块

```
<层级图：layers 自上而下，依赖只许向下>
```

模块清单落 `harness/module-catalog.json`（M/L 档项目在此阶段产出骨架并 `catalog lint` 通过）。

## 3. 关键决策（ADR 索引）

| 决策 | ADR |
|---|---|
| … | docs/adr/0001-… |

## 4. 接口契约

<公共 API / 事件 / 数据 schema；破坏性变更流程>

## 5. 五性承接（DFX 前置）

| 属性 | 档位 | 初步手段 |
|---|---|---|
| 韧性 | … | … |

## 6. 大仓策略

- 预估规模：文件数/行数/模块数
- 归类策略：catchAll 是否启用、global 列表
- 单 writer 资产：共享契约/schema/迁移/lockfile

## 签字

- [ ] 用户确认（批的是当前这版内容；变更须重新请批）
