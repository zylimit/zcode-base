// 兼容 shim（Task 8.10 模块界重组）：实现已并入 doctor.mjs。本文件仅保留旧 import 路径兼容；
// 新代码请直接 import './doctor.mjs'。历史：git log --follow .zcode/lib/doctor.mjs（合并主体）。
export * from './doctor.mjs';
