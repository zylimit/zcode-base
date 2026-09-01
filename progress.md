# progress

## Pinned（长期约束）

- 宿主 = ZCode；只用原生扩展点（AGENTS.md/.zcode/用户级 hooks），规范源 = zcode-guide 官方 skills。
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
- 2026-09-01 dsh-base 深研吸收（Spec v1.1，REQ-13..31，DEV-PLAN Phase 6-8 三批）：privacy 入永不可豁免保护集、Fast 改贷款语义（reason 必填/8h 封顶/DEBT 阻断）、recap+invariants 恒定成本恢复、sync-check+git hooks 补三文件同步执法缝、嵌套 AGENTS.md 模块契约、review 全链引擎化（结构化分歧）、八属性六档、需求追溯；fleet 多仓层暂缓（OQ-3）——用户指令「学习 dsh-base 优化 zcode-base 做到最好」；研究依据 .zcode/state/research/dsh-base-mechanisms.md（422 行源锚点报告）。
- 2026-09-01 升级为 v2.0 大重构（Spec v2.0，REQ-32..34）：单目录封装 .zcode/（学 dsh .dsh/ 哲学，安装面=一个目录+根级种子）、三缝执法（ZCode hooks+git hooks+CI）、自我插桩超越层（检查有效性计数——dsh 报告自评「治理处方几乎全部未被度量」正是缺口）；放弃 .agents/ 跨工具通用路径（宿主即 ZCode，深绑优于泛化）；DEV-PLAN 重排 R1-R6 六批，R1 纯结构迁移先行——用户指令「不计成本、大规模重构、比 dsh 更好」。并行三路家族仓增量研究（cursor/codex/cc-base，产出 .zcode/state/research/*-delta.md）+ 联网输入（agents.md 标准、Martin Fowler SDD 对比、OpenAI 治理 Cookbook）。
- 2026-09-01 cursor-base 增量裁决（报告 .zcode/state/research/cursor-base-delta.md）：①fast mode 之争两案叠乘——保留 dsh 贷款四条件 + 叠加铁律「已执行的 FAIL 永不可 fast 豁免」（跳过未运行≠豁免已证缺陷），超越两家；②增量并入批次：R3=withStateLock 状态锁/redactSecrets 输出脱敏/task known_hashes 写前冲突检测（纪律 2 执法化）/quarantine 隔离/boundedHead·PASS 静默·空计划 BLOCKED 杂项；R4=账本轮转+anchor/retention 引用保护/FAIL-streak 根因重定向/feedback 引擎化 lint/install 三方合并 upgrade·uninstall+safeManagedPath/waiver Compensation·Approval/性能锚点测试+256MB maxBuffer；R5=adapters 八属性证据供给侧/runtimeValidityHours 时间窗/plan_sha256；R6=shell 语义解析器+管道级秘密外传检测；③立场吸收：「检查优先于常驻文本」为宪法体量标尺、progress 模板加 Not doing 段、教训库不随 install 旅行、config 形缺陷同类实例复发必搜（feedback 种子）；④service 监督不整体移植（摘 probeHealth 语义 + 重启风暴熔断教训）。
- 2026-09-01 codex/cc 增量裁决（codex-base-delta.md 473 行 / cc-base-delta.md 265 行）：①缺陷修复级必做（R3）——跨进程状态锁（两仓独立同证）、untracked 内容入指纹（WIP 期证据绑定盲区）、全局输出脱敏 13 类（receipt note 现原样落 token）；②最高价值（R4）——verification plan（该跑什么=impact 确定性函数+planHash）、evidence 三重完整性、executor 角色绑定（一行执法宪法第 4 条）、completion 完成门聚合、install 事务性三仓合流；③cc 会话闸门（R3）——three-file-sync 挂 Stop/recap-on-dirty/check-evolution 播报/按栈编译门；plan-lint/skill 触发式描述③④/test-routing 双向一致性/CoVe verificationQuestion（R4）；make-release 泄漏自验（R4）、adapters 表（R5）、design-brief/dfx 12 维六要素/evolution 第④层/修复熔断（R5）；④R6 旗舰=shell 语义分类器 v2 四仓融合（tokenizer+管道外传+融合参数+三档决策+match/notMatch 自测向量）；⑤明确不做——service 监督（三仓共识拒绝）、auto-push、SubagentStop 机制（ZCode 无此事件已查证）、sh/ps1 双写（Node 免疫）、path lease（缓）；⑥新 OQ-4/OQ-5；⑦关键教训——量化指标否决（specification overfitting）、审查承重墙是外部证据非对抗形式、双真相源拒斥。
- 2026-09-01 R1 结构重构完成（M4 里程碑）：脚手架本体全收 .zcode/（lib×19/skills×17/commands×16/feedback/rules/docs/harness/state 运行态 gitignored）；109 项变更 git rename 保历史；55+ 文件路径切换零残留；install 单目录化（隔离冒烟 96 文件）；manifest 99 文件零漂移。主 Agent 新鲜验收：npm test/doctor/selftest 0.21s/manifest/hook 全 exit 0；用户级 wrapper 8 处已切 .zcode/zbase.mjs（双环境冒烟过）。DEV-PLAN v2.0 定稿：Phase 7=13 Task 地基（R3）、Phase 8=11 Task 体系（R4）、Phase 9=6 Task 扩展（R5）、Phase 10=5 Task 超越+终验（R6），每 Task 标源仓锚点。

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
