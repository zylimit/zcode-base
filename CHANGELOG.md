# Changelog

本文件记录 zcode-base 的版本史。格式参照 Keep a Changelog；版本号语义见 git tag（回滚点）。治理 CLI：`node .zcode/zbase.mjs <verb>`（零依赖 Node，见 ADR-0003）。

## [v2.0.0] — 2026-09-02（tag：v2.0 六批收官 + CI 四矩阵全绿，b30ad27 起的全部工作面）

- R6 超越层：shell 语义分类器 v2（.zcode/lib/classifier.mjs，tokenizer/wrapper 剥壳/嵌套递归/管道级秘密外传/三档 deny-ask-allow，19 规则 146 自测向量）；自我插桩 effectiveness（闸能说出挡住过什么）；live 路由断言库；三仓教训种子 15 条（feedback 20 条目）。
- v2.0.0 终验收口：catalog/matrix 对齐（arch 116 边零违例）、六属性认领回执、dod 12 步首次全量闭合。
- CI 战役（17 根因清零，windows 130 红→0，四矩阵全绿）：Windows 路径与 HOME 解析（9 个 pathname 反模式文件收编 fileURLToPath；userConfigPath HOME 跨平台优先）；gate.yml dod 前回执自落步；备份文件名 Windows 合法化；make-release MINGW 分支 cygpath 转换 + zip 条目归一 + python cp1252 编码层绕过；git 参数溢出确定性响亮抛；verifyInstalled realpath 短名归一；scan 路径分隔符归一；测试平台守卫与取证基础设施（evidence 全量解析/tap reporter 固定/tests 全禁 .pathname）。
- skills 增补：design-brief-builder（视觉方向采访）新建；dfx-designer 扩 12 维过堂/六要素场景/双模式（Design-in + Review 评分卡）；evolution-engine 扩四层进化（第④层 Skill 自动生成提案）+聚类毕业+UX 三档；bug-fixer 扩修复熔断闸（≥3 次未转绿强制回根因）。
- CI 第二执法缝：`.github/workflows/gate.yml`（ubuntu×windows × node 22/24 矩阵；selftest 先行——引擎先自证才有资格判仓；gates 回执自落；doctor always 诊断）。
- 工程配套：LICENSE（MIT）/ CHANGELOG / .editorconfig / .gitattributes（LF 归一，与 install 哈希比对配套）/ package.json 元数据。
- docs：OPERATING-MODEL / CAPABILITY-MATRIX / ADOPTION / ADR-CONTRACT 四件套 + CROSS-POLLINATION 吸收台账 + 研究报告沉淀（.zcode/docs/research/）+ ADR-0007/0008。

## [v2.0.0-mechanisms] — 2026-09-01（tag：R4 体系机制收口，commit b8b39e6）

- 检查面：skills-lint（含触发式描述③④）/scan-instructions 八规则/rules-audit 三态/test-routing 双向一致/plan-lint/fitness scan 五反模式/managedDrift+bootstrap 警告/FAIL-streak/feedback 引擎化。
- 证据与计划：verification plan（risk×模块×保守扩散×依赖闭包组队+planHash+空计划阻断）；evidence 三重完整性（独立文件+bytes/hash 句柄+逐字节复验）；账本轮转+anchor；retention 引用保护。
- 审查：review 全链引擎化（session/blue/lens/verdict/backlog+stage 门+CoVe verificationQuestion）；completion 完成门聚合（optional FAIL 阻断+scope 匹配）；executor 角色绑定（high 风险须 tester 回执）。
- 发布与安装：release 九条件+dod 12 步+make-release（私人内容剥离+打包后泄漏自验）；install 事务性大合流（staging 备份/逆序回滚/post-verify/三方合并 upgrade/uninstall/safeManagedPath）。
- 结构收口：lib 七模块界重组+module-catalog 禁边执法；tests 三类新增（并发正确性/性能预算/对抗性——账本篡改三态全检出）。

## [v2.0.0-foundation] — 2026-09-01（tag：R3 地基层，commit eb2bf55）

- 引擎核心卫生：PROTECTED 三性（privacy 入保护集）；Fast 贷款语义（reason 必填/8h 封顶/windowId 窗口绑定/SKIPPED 留痕/DEBT 阻断/已执行 FAIL 永不可豁免）；跨进程状态锁+损坏隔离 quarantine；untracked 内容字节入指纹；全局输出脱敏（receipt note/logGate/hook 三出口）；护栏资产软执法+输出预算；Stop 三振按状态分键。
- 写路径预检：工具+shell 写路径提取/apply_patch 解析/symlink 逃逸检测/ownedPaths 闸/knownHashes 并发冲突三态。
- 记忆与同步：budget 四指标+archive append-only；sync-check+3 git hooks（pre-commit 按栈编译门/commit-msg/pre-push）挂 Stop 双缝；嵌套 AGENTS.md（riskTier+agents-lint 四段）；recap/invariants 预算化恢复+SessionStart 注入。

## [v2.0.0-structure] — 2026-09-01（tag：R1 单目录封装，commit 6165b08）

- 脚手架本体全收 `.zcode/` 单目录（lib/skills/commands/feedback/rules/docs/harness；state 运行态 gitignored）；109 项 git rename 保历史；install 单目录化（隔离冒烟 96 文件）；用户级 wrapper 8 处切新路径。

## [1.0.0] — 2026-08-13（commit 004cd02）；hooks 用户级注册 — 2026-08-21（commit 8e2ef89，ADR-0006）

- v1.0 自举：宪法+rules 四件套；治理 runtime（catalog/impact/gate 四态/哈希链账本/回执/7 事件 hook 统一入口）；ZCode 原生面（skills×17/commands×16/feedback 体系）；契约与测试（schemas/templates/verification-matrix）；安装器+FRAMEWORK-MANIFEST；ADR-0001..0005。
- ADR-0006：hooks 注册迁移用户级 `~/.zcode/cli/config.json`（工作区 hooks 会话审核导致门禁长期离线；项目自检 wrapper 放行非 zcode 项目）。
