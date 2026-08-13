# LARGE-REPO-GUIDE — 60W+ 行大仓支持

> 细则入口 `rules/large-repo.md`。性能基准参考 cursor-base 同级实现实测（600k 行/30k 文件/120 模块）。

## 1. 核心思想：定向，不全仓

60W 行仓库的上下文装不下也读不完。三板斧：

1. **归类**（catalog）：路径→模块的显式映射，是影响分析的事实源。
2. **影响**（impact）：改动→受影响模块→反向依赖闭包（谁会被我波及）。
3. **预算**（context pack）：按预算打包，读胶囊不读实现。

## 2. catalog 设计指南

- 模块粒度：一个团队/一个发布单元/一个清晰职责域。120 模块是舒适区，300+ 时考虑分层归组。
- globs 精确：避免大 `**` 吃掉半仓库；`catchAll` 慎用（每次命中都 degraded）。
- `ignored` 显式排除：.git/.zbase/node_modules/构建产物/生成代码（生成代码另立 classification=generated）。
- deps 只声明**直接**依赖；传递闭包由工具算。
- 禁边 `forbidden` 用于防腐红线（如 analytics 不得依赖 pii-store）。

## 3. impact 使用

```bash
node runtime/zbase.mjs impact                      # git 变更路径 → 闭包
node runtime/zbase.mjs impact --paths src/a.ts,b/  # 指定路径
```

输出 `affected`（直接受影响）+ `fanout`（含传递消费者）。**验证范围 ≥ fanout**。

degraded 触发条件与处置（保守扩张铁律）：

| 信号 | 处置 |
|---|---|
| unmapped 路径 | 先补 catalog；来不及补 → 全模块 fanout |
| catchall/global 命中 | 全模块 fanout |
| truncated（>10 万路径） | 全模块 fanout + 报告坏测量 |

## 4. context pack 使用

```bash
node runtime/zbase.mjs context pack            # 默认 120K chars
node runtime/zbase.mjs context pack --budget 80000
```

- 打包优先级：task-diff 文件 > 模块胶囊 > 公共契约（catalog/matrix）> 邻近文档。
- DENY 永不入包：.git/.zbase/node_modules/.env*/密钥/dist/build/coverage/lockfile。
- truncated=true → 关键文件被预算挤掉，提高预算或收窄 Scope。
- 模块胶囊（`harness/modules/<name>.md`）是 60W 行仓的上下文货币——维护胶囊比维护全量文档便宜得多。

## 5. 性能设计要点（runtime 内置）

- glob→RegExp 编译缓存（同一 glob 只编译一次）。
- git 路径 `-z` NUL 分隔（中文/空格文件名安全）。
- `maxTrackedPaths` 默认 100,000，超出截断按坏测量处理（保守 fanout）。
- `selftest` 冒烟：120 模块 × 30,000 路径 lint < 2.5s、impact 闭包 < 100ms。

## 6. 并行开发

- 单 writer 资产：共享契约/schema/迁移/lockfile/生成物/公共 manifest——不并行，串行收口。
- 并行写：独立 worktree + 互斥 ownedPaths + integration owner 收口合并。
- 合并顺序：多线齐 → 集成分支跑全量回归 → 绿才进主干。
