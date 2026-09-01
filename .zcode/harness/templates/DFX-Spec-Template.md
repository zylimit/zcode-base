# DFX-Spec — <项目名> 五性设计规格

版本: v0.1 ｜ 状态: Draft | Signed ｜ 日期: YYYY-MM-DD
口径详见 `.zcode/rules/quality-attributes.md`。档位写入 `.zcode/harness/module-catalog.json` attributes。

## 1. 韧性 Resilience（攻击/故障/并发冲击下识别风险并快速恢复）

- 档位: <per-module>
- 可验收指标: 如「依赖 X 超时 3s 后熔断 60s，半开探针恢复；过载时排队上限 N，超限返回 429 而非雪崩」
- 验证方式: <verification-matrix check 名>

## 2. 安全 Security（防未授权访问/破坏/窃听/篡改）

- 档位:
- 可验收指标: 如「所有入口经鉴权中间件；输入校验覆盖率；密钥仅环境变量注入；传输 TLS」
- 验证方式:

## 3. 安全 Safety（故障不伤人/环境/设备）

- 档位:
- 可验收指标: 如「失效默认安全态；危险操作二次确认联锁；越界物理参数钳制；失效告警 ≤Ns 上报」
- 验证方式:

## 4. 隐私 Privacy（GDPR 等法规与隐私设计原则）

- 档位:
- 数据清单: <收集什么 PII/为什么/存多久/怎么销毁>
- 可验收指标: 如「PII 字段标记+脱敏落日志；留存 ≤Nd 自动销毁；导出/删除请求 ≤24h 响应」
- 验证方式:

## 5. 可靠 Reliability（规定条件下持续稳定无故障）

- 档位:
- 可验收指标: 如「核心链路单测+集成测试覆盖；幂等重试；SLO 99.9% 与错误预算」
- 验证方式:

## 红线确认

- [ ] security/safety 无豁免路径
- [ ] PII/密钥不入日志/上下文包/git
- [ ] critical/high 档位在 verification-matrix 有认领检查（`fitness` 通过）

## 签字

- [ ] 用户确认
