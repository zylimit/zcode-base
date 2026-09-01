# ADR-0007: 脚手架单目录封装（.zcode/）

- 状态: Accepted
- 日期: 2026-09-01
- 决策人: zcode-base（v2.0 R1，用户指令「不计成本、大规模重构、比 dsh 更好」）
- Enforced-by: doctor, selftest

## 背景

v1.0 布局把治理资产散布在多个根级目录（`.agents/` skills+commands、`runtime/` 引擎、`.zbase/` 运行态、根级 rules/docs），造成三重复杂：安装面要枚举多根、全路径引用跨目录切换（55+ 文件）、`.gitignore` 排除面分散。dsh-base 的 `.dsh/` 单目录哲学证明：安装面=一个目录+根级种子，漂移=一个 manifest，忽略=一个 state，三件事各只有一个真相源。

## 决策

1. 脚手架本体全收 `.zcode/`：lib（引擎）/skills/commands/feedback/rules/docs/harness（schemas+templates+catalog+matrix）/githooks；`.zbase/` → `.zcode/state/`（gitignored 运行态：账本/回执/证据/任务/fast）。
2. 安装面收敛为 `MANAGED_ROOTS=['.zcode']`（排除 state/）+ 根级种子（AGENTS.md 根对根、progress.md 从模板种入）；FRAMEWORK-MANIFEST 基线按实际安装面生成。
3. 用户级 hooks wrapper 指向 `.zcode/zbase.mjs`（8 处 wrapper 已切新路径，备份后迁移）；`.zcode/config.json` 工作区配置保留为空对象基线（ADR-0006 双通道语义不变）。
4. 109 项变更走 git mv 保历史；全路径引用切换后 `grep runtime/zbase.mjs` 零残留。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 保持多根布局 | 一次性 109 项迁移成本 vs 长期三面（安装/引用/排除）复杂——每个新机制都要在 N 个根间对齐 |
| `.agents/` 跨工具通用路径（v1.0 现状） | 宿主即 ZCode，深绑优于泛化；跨工具抽象只会两边都做不深（codex「撤销双宿主」同源教训） |
| 引擎与治理资产分目录（codex 维护面/运行面物理分入口） | 本仓单引擎单入口（zbase.mjs verb 分组）够用；分入口适合有 npm pack 发布面的仓 |

## 后果

- 正面：装一个目录、验一个 manifest、忽略一个 state；安装/漂移/排除三个面各只有一个真相源。
- 负面：迁移是一次性成本；git 历史 `--follow` 在低相似度改名处断链（已记录两条可达实路：原地扩展文件全链可达 + 旧路径 `git log` 完整保留）。

## 执法方式

`doctor`（install --verify 子进程校验安装副本；managedDrift 按 FRAMEWORK-MANIFEST 对 `.zcode/` 面逐文件 LF 归一化 digest 比对；hooks wrapper 路径校验）与 `selftest`（单目录引擎自证，120 模块×3 万路径合成 fixture）执行本决策；`manifest generate|check`（FRAMEWORK-MANIFEST 维护）配套留痕。
