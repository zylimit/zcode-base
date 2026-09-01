# Waiver — <check-name>

> 豁免的是「暂时不做」，不是「做错了放过」。FAIL 状态永不可豁免；security/safety 属性永不可豁免。
> 五要素齐全才能 `node .zcode/zbase.mjs waiver add ...`。到期自动失效并重新计入 uncovered。

```json
{
  "check": "<被豁免的检查名>",
  "attribute": "<关联属性（不得为 security/safety）>",
  "reason": "<为什么现在不做>",
  "approver": "<审批人（必须是人）>",
  "expiry": "<ISO 日期，到期自动失效>",
  "compensation": "<补偿措施：豁免期间靠什么兜底>",
  "followUp": "<跟进事项：何时/谁补上正式检查>"
}
```

## 审批检查单

- [ ] 当前状态不是 FAIL
- [ ] 属性不是 security/safety
- [ ] compensation 真实存在（不是「加强人工关注」这种空话）
- [ ] expiry ≤ 90 天（长期豁免=重新设计，不是豁免）
- [ ] followUp 有明确责任人与时间点
