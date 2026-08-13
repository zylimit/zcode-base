# 大仓细则（60W+ 行）

宪法指针文件：大仓任务（阅读/修改/验证大代码库）前必读。来源：codex-base `LARGE-REPO-GUIDE` + cursor-base 实测数据。

## 唯一开关

大仓治理启用 = `harness/module-catalog.json` 存在且 `catalog lint` 通过。不存在时按普通仓库处理（不强造 catalog）；存在但 lint 报错先修 catalog 再动代码。

## 六步法（large-repo-harness skill 执行）

1. **catalog lint**：全量归类校验（错误：CATCH_ALL/UNMAPPED/OVERLAP/DANGLING_DEP；警告：CYCLE/TRUNCATED）。
2. **impact**：改动路径 → 所属模块 → 反向依赖闭包（谁会被我影响）。
3. **task baseline**：`task start` 建立 envelope + fingerprint（base commit + staged + unstaged + untracked）。
4. **context pack**：预算化打包（总额 120K chars / 单文件 20K / maxFiles 40），DENY 路径永不入包。
5. **scoped 实现**：只改受影响模块内文件。
6. **verification plan / gate**：按 impact 结果定向验证；写回执收口。

## 保守扩张铁律

impact/context 结果出现 **unmapped、shared、global、truncated** 任一情况 → 验证范围**扩大到全模块 fanout** 并标 degraded（宁全跑，不漏测）。degraded 不是失败，是必须可见的降级事实。

## 退出码契约

| verb | 0 | 3 | 4 | 备注 |
|---|---|---|---|---|
| catalog lint | 无错误 | 有错误 | — | 警告不打断 |
| impact | 影响收敛 | catalog 缺失/坏 | — | degraded 输出 JSON 标记 |
| context pack | 打包成功 | — | — | 只打印 manifest，全文落 `.zbase/context/` |
| arch check | 无新债 | 有新违例 | — | 基线内债务放行 |
| arch trend | 债务不增 | 债务增加 | — | 棘轮只紧不松 |
| quality verify | 五性覆盖 | uncovered | 账本断链 | 反证优先 |

## 性能设计（实测参考：600k 行/30k 文件/120 模块）

- catalog lint ~3.2s、affected ~60ms（cursor-base 实测同级实现）。
- glob 编译缓存（同一 glob 只编译一次）；`maxTrackedPaths` 默认 100,000，超出截断按坏测量处理（保守 fanout）。
- git 路径用 `-z` + `quotePath=false`，中文文件名不破坏解析。
- `selftest` 内置规模冒烟：120 模块 × 30,000 路径 < 2.5s（超时警告不失败，防环境抖动）。

## 模块胶囊（MODULE-CAPSULE）

每个核心模块维护一份胶囊（`harness/modules/<name>.md`，模板见 `harness/templates/MODULE-CAPSULE-Template.md`）：职责/公共契约/依赖/禁边/五性档位/测试入口。context pack 优先打包胶囊而非源码全文——读胶囊不读实现，是 60W 行仓的上下文纪律。

## 并行写

共享契约、schema、迁移、lockfile、生成物、公共 manifest 默认单 writer；并行写需独立 worktree + 互斥 ownedPaths + integration owner。
