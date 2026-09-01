# contracts 模块契约（.zcode/harness/）

riskTier: high——机器可执法契约：module-catalog / verification-matrix / schemas / templates。
错契约 = 全仓误判（impact/quality/fitness 全部以此为准），且错误会随 install 分发到目标项目。

## Purpose 用途

- 声明治理事实：模块边界（module-catalog：globs/deps/attributes/riskTier）、检查面板（verification-matrix：
  checks 命令/proves/scope/tier）、数据形态（schemas ×6）、起步骨架（templates）。
- 消费方：catalog/lint/impact/quality/fitness/agentslint 等引擎模块；安装器（templates 种入目标项目）。

## Boundaries 边界

- 允许触碰：`.zcode/harness/**`。契约变更 = 治理语义变更，须有对应 DEV-PLAN Task 或用户指令背书。
- 禁止触碰：`.zcode/lib/**`（引擎）、`.zcode/state/**`（运行态）、根级四文档（governance 模块）。
- module-catalog.json 是归类的唯一事实源；不在引擎里复制 globs/词汇表（防双真相源漂移）。

## Invariants 不变量

1. schema 与实例一致：改 module-catalog 字段（如 riskTier）必须同步 module-catalog.schema.json 与 catalog lint 校验。
2. riskTier ∈ low/medium/high/critical；high/critical 模块目录必须有四段 AGENTS.md（agents-lint 执法，缺 = error）。
3. attributes 档位 critical/high 必须有认领检查（verification-matrix proves），否则 fitness 接线缺陷。
4. verification-matrix 检查命令必须可独立执行、退出码可判；声明 allowFastSkip 的检查不得 proves 三性。
5. templates 只做骨架不做事实：模板内容种入目标项目后归目标项目所有，升级永不覆盖定制（install 旁路机制）。
6. JSON 文件保持 2 空格缩进 + 尾随换行（manifest LF 哈希契约）。

## Verification 验证

- `node .zcode/zbase.mjs catalog lint` exit 0（含 riskTier 合法值与 tracked 归类审计）。
- `node .zcode/zbase.mjs agents-lint` exit 0（本模块 contracts=high 与 runtime-harness=critical 的四段契约在场）。
- `node .zcode/zbase.mjs manifest check` exit 0（新增/修改契约文件必须 manifest generate 后零漂移）。
- 改 matrix 后跑 `npm test`（quality/gate 用例消费 matrix 声明）。
