# 七家族仓快扫（agy/ccb/codewhale/grok/kimi/opencode/pi，2026-09-08）

方法：cc-base `.claude/research/` 五仓二手分析（agy/grok/opencode/pi/cursor）+ ccb/codewhale/kimi 三仓直接扫描（README/宪法/目录/引擎头部/skills 清单）；对照 zcode-base 现状（含 2026-09-07/08 两日落地的业务脊柱/tier 盘/engineIdentityHash 等）。

## 结论速览

- **agy-base**：净增量仅 lockfile 版本锁纪律一条（再生 lockfile 前提取原头部精确版本再 lock）。其余为演示级 stub 或已有等价。
- **grok-base**：无实质增量（三层角色契约依赖 Grok 原生 spawn 面；.cmd 生成器被 Node 单实现架构性免疫）。
- **opencode-base**：TDD-for-Skills（skill 域的 red-locks 镜像）、BLOCKED 四路升级阶梯（禁同模型无变化重试的处置手册）、.task/ 会话临时目录规范——三条低成本候选。
- **pi-base**：旗舰已被全量吸收且多数超越。无增量。
- **ccb-base**：跨模型异构对抗审（reviewer-codex 审 coder-claude）是结构护城河但单宿主补不回（红蓝+lens 是既定补偿）；ralph 自愈环违反 HIGH 档人类行为哲学明确不要；release-provenance 机读边车小增量。
- **codewhale-base**：**运行态溯源检查**（真实回滚事故产物：发布产物为镜像时逐文件 md5 对比运行容器 vs git HEAD，旧镜像无 OCI label=不可溯源，有差异禁重建先热补入库）——receipt 链之后部署面最后一公里。
- **kimi-base**（同源度最高但 2026-09 ADR 密集，真增量最多）：**审计独立性禁边**（ADR-0002：CI 审计脚本与引擎刻意双实现禁 import 引擎，catalog forbiddenDependencies+静态测试执法——「引擎缺陷无法让审计沉默」；zcode 现状 CI 跑 zbase 自审自身+账本引擎写引擎验，是现有体系唯一反共谋缝缺口）；**可提交证据模式**（ADR-0009：evidence.mode committed——回执/账本可选入 git，evidence 日志只记 sha256，CI/换机 receipt verify 验链免全量重跑）；**planned 需求生命周期**（ADR-0011：REQ planned 标记仍过全量 lint、排除 trace 覆盖分母、被测试引用即警、Phase DoD 摘标记——spec-first 与 trace 绿兼得）；CLI 契约注册表（每 verb 冻结参数界单源派生——zbase SUBCOMMAND_FLAGS 已有雏形）；skill A/B 盲评（docs/evals：新旧两版跑同场景独立会话匿名盲评+量化指标——skill 变更的经验证验收）。

## Next 候选（按价值排序，全部待拍板不开工）

1. **kimi 审计独立性禁边**——补强账本可信根（引擎写引擎验的反共谋缺口）
2. **kimi 可提交证据模式**——CI/换机验链免重跑（「恢复意图恢复不了证据」的对称补）
3. **kimi planned 需求生命周期**——规格立项与实现落地的机制缝合
4. **codewhale 运行态溯源检查**——部署面最后一公里（真实事故产物）
5. **skill 改版验收对**——opencode TDD-for-Skills（防回归）+kimi A/B 盲评（证增益），evolution 第④层缺的验收方法

备选：agy lockfile 版本锁、opencode BLOCKED 升级阶梯+.task/ 规范、ccb release-provenance 边车、kimi CLI 契约注册表全量化。
明确不吸收：ccb 跨模型对抗/daemon/tmux/ralph 自愈、grok 三写 hook/.cmd 生成器、agy PreInvocation 口号注入、各仓宿主原生面（Cron/AgentSwarm/secondary_model/workflows runtime——宪法规则 4 宿主能力红线）、pi path lease（已有「缓」裁决）。
