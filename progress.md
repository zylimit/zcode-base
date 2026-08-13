# progress

## Pinned（长期约束）

- 宿主 = ZCode；只用原生扩展点（AGENTS.md/.agents/.zcode/config.json），规范源 = zcode-guide 官方 skills。
- runtime 零依赖 Node ≥18（ADR-0003）；hooks 单 dispatcher（ADR-0001）；账本哈希链 fail-closed（ADR-0002）。
- security/safety 永不可豁免；Fast Mode 不豁免安全护栏。
- 家族资产保留复用：本仓七仓经验精华见 docs/ARCHITECTURE.md 与各 rules 头部来源标注。

## Decisions（决策流水）

- 2026-08-13 选 Workspace 布局+安装器形态（弃插件包：marketplace 摩擦大、skill 优先级最低）——用户拍板。
- 2026-08-13 硬门禁+留痕为默认强度（弃观察模式起步）——用户拍板。
- 2026-08-13 子代理角色契约放 docs/ROLE-CONTRACTS.md 而非 manifest agents 字段——zcode 记录但不执行该字段，诚实声明优于假装执行。
- 2026-08-13 hook 输出契约用退出码（0/2）+ additionalContext JSON——规避严格 schema 未知字段风险。
- 2026-08-13 commands 用嵌套目录 zbase/<verb>.md → /zbase:verb——Windows 文件名不允许冒号。
- 2026-08-13 git 路径枚举用 -z NUL 分隔（-z 已是无转义原始输出，无需 quote-path 选项）。
- 2026-08-13 Stop 门自计数封顶 2（ZCode 原生上限 3，留 1 次余量防死循环）。

## Done（完成流水）

- 2026-08-13 Phase 1-4 全量交付：宪法/rules×4、runtime（zbase.mjs+lib×19）、.zcode hooks 注册、skills×17、commands×16、feedback×6、docs×5+ADR×5、harness 契约（catalog/matrix/schemas×6/templates×9）、自举 Spec/PLAN。
- 2026-08-13 终验全绿：tests 21/21；doctor 16 项全 PASS（归类 104 路径）；selftest 120 模块×30k 路径 722ms（预算 2500ms）；7 hook 事件模拟（deny/additionalContext/放行）全部符合契约；matrix 8 项门禁全 PASS 落账（receipt #9-16）；quality verify ok（covered 7 / blocking 0）；arch check 零违例（7 条真实边全声明，空基线起步）；adr check 零幽灵引用；install 双向验证（首装 94 文件 + 定制旁路 .zbase-new + 目标 doctor 全绿）；manifest 95 文件零漂移。

## Next（下一步）

- 用户批准后 git push + 打 tag v1.0.0。
- 二期候选：插件发行面（OQ-1）、hook 严格 JSON schema 实测校准（OQ-2）、模块胶囊补全（harness/modules/）。

## Open Issues（未决）

- OQ-1 双形态（插件发行面）二期评估（Spec OQ-1）。
- OQ-2 hook 严格 JSON schema 字段名待客户端实测确认（当前保守契约已可用）。
