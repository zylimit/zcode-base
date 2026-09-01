// 兼容 shim（Task 8.10 模块界重组）：实现已并入 core.mjs。本文件仅保留旧 import 路径兼容；
// 新代码请直接 import './core.mjs'。历史：git log --follow .zcode/lib/core.mjs（合并主体）。
export * from './core.mjs';
