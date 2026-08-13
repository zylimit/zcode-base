# 五性治理细则

宪法指针文件：架构/DFX 设计、质量验证、豁免决策前必读。来源：codex-base `QUALITY-ATTRIBUTES` + cursor-base `PROTOCOLS` 精炼。

## 五性定义（验收口径）

| 属性 | 口径 | 典型检查 |
|---|---|---|
| **韧性 Resilience** | 遭受攻击/故障/冲击时主动识别风险并快速恢复；抵抗大规模并发冲击 | 超时与重试（指数退避+熔断）、降级路径、健康探针、过载保护、故障演练 |
| **安全 Security**（网络与信息安全） | 防范未授权访问/破坏/窃听/篡改；数据与信息安全 | 认证鉴权、输入校验、密钥管理、传输加密、依赖漏洞扫描、注入防护 |
| **安全 Safety**（功能安全） | 系统故障或失效时不对人/物理环境/设备造成实质性伤害 | 失效安全默认（fail-safe）、危险操作联锁、越界保护、失效告警、回滚机制 |
| **隐私 Privacy** | 数据收集/使用/存储/销毁符合法规（GDPR 等）及隐私设计原则 | 最小收集、用途限定、留存销毁策略、PII 标记与脱敏、跨境合规、用户权利响应 |
| **可靠 Reliability** | 规定条件和时间内按预期持续稳定无故障执行业务 | 单元/集成/回归测试、错误处理完备性、幂等性、可观测性、SLO 达成 |

## 档位与声明

- 每模块在 `harness/module-catalog.json` 的 `attributes` 声明五性档位：`critical / high / medium / low / none`。
- `none / minimal` 档必须写 `reason`；`critical / high` 档必须有认领检查（verification-matrix 中 proves 该属性的 check），否则 `fitness` 审计判接线缺陷。
- 档位由 dfx-designer 在 DFX 阶段定档，需求变更时同步修订。

## 反证优先（disproof-first）

`quality verify` 判定覆盖的规则：

1. 同属性既有 PASS 又有 FAIL 回执 → **uncovered**（后到的 FAIL 覆盖早先 PASS 的证明力）。
2. BLOCKED 永不算覆盖；SKIPPED 需有豁免记录。
3. uncovered 且档位 critical/high → **阻断 task finish**（exit 3）。
4. 证据新鲜度：回执 fingerprint 必须等于当前 task+git fingerprint，不等 = 证据腐化，按未验证处理。

## 豁免（waiver）红线

- **security / safety 永不可豁免**；FAIL 状态永不可豁免（豁免的是「暂时不做」，不是「做错了放过」）。
- 豁免五要素：`approver`（人）/ `expiry`（期限）/ `compensation`（补偿措施）/ `follow-up`（跟进事项）/ `binding`（绑定的 check + diff 指纹）。缺一不可。
- 到期豁免自动失效并重新计入 uncovered。

## Fast Mode 边界

- 可跳：medium/low 档属性的自动验证、自动派发的 review/test/red-locks。
- **不可跳**：security/safety 任何档位；危险命令拦截；隐私路径保护；发布三验。

## 隐私落地约定

- PII/密钥不入：日志、上下文包（DENY 路径）、错误消息、feedback 条目、progress.md。
- 证据文件只存命令输出与哈希，不存数据本体。
- `retention prune` 按留存策略销毁过期证据；当前 diff 引用的回执永不删（销毁历史是策略，销毁验证现在的能力是缺陷）。
