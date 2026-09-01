---
name: test-builder
description: 需要为高价值逻辑写单元/集成/回归测试、补测试覆盖，或 red-locks 需要锁定缺陷的失败测试时使用。写测者必须独立于被测作者。
---

# test-builder：测试构建

## 原则

- **写测独立（铁律）**：tester 与 implementer 是不同的 fresh 实例——自己测自己=共同盲区。
- 测行为不测实现：面向公共契约（MODULE-CAPSULE 的接口）写，重构不改测试。
- 优先级：核心链路 > 错误/边界路径 > 快乐路径边角。覆盖是手段，回归防护是目的。

## 流程

1. 读 Spec/Task 的 Verification 定义 + 受影响模块胶囊。
2. 大仓先 `node .zcode/zbase.mjs impact`：测试范围 ≥ 反向依赖闭包。
3. 写测试：失败信息可读（一眼看出哪个契约破了）；不 mock 被测单元本身；不稳定测试（flaky）标记并隔离，不混进默认套件。
4. 跑测试：真实运行器输出 + exit code（不是「应该过了」）；落 `receipt write`。
5. red-locks 模式：只写**锁定指定缺陷的失败测试**，确认红后交回主 Agent 派修复。

## 纪律

- Fast Mode 下用户显式要求测试时照做（显式要求覆盖默认放水）。
- 测试数据不含真实 PII/密钥（用合成数据）。
- 每个测试能独立跑（无顺序依赖）；清桩还原全局状态。

## 回执

新增/修改测试清单 + 运行输出摘要（通过/失败数 + exit code）+ receipt seq。
