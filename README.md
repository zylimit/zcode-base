# zcode-base

综合 harness 开发脚手架。深度吸收 codex-base / cc-base / ccb-base / pi-base / cursor-base / opencode-base / kimi-base 七个家族脚手架的实战经验，严格遵循 ZCode 原生扩展规范（AGENTS.md / `.zcode/config.json` hooks / `.agents/` skills 与 commands），面向 **60W+ 行大规模代码库** 的持续开发。

## 核心能力

| 能力 | 机制 | 入口 |
|---|---|---|
| 需求分析质量 | product-spec-builder + 签字闸 + Spec/CHANGELOG 成对更新 | `/zbase:spec` |
| 架构质量与看护 | module-catalog + arch-check（真实 import 边执法）+ ADR + 幽灵引用检测 | `/zbase:arch` |
| 防架构防腐 | arch baseline 债务棘轮 + arch trend 只紧不松 + 禁边声明 | `node runtime/zbase.mjs arch check` |
| 防开发失控 | 四态门 + 哈希链账本 + Stop 门 + gate-audit 死闸审计 + 有界对抗 | `/zbase:verify` `/zbase:status` |
| 五性治理 | 韧性/安全Security/安全Safety/隐私/可靠性 五维属性档位 + 反证优先覆盖门 | `node runtime/zbase.mjs quality verify` |
| 60W+ 行大仓 | impact 反向闭包 + context-pack 预算打包 + catalog lint + 保守扩张 | `/zbase:impact` `/zbase:context` |
| 经验固化 | feedback 条目（occurrence 计数）→ 进化引擎毕业为规则 | `/zbase:record` |

## 快速开始

### 本仓即脚手架（推荐）

```bash
git clone <zcode-base-url> && cd zcode-base
bash setup.sh          # 生成 FRAMEWORK-MANIFEST + doctor 自检
```

用 ZCode 打开本目录即可：宪法 `AGENTS.md` 自动注入，`.agents/skills/`（17 个）与 `/zbase:*` 命令（16 个）自动发现，`.zcode/config.json` 的 7 个 hook 事件自动生效（硬门禁 + 留痕）。

### 安装到既有项目

```bash
node runtime/zbase.mjs install /path/to/your-project
```

安装器按 FRAMEWORK-MANIFEST 哈希清单做**安全升级**：目标文件等于旧基线才覆盖；已被项目定制的文件旁路为 `<file>.zbase-new` 不改写。绝不触碰项目源码。

## 目录导览

```
AGENTS.md            宪法（核心纪律/派单回执契约/工作流路由/五性红线）
rules/               宪法下沉细则（workflow/orchestration/large-repo/quality-attributes）
.zcode/config.json   hooks 注册（7 事件 → 统一 Node dispatcher，硬门禁）
.agents/skills/      17 个生命周期 Skill（需求→架构→DFX→计划→开发→审查→测试→发布→进化）
.agents/commands/    /zbase:* 16 个治理命令
.agents/feedback/    反馈进化体系（INDEX + 模板 + 种子条目）
harness/             机器可执法契约（module-catalog/verification-matrix/schemas/templates）
runtime/             零依赖 Node 治理 CLI（zbase.mjs + lib/）
docs/                架构文档 + 协议 + ADR
scripts/             gen-manifest / 安装辅助
tests/               node:test 单元与集成测试
.zbase/              运行态（gitignored：账本/门禁日志/证据/任务）
```

## 治理 CLI 一览

```bash
node runtime/zbase.mjs doctor            # 环境自检（目录/hooks/账本/契约一致性）
node runtime/zbase.mjs selftest          # 120 模块 × 3 万路径规模冒烟
node runtime/zbase.mjs task start|status|finish
node runtime/zbase.mjs gate <check>      # 四态门：PASS/FAIL/BLOCKED/SKIPPED
node runtime/zbase.mjs quality status|verify   # 五性覆盖（反证优先）
node runtime/zbase.mjs receipt write|verify    # 哈希链账本（断链 fail-closed）
node runtime/zbase.mjs catalog lint|init
node runtime/zbase.mjs impact            # 反向依赖闭包
node runtime/zbase.mjs context pack      # 预算化上下文打包
node runtime/zbase.mjs arch check|baseline|trend
node runtime/zbase.mjs adr check         # ADR 幽灵引用检测
node runtime/zbase.mjs fitness           # 五性接线审计
node runtime/zbase.mjs risk scan         # 失败连击诊断
node runtime/zbase.mjs gate-audit        # 死闸审计
node runtime/zbase.mjs fast on|off|status
```

退出码契约：`0` 通过；`1` 用法/内部错误；`2` hook 阻断（保留）；`3` 检查发现（lint/arch/quality 失败）；`4` 账本校验失败（篡改/证据腐化）。

## 设计文档

- `docs/ARCHITECTURE.md` — 分层架构与数据流
- `docs/PROTOCOLS.md` — 派单/回执/验证回执/账本/豁免协议
- `docs/QUALITY-ATTRIBUTES.md` — 五性治理深度定义
- `docs/LARGE-REPO-GUIDE.md` — 60W+ 行支持指南
- `docs/ROLE-CONTRACTS.md` — 9 角色契约
- `docs/adr/` — 架构决策记录

## 诚实边界

- Hooks 是护栏不是沙箱：模型仍可能通过未覆盖的命令形式绕过；关键闸口（发布/不可逆操作）以人工审批为准。
- 单模型框架内审查存在同源盲区；高价值变更建议叠加人工审查或红蓝对抗（`red-blue-review` skill）。
- `Stop` 续命最多 3 次（ZCode 原生上限），stop-gate 自身计数封顶 2 次防死循环，耗尽后放行并留痕。
