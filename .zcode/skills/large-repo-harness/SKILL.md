---
name: large-repo-harness
description: 在 60W+ 行大代码库上做任何阅读/修改/验证任务时使用：catalog→impact→context-pack→scoped 实现→定向验证→回执六步法。
---

# large-repo-harness：大仓六步法

## 前置

大仓治理启用 = `.zcode/harness/module-catalog.json` 存在且 `node .zcode/zbase.mjs catalog lint` 通过。不存在时按普通仓库处理，不强造。细则见 `.zcode/rules/large-repo.md`。

## 六步

1. **catalog lint**：全量归类校验零错误。报错先修 catalog（补 globs/修 deps）再动代码。
2. **impact**：`node .zcode/zbase.mjs impact`（默认取 git 变更路径）→ 输出受影响模块 + 反向依赖闭包（fanout）。
3. **task baseline**：`node .zcode/zbase.mjs task start --input task.json`（六字段信封）建立 fingerprint 绑定。
4. **context pack**：`node .zcode/zbase.mjs context pack` 按预算打包（总额 120K chars；DENY 路径永不入包）；**读模块胶囊不读实现全文**（`.zcode/harness/modules/<name>.md`）。
5. **scoped 实现**：只改受影响模块内文件；共享契约/lockfile/迁移单 writer。
6. **定向验证**：验证范围 ≥ impact fanout；`receipt write` 落账收口。

## 保守扩张铁律

impact/context 输出出现 **unmapped / shared / global / truncated** 任一 → 验证范围扩大到全模块 fanout 并标 degraded（宁全跑不漏测）。degraded 不是失败，是必须可见的降级事实。

## 性能预期

600k 行/30k 文件/120 模块：catalog lint ~3s 内、impact ~100ms 内（超预算先查 catalog 是否退化/路径是否膨胀，不硬扛）。

## 回执

影响分析结果（affected/fanout/degraded）+ 验证证据 + receipt seq。
