---
name: dfx-designer
description: 架构定稿后需要为韧性/安全Security/安全Safety/隐私/可靠性五性定档、定义可验收指标，或 DFX-Spec 需要修订时使用。
---

# dfx-designer：五性 DFX 设计

## 目标

把五性从口号变成可验收指标：DFX-Spec.md（人读）+ module-catalog attributes（机器执法）+ verification-matrix 认领检查。口径详见 `rules/quality-attributes.md`。

## 五性定档维度

| 属性 | 定档问题（critical/high 触发条件示例） |
|---|---|
| 韧性 Resilience | 故障时损失多大？恢复时间要求？并发冲击量级？核心链路熔断/降级/探针是否必需？ |
| 安全 Security | 有未授权访问面吗？涉密数据？对外暴露端口/API？注入面？ |
| 安全 Safety | 失效会伤人/设备/物理环境吗？（工业/车载/医疗 → critical 起步；纯软件工具通常 none+reason） |
| 隐私 Privacy | 收集 PII 吗？跨境？GDPR/个保法适用？留存销毁要求？ |
| 可靠 Reliability | 业务停摆代价？SLO？回归风险面？ |

## 流程

1. 读已签字 Spec + Architecture-Design，逐模块过五性定档问题。
2. 写 `DFX-Spec.md`（`harness/templates/DFX-Spec-Template.md`）：每属性「档位 + 可验收指标 + 验证方式」。
3. 档位写入 module-catalog `attributes`（none/minimal 必须 reason）。
4. 每个 critical/high 属性在 verification-matrix 加认领检查（proves 该属性）——没有检查的档位是接线缺陷，`node runtime/zbase.mjs fitness` 会拦。
5. 红线确认：security/safety 无豁免路径；PII/密钥不入日志/上下文包/git。
6. DFX 签字闸：用户确认。

## 纪律

- 指标必须可验证：能写出「跑什么、看什么、阈值多少」。
- 不虚高档位：档位越高验证成本越大，按真实业务风险定档。
- 隐私数据清单（收集/用途/留存/销毁）必填——这是 GDPR 式问责的锚点。

## 回执

DFX-Spec.md + catalog attributes 更新 + matrix 认领检查清单 + `fitness` 通过证据。
