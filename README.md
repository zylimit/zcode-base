# zcode-base

综合 harness 开发脚手架。深度吸收 codex-base / cc-base / ccb-base / pi-base / cursor-base / opencode-base / kimi-base 七个家族脚手架的实战经验，严格遵循 ZCode 原生扩展规范（AGENTS.md / 用户级 hooks / `.zcode/` 单目录封装 skills 与 commands），面向 **60W+ 行大规模代码库** 的持续开发。

## 核心能力

| 能力 | 机制 | 入口 |
|---|---|---|
| 需求分析质量 | product-spec-builder + 签字闸 + Spec/CHANGELOG 成对更新 | `/zbase:spec` |
| 架构质量与看护 | module-catalog + arch-check（真实 import 边执法）+ ADR + 幽灵引用检测 | `/zbase:arch` |
| 防架构防腐 | arch baseline 债务棘轮 + arch trend 只紧不松 + 禁边声明 | `node .zcode/zbase.mjs arch check` |
| 防开发失控 | 四态门 + 哈希链账本 + Stop 门 + gate-audit 死闸审计 + 有界对抗 | `/zbase:verify` `/zbase:status` |
| 五性治理 | 韧性/安全Security/安全Safety/隐私/可靠性 五维属性档位 + 反证优先覆盖门 | `node .zcode/zbase.mjs quality verify` |
| 60W+ 行大仓 | impact 反向闭包 + context-pack 预算打包 + catalog lint + 保守扩张 | `/zbase:impact` `/zbase:context` |
| 经验固化 | feedback 条目（occurrence 计数）→ 进化引擎毕业为规则 | `/zbase:record` |

## 快速开始

### 本仓即脚手架（推荐）

```bash
git clone <zcode-base-url> && cd zcode-base
bash setup.sh          # 生成 FRAMEWORK-MANIFEST + doctor 自检
```

用 ZCode 打开本目录即可：宪法 `AGENTS.md` 自动注入，`.zcode/skills/`（17 个）与 `/zbase:*` 命令（16 个）自动发现，hooks 走用户级注册（`bash setup.sh` 或 install 自动写入 `~/.zcode/cli/config.json`，7 个事件硬门禁 + 留痕，重启会话生效）。

### 安装到既有项目

```bash
node .zcode/zbase.mjs install /path/to/your-project
```

安装器按 FRAMEWORK-MANIFEST 哈希清单做**安全升级**：目标文件等于旧基线才覆盖；已被项目定制的文件旁路为 `<file>.zbase-new` 不改写。绝不触碰项目源码。同时把 8 条 hooks 注册到用户级 `~/.zcode/cli/config.json`（保留既有键，异已 hooks 先备份；含项目自检 wrapper，非 zcode-base 项目静默放行），重启 ZCode 会话后生效（ADR-0006）。

## 目录导览

```
AGENTS.md            宪法（核心纪律/派单回执契约/工作流路由/五性红线）
~/.zcode/cli/config.json  用户级 hooks 注册（7 事件 → 统一 Node dispatcher，硬门禁；install 写入）
.zcode/              脚手架本体单目录（学 dsh .dsh/ 封装哲学，安装面=一个目录+根级种子）
  zbase.mjs          零依赖 Node 治理 CLI 统一入口
  lib/               24 个治理模块（task/gate/quality/receipt/catalog/impact/writes/memory/...）
  githooks/          git 执法缝（pre-commit/commit-msg/pre-push，install --hooks 接线）
  skills/            17 个生命周期 Skill（需求→架构→DFX→计划→开发→审查→测试→发布→进化）
  commands/zbase/    /zbase:* 16 个治理命令
  feedback/          反馈进化体系（INDEX + 模板 + 种子条目）
  rules/             宪法下沉细则（workflow/orchestration/large-repo/quality-attributes）
  docs/              架构文档 + 协议 + ADR
  harness/           机器可执法契约（module-catalog/verification-matrix/schemas/templates）
  scripts/           gen-manifest 清单生成
  state/             运行态（gitignored：账本/门禁日志/证据/任务/研究产物）
tests/               node:test 单元与集成测试
```

## 治理 CLI 一览

```bash
node .zcode/zbase.mjs doctor            # 环境自检（目录/hooks/账本/契约一致性）
node .zcode/zbase.mjs selftest          # 120 模块 × 3 万路径规模冒烟
node .zcode/zbase.mjs task start|status|finish
node .zcode/zbase.mjs gate <check>      # 四态门：PASS/FAIL/BLOCKED/SKIPPED
node .zcode/zbase.mjs quality status|verify   # 五性覆盖（反证优先）
node .zcode/zbase.mjs receipt write|verify    # 哈希链账本（断链 fail-closed）
node .zcode/zbase.mjs catalog lint|init
node .zcode/zbase.mjs impact            # 反向依赖闭包
node .zcode/zbase.mjs context pack      # 预算化上下文打包
node .zcode/zbase.mjs arch check|baseline|trend
node .zcode/zbase.mjs adr check         # ADR 幽灵引用检测
node .zcode/zbase.mjs fitness           # 五性接线审计
node .zcode/zbase.mjs risk scan         # 失败连击诊断
node .zcode/zbase.mjs gate-audit        # 死闸审计
node .zcode/zbase.mjs fast on|off|status
node .zcode/zbase.mjs budget [--staged] # 变更爆炸半径四指标（超限 exit 1）
node .zcode/zbase.mjs archive [--apply] # progress 归档（append-only，历史只移动不删除）
node .zcode/zbase.mjs recap             # 预算化恢复摘要（6000 字符派生）
node .zcode/zbase.mjs invariants        # 不可谈判集 + 活状态（1200 字符）
node .zcode/zbase.mjs sync-check [--staged]  # 三文件同步执法（pre-commit/Stop 双缝）
node .zcode/zbase.mjs agents-lint       # 嵌套模块契约（riskTier high/critical 须四段 AGENTS.md）
```

退出码契约：`0` 通过；`1` 用法/内部错误；`2` hook 阻断（保留）；`3` 检查发现（lint/arch/quality 失败）；`4` 账本校验失败（篡改/证据腐化）。

## 设计文档

- `.zcode/docs/ARCHITECTURE.md` — 分层架构与数据流
- `.zcode/docs/PROTOCOLS.md` — 派单/回执/验证回执/账本/豁免协议
- `.zcode/docs/QUALITY-ATTRIBUTES.md` — 五性治理深度定义
- `.zcode/docs/LARGE-REPO-GUIDE.md` — 60W+ 行支持指南
- `.zcode/docs/ROLE-CONTRACTS.md` — 9 角色契约
- `.zcode/docs/adr/` — 架构决策记录

## 诚实边界

- Hooks 是护栏不是沙箱：模型仍可能通过未覆盖的命令形式绕过；关键闸口（发布/不可逆操作）以人工审批为准。
- 单模型框架内审查存在同源盲区；高价值变更建议叠加人工审查或红蓝对抗（`red-blue-review` skill）。
- `Stop` 续命最多 3 次（ZCode 原生上限），stop-gate 自身计数封顶 2 次防死循环，耗尽后放行并留痕。
