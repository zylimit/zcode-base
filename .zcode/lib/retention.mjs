// 兼容 shim（Task 8.10 模块界重组）：prune 现居 context.mjs；rotateGateLog（gate-log 尺寸轮转）现居 quality.mjs。
// 旧 import 路径继续工作；新代码请直接 import './context.mjs' / './quality.mjs'。
export { prune } from './context.mjs';
export { rotateGateLog } from './quality.mjs';
