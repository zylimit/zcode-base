# FEEDBACK-INDEX

反馈条目索引。occurrence ≥3 = 毕业候选（evolution-engine 评估机制化或进规则）。条目格式见 `.zcode/harness/templates/Feedback-Template.md`；新条目由 feedback-writer skill 写入。

| 条目 | 主题 | occurrence | 毕业 |
|---|---|---|---|
| completion-claims-need-fresh-verification | 完成声明必须走五步闸（新鲜证据） | 3 | 已机制化：receipt fingerprint + Stop 门 |
| red-locks-the-bug | 缺陷先锁失败测试再修 | 3 | 已进规则：rules/workflow.md |
| three-file-sync-clearable-recap-recovery | 三文件即时同步，恢复才可靠 | 3 | 已进宪法：项目事实与恢复 |
| destructive-ops-recheck-live-state | 远端/生产写操作前当场实查 | 3 | 已进宪法：纪律 8 |
| main-agent-no-direct-coding | 主 Agent 只编排不编码 | 4 | 已进宪法：纪律 3（台账执法待 OQ-4 后接线，cc A1 留档） |

以下 15 条为 2026-09-01 三仓研究种子注入（Task 10.4，DEV-PLAN Phase 10；来源与事故语境见各条目正文，均提取自 `.zcode/state/research/` 三篇增量报告，非虚构）：

| 条目 | 主题 | occurrence | 毕业 |
|---|---|---|---|
| multi-repo-commit-isolation | 多仓提交逐仓独立验收（codex：耦合脚本「半成功」烂局） | 1 |  |
| preserve-brand-assets | 清理前盘点品牌资产，删除需确认（codex：Logo 误删从 git 历史恢复） | 1 |  |
| waiver-lifecycle-explicit | 临时豁免带日期定界+到期显式关闭（codex：3 条豁免 12 天后才关干净） | 3 | 毕业候选：waiver 五要素已含 expiry，增量是到期显式关闭留痕 |
| main-agent-verifies-key-sources | 子代理研究后主 Agent 亲读关键材料（codex：native-subagent-research） | 1 |  |
| metric-gaming-warning | agent 定义量化成功指标会被博弈——撤回（cc：specification overfitting） | 1 |  |
| sibling-config-instances | 配置形缺陷修完全部同类实例，回执列清单（codex：hook timeout 6 处修 1 处；cursor 同型） | 2 |  |
| watching-hung-process-is-hope | 等挂起进程是最贵的希望；「还活着」不是进度（cursor：long-batch 止损信号） | 1 |  |
| uptime-misleads | 部署验收读创建时间戳/镜像 tag 非 uptime（cursor：旧进程滞留误导） | 1 |  |
| tag-check-remote-first | 打 tag 前先 ls-remote 查远端（cc：曾打出冲突 tag） | 1 |  |
| hook-schema-instability | hook 输入 schema 跨版本不稳——读外部可验证状态（cc：.tool_exit_code 永假；关联 OQ-2） | 1 |  |
| gate-earns-place | 长期全绿零拦截的闸应简化或删（cc：闸要能说出它挡住过什么） | 1 | 已接线数据面：zbase effectiveness（Task 10.2） |
| read-deep-not-surface | 查证的关键是读到位，不被表层覆盖（cc：五步闸两起翻车存档） | 2 |  |
| single-truth-source-rejection | 新状态文件先过「与账本是否两套真相」关（cc：三次同理由否决） | 3 | 毕业候选：ADR 加真相源对照栏 |
| spec-overfitting-quantitative | 回执/验收指标钉死数字牺牲真实质量——定性 DoD（cc：决策应用面） | 1 |  |
| config-defects-recur | 完成声明覆盖故障类别而非单个实例（cursor/codex 同族，与 sibling-config-instances 互补） | 2 |  |

## 状态说明

- 已机制化/已进规则的条目保留原文作为根因档案；新 occurrence 只更新计数。
- 删除/停用条目属 HIGH 审批（存量资产铁律）。
- 种子条目的 occurrence 按来源仓记录次数（Task 10.4 约定）；≥3 的两条（waiver-lifecycle-explicit / single-truth-source-rejection）为毕业候选，由 evolution-engine 评估且毕业须用户确认。
