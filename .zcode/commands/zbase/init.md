---
description: 初始化 zcode-base 到当前项目（扫描生成 module-catalog 骨架 + doctor 自检）。
argument-hint: ""
---

# /zbase:init

按以下步骤初始化治理面：

1. 若当前项目尚无 `.zcode/harness/module-catalog.json`：运行 `node .zcode/zbase.mjs catalog init` 看草案（dry-run 默认），确认后 `--apply` 落盘生成骨架。
2. 逐模块补全骨架：description / deps / attributes（五性档位，参考 rules/quality-attributes.md）/ layer。
3. 运行 `node .zcode/zbase.mjs catalog lint`，修复全部错误（CATCH_ALL/UNMAPPED/OVERLAP/DANGLING_DEP）。
4. 运行 `node .zcode/zbase.mjs doctor`，确认目录/hooks/契约/账本全绿。
5. 调用 arch-designer skill 补 ADR 与禁边声明（M/L 档）。
6. 三文件同步：progress.md 记录初始化决策。

$ARGUMENTS
