# Product-Spec — zcode-base

版本: v1.0 ｜ 状态: Signed（自举基线） ｜ 日期: 2026-08-13

## 1. 定位

综合 codex-base / cc-base / ccb-base / pi-base / cursor-base / opencode-base / kimi-base 七个家族脚手架经验，构建遵循 ZCode 原生扩展规范的 harness 开发脚手架：git clone 即用 + 安装器安全升级，支撑 60W+ 行项目开发。

## 2. 用户故事

- 作为开发者，我在 ZCode 打开装了 zcode-base 的项目，宪法自动生效、17 个 Skill 自动触发、危险操作被硬拦，无需手工配置。
- 作为架构师，我声明 module-catalog 后，架构违例被机器执法（新债零容忍、存量棘轮），ADR 幽灵引用被拦截。
- 作为质量负责人，我给模块定五性档位，未覆盖的 critical/high 属性阻断任务收口；security/safety 永不可豁免。
- 作为维护者，我用安装器把脚手架升级到项目，已定制文件自动旁路不改写。

## 3. 功能需求

| 编号 | 需求 | 验收 |
|---|---|---|
| REQ-1 | 宪法自动注入（AGENTS.md） | ZCode 打开项目即加载；规则与 rules/ 指针一致 |
| REQ-2 | 17 个生命周期 Skill 自动触发 | frontmatter name+description 齐全；doctor 校验目录 |
| REQ-3 | 16 个 /zbase:* 治理命令 | 命名合规（^[a-z0-9][a-z0-9_:-]{0,63}$）；$ARGUMENTS 替换 |
| REQ-4 | 7 事件 hooks 硬门禁+留痕 | 危险命令 exit 2；全部拦截写 gate-log；doctor 校验注册 |
| REQ-5 | 治理 CLI（零依赖 Node≥18） | node runtime/zbase.mjs 全 verb 可用；无 npm 依赖 |
| REQ-6 | 哈希链账本 | 断链/篡改 exit 4；fingerprint 防证据腐化 |
| REQ-7 | 五性覆盖门（反证优先） | 同属性 PASS+FAIL=uncovered；blocking 拦 task finish |
| REQ-8 | 架构棘轮 | 新违例 exit 3；baseline 放行存量；trend 只紧不松 |
| REQ-9 | 大仓三板斧 | 30k 路径 lint <2.5s；impact 闭包正确；context DENY 永不入包 |
| REQ-10 | 死闸审计 | gate-audit 输出 denied=0 规则清单 |
| REQ-11 | 安装器安全升级 | 目标定制文件旁路 .zbase-new；未定制覆盖 |
| REQ-12 | 进化引擎 | feedback 条目 occurrence 计数；≥3 毕业评估 |

## 4. 非功能需求（五性初档，细化见 module-catalog）

- 可靠 critical（runtime 账本/门禁正确性）；安全 high（拦截不误放）；隐私 high（DENY 路径）；韧性 high（断链 fail-closed）；Safety none+reason（纯软件工具）。

## 5. 边界（Out of Scope）

- 不做多模型跨进程编排（ccb 形态）；不做 IDE 插件；不做 CI 平台集成（提供 CLI 供 CI 调用）；不内置 MCP server（hook+CLI 已覆盖，留作演进）。

## 6. 开放问题

- OQ-1: 插件发行面（双形态）是否值得做 → 二期评估。
- OQ-2: hook 输出的严格 JSON schema 字段名以客户端实测为准（当前用退出码+additionalContext 保守契约）。

## 变更记录

见 `Product-Spec-CHANGELOG.md`。
