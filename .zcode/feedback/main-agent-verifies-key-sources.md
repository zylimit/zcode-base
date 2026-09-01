---
id: main-agent-verifies-key-sources
occurrences: 1
graduated: false
---

# main-agent-verifies-key-sources

- 日期: 2026-09-01
- 来源: codex-base（feedback: native-subagent-research + 2026-07-18 Pinned）
- 信号: 子代理交回研究报告后，主 Agent 直接采信其结论做决策
- occurrence: 1

## 现象（事故语境）

fresh 子代理的研究产出被主 Agent 当最终事实引用——子代理的筛选偏差与引用缺口无声进入决策链；codex 为此立 Pinned：子代理研究后主 Agent 必须亲读关键材料核对证据。

## 根因

「委派了研究」被误当成「完成了验证」；编排者的验收责任不能随派单转移。

## 规则（可执行表述）

子代理研究后，主 Agent 对**决策承重的关键材料**（将被引用的原始文档/数据/命令输出）必须亲自读一遍核对；子代理回执只提供地图，不代替行路。

## 执法建议

宪法纪律 3 的「验收」面（回执 Evidence 句柄抽查）；与 red-blue-review 的 CoVe「verifier 亲自重跑证据」同源——高价值变更走独立核验。
