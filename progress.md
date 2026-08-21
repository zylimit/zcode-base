# progress

## Pinned（长期约束）

- 宿主 = ZCode；只用原生扩展点（AGENTS.md/.agents/用户级 hooks），规范源 = zcode-guide 官方 skills。
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
- 2026-08-21 hooks 注册迁用户级 ~/.zcode/cli/config.json（ADR-0006）——工作区 hooks 每会话弹审核且无批量同意，门禁实测长期离线；用户级无审核即生效，wrapper 自检放行非 zcode 项目；doctor 双通道校验，工作区模式不堵死——用户拍板「迁移吧」。

## Done（完成流水）

- 2026-08-13 Phase 1-4 全量交付：宪法/rules×4、runtime（zbase.mjs+lib×19）、.zcode hooks 注册、skills×17、commands×16、feedback×6、docs×5+ADR×5、harness 契约（catalog/matrix/schemas×6/templates×9）、自举 Spec/PLAN。
- 2026-08-13 终验全绿：tests 21/21；doctor 16 项全 PASS（归类 104 路径）；selftest 120 模块×30k 路径 722ms（预算 2500ms）；7 hook 事件模拟（deny/additionalContext/放行）全部符合契约；matrix 8 项门禁全 PASS 落账（receipt #9-16）；quality verify ok（covered 7 / blocking 0）；arch check 零违例（7 条真实边全声明，空基线起步）；adr check 零幽灵引用；install 双向验证（首装 94 文件 + 定制旁路 .zbase-new + 目标 doctor 全绿）；manifest 95 文件零漂移。
- 2026-08-21 hooks 用户级迁移落地：本机手工迁移（8 条 wrapper 双环境冒烟：zbase 项目透传/无 runtime 静默 exit 0）+ 工作区 .zcode/config.json 清空；脚手架同步（implementer 子代理）：install 新增 registerUserHooks()（只覆写 hooks 键/mcp 保留/幂等/原子写/损坏 fail-visible）+ doctor 双通道 + tests 24→25 用例 + manifest 重生成（96 文件）；code-reviewer 三阶段审查裁定 FIX_REQUIRED 仅 F1（覆写第三方 hooks 无备份，已修复：异已 hooks 整文件备份 config.json.bak-zbase-<ts> + report 可见告警 + 2 用例断言）；文档同步 6 处矛盾 + ADR-0006 + ADR 索引。终验新鲜证据：tests 25/25 exit 0；doctor ok exit 0（hooks 用户级通道 PASS）；manifest check ok exit 0（96 tracked）；adr check ok exit 0（6 ADR 零幽灵）。备份集中 ~/.zcode/backups/（工作区+用户级各一份，含回滚材料）。已知边界：wrapper 与备份文件名 POSIX-only（Windows 不适用，ADR-0006 声明）。

## Next（下一步）

- 重启 ZCode 会话实测：确认无「待审核」提示、SessionStart 注入恢复上下文（用户级 hooks 生效的最终证据）。
- git push + 打 tag（v1.0.0 或并入后 v1.1.0）——remote 未配置，待用户提供地址；hooks 迁移变更已提交本仓（2026-08-21）。
- 二期候选：插件发行面（OQ-1）、hook 严格 JSON schema 实测校准（OQ-2）、模块胶囊补全（harness/modules/）。

## Open Issues（未决）

- OQ-1 双形态（插件发行面）二期评估（Spec OQ-1）。
- OQ-2 hook 严格 JSON schema 字段名待客户端实测确认（当前保守契约已可用）。
