# ADR-0005: 架构债务棘轮（baseline + trend）

- 状态: Accepted
- 日期: 2026-08-13
- 决策人: zcode-base
- Enforced-by: arch check, arch baseline, arch trend

## 背景

棕地大仓几乎必然存在存量架构违例（未声明依赖/跨层引用）。若 arch check 对全量违例报错，第一天就全红，闸门被弃用——「全红用不了」等于没有闸。若放任违例，债务持续累积（防腐失效）。

## 决策

三态棘轮：

1. `arch baseline --write`：存量违例固化入基线（`.zcode/state/arch-baseline.json`，逐条带 reason+since），日常放行。
2. `arch check`：只对**基线外新违例**报错（exit 3）——新债零容忍。
3. `arch trend --gate`：当前债务数 > 基线数 → 报错。债务只许减不许增。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 全量严格 | 棕地第一天全红，闸门被绕过 |
| 只警告不阻断 | 债务单调增长，棘轮失效 |

## 后果

- 正面：带债老仓也能立即启用闸门；每条债务显式登记（可问责）；修一条少一条。
- 负面：基线文件本身要防篡改（纳入 .zbase 运行态 + manifest 意识）；「把新债塞进基线」是潜在漏洞——基线写入属人工决策，写入时留 reason。

## 执法方式

`arch check/baseline/trend` 三 verb + `/zbase:verify` 纳入 Phase 完成闸。
