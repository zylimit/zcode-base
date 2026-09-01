---
name: dfx-designer
description: 架构定稿后需要为八属性（韧性/安全Security/安全Safety/隐私/可靠/可用/性能/可维护）定档、定义可验收指标，做 DFX 设计期过堂或 DFX 评分卡评审，或 DFX-Spec 需要修订时使用。
---

# dfx-designer：12 维 DFX 设计与评审

## 目标

把质量属性从口号变成可验收指标：DFX-Spec.md（人读）+ module-catalog attributes（机器执法）+ verification-matrix 认领检查。本 skill 双模式：**Design-in**（设计期前移定档，产出 DFX-Spec）/ **Review**（对既有架构出评分卡）。口径详见 `.zcode/rules/quality-attributes.md`。

## 依赖检测

- Product-Spec.md 缺失 → 先路由 product-spec-builder。
- Architecture-Design.md 缺失 → 全局定档，标注「待架构设计后按模块细化」；有则按模块定档（推荐先跑 arch-designer）。
- module-catalog.json 存在 → 定档直接写 modules[].attributes；不存在 → 只出文档。
- 已有 DFX-Spec.md + 用户说「评审」→ 进 Review 模式。

## 第一性原则

- **可度量或不写**：拒绝「高可靠、高性能」空话——每条 DFX 需求必须给出「数字 + 单位 + 测法」；写不出的诉求退回重问，不替用户编。
- **场景化提需（六要素）**：来源 / 刺激 / 环境 / 制品 / 响应 / 响应度量——场景才可测，形容词不可。例：「支付高峰期（环境）下游超时（刺激）时，订单模块（制品）应降级排队并在 30s 内恢复（响应），错误率 <0.1%（响应度量）」。
- **档位经济学**：一刀切的严格度是缺陷。按模块 × 维度定六档（critical/high/medium/low/minimal/none），none/minimal 必须给书面理由——原型不该背支付系统的成本。
- **取舍显性化**：维度互相打架（性能↔可维护、成本↔可靠、安全↔可服务）——冲突处逼用户排 DFX 优先级栈，记录**被牺牲方与理由**，不许「都要」。
- **验证闭环**：每条需求写明验证落点（认领检查/工具/测试/闸/人工评审）——没有验证落点的条目是许愿不是设计。

## 12 维过堂清单

每维四句：软件语境定义 → 典型度量 → 设计对策 → 验证落点。逐维过堂，不适用的标 N/A + 理由。

| # | 维度 | 软件语境定义 | 典型度量 | 设计对策 | 验证落点 |
|---|---|---|---|---|---|
| 1 | 安全 Security | 防未授权访问/破坏/篡改 | 高危漏洞数=0、依赖 CVE 关闭时限 | 最小权限、输入消毒、密钥外置、审计日志 | 认领检查（扫描器/fitness no-secret-literal）→ attributes.security |
| 2 | 安全 Safety | 失效不伤人/设备/物理环境（涉物理世界必填，纯信息系统可 none+理由） | 危险失效率、fail-safe 默认覆盖率 | 简版 FMEA（每关键功能问「坏了伤到什么」）、双重确认、安全默认值 | 专项测试/评审 → attributes.safety |
| 3 | 隐私 Privacy | 个人数据收集/使用/存储/销毁合规 | PII 字段清单覆盖率、日志 PII 零泄漏 | 数据分级、最小收集、匿名化、隐私边界模块化 | fitness no-pii-in-logs/脱敏检查 → attributes.privacy |
| 4 | 韧性 Resilience | 故障后的恢复力 | MTTR、RTO/RPO、高峰错误率 | 有界重试+退避、熔断、限流、超时预算 | 混沌/降级演练、负载检查 → attributes.resilience |
| 5 | 可靠 Reliability | 规定条件与时间内持续稳定 | MTBF、错误率、数据一致性校验通过率 | 幂等、事务边界、输入校验、不吞错 | 回归测试套件 → attributes.reliability |
| 6 | 可用 Availability | 需要时能服务 | 可用率 9x、计划外停机时长 | 冗余、健康探针、优雅维护窗口 | SLO 探针/监控检查 → attributes.availability |
| 7 | 性能 Performance | 响应时间/吞吐/资源占用 | P95/P99 延迟、QPS、内存上限 | 预算分解（每层延迟预算）、缓存、批处理 | 负载测试/基准检查 → attributes.performance |
| 8 | 可维护 Maintainability | 变更成本随时间不发散 | 典型变更触碰文件数、undeclared 边数趋势 | 单一职责、契约稳定、公共库下沉 | arch check 棘轮/code-review → attributes.maintainability |
| 9 | 可服务性 Serviceability | 出事时运维看得见/定位得了/干预得动 | 故障定位时间、告警误报率 | 结构化日志、健康端点、诊断命令 | 运维演练（deployer 三件套核验）→ availability 佐证 |
| 10 | 可安装性 Installability | 装得上、升得了、卸得净 | 全新安装步数/时长、回滚成功率 | 一键安装、幂等、配置外置、迁移可回放 | 干净环境安装测试（本仓 install --verify 即范例）→ DFX-Spec 验收表 |
| 11 | 可测试性 Testability | 状态可注入、结果可观察 | 可 mock 边界比例、测试执行时长 | 依赖注入、时钟/随机可注入、纯函数核心 | test-builder 基建探测 → maintainability 佐证 |
| 12 | 可修改性 Modifiability | 扩展点开闭、变更局部化 | 新增同类功能不改核心的比率 | 开闭扩展点、插件位、归一化（同类问题一个解法） | arch check 禁边/code-review 归一 lens → maintainability 佐证 |

映射：1-8 直落 catalog attributes 六档；9/11/12 佐证对应属性；10 无直接属性，进 DFX-Spec 验收表由检查/评审守。

## 定档策略

- 按模块定档，不全局一刀切：支付模块 security:critical，营销落地页 security:medium。
- 追问三件套逼档位：「这个模块坏 1 小时，损失什么？」（可靠/韧性）「里面的数据泄了，上什么新闻？」（安全/隐私）「谁半夜起来修它？」（可服务性）。
- 过堂完排 DFX 优先级栈（如「安全 > 可靠 > 成本 > 性能」），前排压后排；栈与被牺牲方记进 DFX-Spec 供后续所有取舍引用。

## 流程（Design-in 模式）

1. 读已签字 Spec + Architecture-Design，提取业务关键点（钱/个人数据/物理世界/用户量级）——直接决定 security/privacy/safety 起始档。
2. 按 12 维逐维过堂：每维产出「六要素场景 + 度量 + 对策 + 验证落点 + 关键模块档位」；合规/行业标准不确定（GDPR/等保）先 WebSearch 再定档。
3. 写 `DFX-Spec.md`（`.zcode/harness/templates/DFX-Spec-Template.md`）：每维度「档位 + 可验收指标（数字+单位+测法）+ 验证方式」。
4. 档位写入 module-catalog `attributes`（none/minimal 必须 reason）；每个 critical/high 属性在 verification-matrix 加认领检查——没有检查的档位是接线缺陷，`node .zcode/zbase.mjs fitness` 会拦。
5. 红线确认：security/safety 永不可豁免；PII/密钥不入日志/上下文包/git。
6. DFX 签字闸：优先级栈与被牺牲方清单交用户确认。

## 评分卡（Review 模式）

对既有 Architecture-Design.md（或现有实现）逐维三态判定：**满足**（有对策+有验证落点）/ **风险**（有对策无验证，或度量缺失）/ **缺口**（无对策）。

- 每个风险/缺口给一条最小整改建议（指向具体模块与落点，不泛泛而谈）。
- 有 catalog 的项目先跑 `node .zcode/zbase.mjs quality verify` + `arch check` + `fitness` 拿机器事实，人的评审叠在机器结论之上。
- 评审只评价不代改——整改归 arch-designer/dev-planner，DFX 是裁判不是球员。

## 纪律

- 指标必须可验证：能写出「跑什么、看什么、阈值多少」。
- 不虚高档位：档位越高验证成本越大，按真实业务风险定档。
- 隐私数据清单（收集/用途/留存/销毁）必填——GDPR 式问责的锚点。
- 双向诚实：评自己参与的架构时声明身份，或直接建议换 fresh 实例跑 Review。

## 回执

模式（Design-in/Review）+ DFX-Spec.md 或评分卡 + catalog attributes 更新 + matrix 认领检查清单 + 优先级栈与被牺牲方记录 + `fitness` 通过证据。
