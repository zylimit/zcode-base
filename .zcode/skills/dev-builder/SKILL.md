---
name: dev-builder
description: Product-Spec 与 DEV-PLAN 就绪，用户要求开始或继续实现某个 Phase/Task 时使用。含大仓六步法与受影响验证。
---

# dev-builder：开发实现

## 目标

按已确认的 Spec 和 DEV-PLAN 交付最小、可验证的代码切片。既有项目的架构、目录、语言规范、依赖约定优先；不强推框架/目录/行数指标。

## 流程

per-Task 闭环权威程序（恢复与圈定→建立任务→派 implementer 只改 Scope→受影响验证落账→三 Stage 审查→task finish 收口+三文件同步）见 `rules/workflow.md`——大仓六步法见 `rules/large-repo.md`。本 skill 只记实现环节特有纪律：

### 建立任务

复杂/跨模块/中高风险 Task 先建任务账：

```bash
node .zcode/zbase.mjs task start --input task.json   # 七字段信封（含 Business），见 harness/templates/Task-Brief-Template.md
node .zcode/zbase.mjs context pack                   # 预算化上下文
```

- `Business:` 字段从 Spec 业务上下文 / DEV-PLAN「价值/未知」列摘 2-3 句，**不自行编造**——编出来的业务语境是把理解漂移合法化（task start 只拦空值，拦不住编造，这条靠纪律）。
- 实现中发现业务理解反例（代码事实/边界数据/用户插话与信封 Business 冲突）→ 走 Escalation 交回主 Agent（Spec 层裁决），不就势硬改、不把错误理解打死在信封里——信封是理解快照，不是合同。
- 大仓（module-catalog 存在）：unmapped/shared/global/truncated 结果必须保守扩大验证范围（rules/large-repo.md）。

### 实现纪律（主 Agent 派 implementer，不亲手编码）

- 只改 Scope/owned paths；遵循 Existing Pattern（最近的现有模式）。
- 公共接口稳定；破坏性变化先核对消费者 + 用户决策。
- 禁止：空 catch、默认成功、静默重试、无调用方的兼容层。
- 行为变化处理相应错误/空态/边界/权限/并发路径。
- 未授权不 commit/push/publish/deploy/装依赖/杀进程。

### 验证与收口

- 受影响验证按 Task 的 Verification 逐条跑（全量、全新，不复用旧输出）；落账 `node .zcode/zbase.mjs receipt write --check <name> --status PASS|FAIL --note "<证据>"`；审查与缺陷 red-locks 走 `rules/workflow.md` per-Task 闭环第 5 步。
- 收口：`node .zcode/zbase.mjs task finish`（quality verify 反证门拦截未覆盖属性）→ 三文件同步（宪法铁律）→ 回执信封六字段收尾。

## 纪律

- 测试由独立 tester 写（写测≠被测作者）；implementer 只做最小实现配套。
- 失败连击 3 次停手诊断（`node .zcode/zbase.mjs risk scan`），不换个写法硬重试。
- Fast Mode 开启时：跳过自动 review/test，安全护栏照旧，用户显式要求的检视照做。
