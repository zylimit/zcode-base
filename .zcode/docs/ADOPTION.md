# 安装与启用（ADOPTION)

怎么把 zcode-base 装进一个仓：三种起点，同一个引擎，只是启用顺序不同。治理 CLI：`node .zcode/zbase.mjs <verb>`（零依赖 Node ≥20）。

## 0. 前置与总开关

| 前提 | 核验 |
|---|---|
| Node ≥20、git 工作树、引擎完好 | `node .zcode/zbase.mjs selftest` exit 0（引擎先自证）再 `doctor` 看 failing 清单 |
| 项目宪法在场 | 仓库根 `AGENTS.md`（install 会种入；嵌套契约由 agents-lint 把关） |
| 治理已启用 | `.zcode/harness/module-catalog.json` 存在且可解析 |

**catalog 是开关**：无 catalog 时所有依赖 catalog 的子命令 exit 3（degraded）并明说——什么都不静默通过。小仓这是合法稳态（skills/宪法/skills-lint/selftest/doctor 照常工作）；`node .zcode/zbase.mjs catalog init` 出草案（dry-run 默认，`--apply` 落盘），补齐 needsDecision 决策项再启用。

运行态 `.zcode/state/`（账本/回执/证据/任务）已随 `.zcode/.gitignore` 排除——回执是机器本地态，不随分支旅行。

安装器行为（一次装全部治理资产）：幂等（重跑拷 0 文件）；永不覆盖他方定制（写 `<file>.zbase-new` 旁路待人审）；内容比对 LF 归一化（CRLF checkout 不误报）；事务性（失败逆序回滚+post-verify+install-receipt）；`--dry-run` 全程零写；`--verify` 先 stage 再测；`--hooks` 接线 git hooks（core.hooksPath）；批量 `--targets-from FILE`（单目标失败不中断批次）。ZCode 会话 hooks（7 事件硬门禁）注册进**用户级** `~/.zcode/cli/config.json`（ADR-0006：工作区 hooks 有会话审核，门禁会长期离线）；项目自检 wrapper 保证未装本项目时静默放行。

## A. 全新项目

1. 空仓跑 `node /path/to/zcode-base/.zcode/zbase.mjs install <repo>`，先 commit 再写业务码。
2. 先写 Product-Spec.md（product-spec-builder）；M/L 档依次 arch-designer → dfx-designer。
3. 写 module-catalog：打算建的模块 + layers + forbiddenDependencies + riskTier，模块可以先于代码存在。
4. 第一天就声明八属性档位（后补远贵于先行）；每个 critical/high 档在 verification-matrix 接认领检查。
5. 跑 `node .zcode/zbase.mjs dod`——新仓应在一个下午内到 exit 0，然后保持住。

## B. 既有绿地（约 <5 万行，结构已知）

1. 按 A 的 1-2 装好（不碰业务码）。
2. `catalog lint`——预期 UNMAPPED（exit 3）：把每个 tracked 路径归入 modules/ignored/global。**禁 catch-all**（`*`/`**` 是 error：绿门后面每个文件都逃脱定向验证）。
3. 把已有检查（单测/lint/typecheck/扫描器）接进 verification-matrix：每条写清它真能证明（proves）的属性，并从 modules[].verification 引用。
4. `arch check` 读漂移清单：便宜的修掉、真实的声明，然后 `arch baseline` 冻结。
5. 补写存量决策的 ADR（Enforced-by 按 [ADR-CONTRACT.md](ADR-CONTRACT.md) 解析）。
6. 开 CI（gate.yml：selftest 先行 → doctor → skills-lint → catalog lint → npm test → manifest check → dod）。

## C. 百万行棕地（顺序即启用序，每步只在前一步成立后开始）

1. **先装不启用**：复制 `.zcode/` + `AGENTS.md`，不建 catalog。`doctor`（enabled:false 态）+ `selftest` exit 0 核验。
2. **写最小 catalog**：30-150 个**按业务域命名**的模块（billing/pricing/fulfilment，不是按目录），带 paths/riskTier/owners，别的先不填。<30 定不了位，>150 手工维护不动。
3. **catalog lint 至 unmapped=0**：ignored 归 vendor/生成物/二进制树；global 只给真正横切的构建与 CI 文件（global 保持极小——global 变更触发保守全 fanout）。
4. **冻结存量债**：`arch baseline`——预期大量 undeclared，这正是一次测量（它变成数字，不再是感觉）。
5. **棘轮进 CI**：`arch trend` 只在指标超过历史最优时失败——存量债容忍、新债不收。
6. **先给最高危模块声明属性**：钱/个人数据/认证/物理不可逆。其余先不声明——虚假的 critical 接不上线只会教人无视门。
7. **每个阻断属性接一个认领检查**：每个 critical/high 声明，加一条 proves 含该属性的检查并挂进模块 verification；`node .zcode/zbase.mjs fitness` 先验接线，再跑全量 gate。
8. **高危模块嵌套 AGENTS.md**：四段（Purpose/Boundaries/Invariants/Verification）；ZCode 在该目录读写时自动加载——最便宜的边界契约。agents-lint 对 high/critical 缺契本报 error。
9. **开 hooks 与 CI**：ZCode 会话 hooks（install 注册用户级）+ `install --hooks`（git hooks）+ CI。CI 自己落回执（回执机器本地，不随分支旅行）。
10. **才开始用九阶段循环**做变更（[OPERATING-MODEL.md](OPERATING-MODEL.md)）。

`catalog lint` 报 4 万 unmapped 时：这是**一条**带计数的 error，不是 4 万个问题。禁 catch-all；按顶层目录分桶排序（通常 20 个目录覆盖 80% 路径），先 ignored 后 modules 迭代；期间 exit 3 是预期态不要压制——unmapped 未清零前 impact 全 fanout 并标 degraded，验证昂贵但**永不假绿**。

## Day one / Week one / Month one

| 时窗 | 做到 | 机器证明 |
|---|---|---|
| Day 1 | 引擎装好、AGENTS.md 在场、（棕地：catalog 未建） | `selftest` exit 0、`doctor` failing 除 catalog 外为空、`skills-lint` exit 0 |
| Week 1 | catalog 30-150 模块、unmapped=0、架构基线已冻结、棘轮进 CI | `catalog lint` 0、`arch baseline` 已跑、CI `arch trend` 0 |
| Month 1 | 高危模块属性声明+接线、ADR 带 Enforced-by、嵌套契约落地、每次 merge gate 绿 | `fitness` 0、`adr check` 0、`agents-lint` 0、`dod` 0 |

时窗是规划目标不是度量。本文装机制；[OPERATING-MODEL.md](OPERATING-MODEL.md) 跑循环；[CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md) 记录刻意不做什么。
