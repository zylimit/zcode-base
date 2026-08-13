# DEV-PLAN — zcode-base v1.0（自举）

前置: Product-Spec v1.0（Signed）。M 档项目：架构见 docs/ARCHITECTURE.md + ADR×5；DFX 见 module-catalog attributes + verification-matrix。

## Phase 1: 骨架与宪法

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 1.1 | package.json/.gitignore/setup.sh/README | governance | low | 文件存在 + setup.sh --help |
| 1.2 | AGENTS.md 宪法 + rules/ 四件套 | governance | medium | 人工审查（宪法 vs rules 一致性） |
| 1.3 | docs/ ×5 + ADR ×5 | governance | low | adr check 零幽灵引用 |

## Phase 2: 治理 runtime

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 2.1 | 基础设施：common/config/state/git | runtime-harness | high | node --test |
| 2.2 | 契约执法：catalog/impact/context/arch | runtime-harness | high | node --test + selftest <2.5s |
| 2.3 | 证据体系：receipts/waivers/quality/tasks | runtime-harness | critical | node --test（断链/反证用例）|
| 2.4 | 留痕与审计：audit/risk/retention/fitness | runtime-harness | medium | node --test + gate-audit |
| 2.5 | hook 统一入口 hooks.mjs + zbase.mjs CLI | runtime-harness | critical | 7 事件模拟（deny/放行/注入）|

## Phase 3: ZCode 原生面

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 3.1 | .zcode/config.json（7 事件注册） | governance | high | doctor hooks 校验 |
| 3.2 | skills ×17 | skills | medium | 目录/frontmatter 齐全 |
| 3.3 | commands ×16 | commands | low | 命名合规 + $ARGUMENTS |
| 3.4 | feedback 体系（INDEX+5 种子） | feedback | low | INDEX 与条目一致 |

## Phase 4: 契约与测试

| Task | 内容 | 模块 | 风险 | 验证 |
|---|---|---|---|---|
| 4.1 | harness/：catalog/matrix/schemas×6/templates×9 | contracts | medium | catalog lint + schema 自洽 |
| 4.2 | tests/harness.test.mjs | contracts | high | node --test 全绿 |
| 4.3 | 安装器 + FRAMEWORK-MANIFEST | installer | medium | manifest check + install 旁路用例 |

## Phase 5: 终验与收口

| Task | 内容 | 验证 |
|---|---|---|
| 5.1 | 终验链：node --test / doctor / selftest / 7 hook 模拟 / catalog/arch/fitness/quality 自举 | 全绿 |
| 5.2 | manifest generate + progress.md 收口 | manifest check 零漂移 |

## 里程碑

| 里程碑 | 判据 | 回滚点 |
|---|---|---|
| M1 骨架可用 | Phase 1-2 完，CLI verb 全可用 | git tag v0.1.0-skeleton |
| M2 原生面生效 | Phase 3 完，doctor 全绿 | git tag v0.5.0-native |
| M3 v1.0 发布 | Phase 5 终验全绿 + 用户批准 | git tag v1.0.0 |
