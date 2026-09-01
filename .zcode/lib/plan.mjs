// verification plan（Task 8.3，codex 1.8/1.9 移植）：
// 「这次变更该跑哪些检查」= task 风险档 × 受影响模块声明 × 保守扩散 × 依赖闭包 的确定性函数，
// 不再靠派单自觉。planHash 绑定计划身份进回执——计划选择变化 → 旧回执与当前计划不匹配（stale）。
//
// 数据流：matrix.riskChecks[task.risk] 起始组（reasons=['risk:<档>']）
//   → 受影响模块（impact 反向闭包）的 module.verification 声明并集（reasons+=['module:<id>']）
//   → impact 保守扩散（unmapped/global/catchall/overlap → degraded）时并入 conservativeChecks（reasons+=['conservative-impact']）
//   → 依赖传递闭包（reasons=['dependency-of:<id>']）→ 拓扑序输出（环检测 MATRIX_CYCLE）。
//
// 兼容开关：matrix 未声明 riskChecks/conservativeChecks 且 catalog 无任何 module.verification
//   = 未采纳 plan 机制 → PLAN_NOT_ADOPTED，gate 按传统模式执行（不执法组队），既有项目零迁移成本。
// 空计划显式标记 empty：空计划是配置失败不是绿灯——gate/verify 消费时 BLOCKED。
import fs from 'node:fs';
import { readJson, sha256, canonicalJson } from './common.mjs';
import { FILES } from './config.mjs';
import { loadCatalog } from './catalog.mjs';
import { analyze } from './impact.mjs';
import { changedPaths } from './git.mjs';
import { loadState } from './state.mjs';

export function loadMatrix() {
  if (!fs.existsSync(FILES.matrix)) return { checks: [] };
  return readJson(FILES.matrix);
}

// ---------- matrix 校验（新字段：dependencies/resourceLocks/platform + riskChecks/conservativeChecks） ----------

export function validateMatrix(matrix) {
  const err = (code, message) => ({ ok: false, code, message });
  if (!matrix || typeof matrix !== 'object') return err('MATRIX_INVALID', 'verification-matrix 不是对象');
  const checks = Array.isArray(matrix.checks) ? matrix.checks : [];
  const names = new Set();
  for (const c of checks) {
    if (!c || typeof c.name !== 'string' || !c.name) return err('MATRIX_INVALID', `检查缺 name：${JSON.stringify(c).slice(0, 80)}`);
    if (names.has(c.name)) return err('MATRIX_INVALID', `检查重名：${c.name}`);
    names.add(c.name);
    for (const f of ['dependencies', 'resourceLocks']) {
      if (c[f] === undefined) continue;
      if (!Array.isArray(c[f]) || c[f].some((x) => typeof x !== 'string' || !x)) {
        return err('MATRIX_INVALID', `${c.name}.${f} 必须是字符串数组`);
      }
    }
    if (c.platform !== undefined && !['linux', 'win32', 'any'].includes(c.platform)) {
      return err('MATRIX_INVALID', `${c.name}.platform 非法：${c.platform}（linux|win32|any）`);
    }
  }
  for (const c of checks) {
    for (const d of c.dependencies || []) {
      if (!names.has(d)) return err('MATRIX_UNKNOWN_CHECK', `检查 ${c.name} 依赖不存在的检查：${d}`);
    }
  }
  if (matrix.riskChecks !== undefined) {
    if (typeof matrix.riskChecks !== 'object' || Array.isArray(matrix.riskChecks)) {
      return err('MATRIX_INVALID', 'riskChecks 必须是对象 { low, medium, high }');
    }
    for (const [k, v] of Object.entries(matrix.riskChecks)) {
      if (!['low', 'medium', 'high'].includes(k)) return err('MATRIX_INVALID', `riskChecks 键非法：${k}（low|medium|high）`);
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) return err('MATRIX_INVALID', `riskChecks.${k} 必须是字符串数组`);
    }
  }
  if (matrix.conservativeChecks !== undefined
    && (!Array.isArray(matrix.conservativeChecks) || matrix.conservativeChecks.some((x) => typeof x !== 'string' || !x))) {
    return err('MATRIX_INVALID', 'conservativeChecks 必须是字符串数组');
  }
  for (const id of [...Object.values(matrix.riskChecks || {}).flat(), ...(matrix.conservativeChecks || [])]) {
    if (!names.has(id)) return err('MATRIX_UNKNOWN_CHECK', `组队引用不存在的检查：${id}`);
  }
  const cycle = detectCycle(checks);
  if (cycle) return err('MATRIX_CYCLE', `检查依赖成环：${cycle.join(' → ')}`);
  return { ok: true };
}

// 环检测（DFS 三色）：返回成环节点路径（首尾同名）或 null。
export function detectCycle(checks) {
  const byId = new Map(checks.map((c) => [c.name, c]));
  const color = new Map(); // 0/缺省=未访 1=在栈 2=完成
  const stack = [];
  const dfs = (n) => {
    color.set(n, 1); stack.push(n);
    for (const d of byId.get(n)?.dependencies || []) {
      if (!byId.has(d)) continue; // 未知引用由 validateMatrix 报
      const c = color.get(d) || 0;
      if (c === 1) return [...stack.slice(stack.indexOf(d)), n];
      if (c === 0) { const found = dfs(d); if (found) return found; }
    }
    stack.pop(); color.set(n, 2);
    return null;
  };
  for (const n of byId.keys()) {
    if ((color.get(n) || 0) === 0) { const found = dfs(n); if (found) return found; }
  }
  return null;
}

// 拓扑序（依赖在前）。调用前须通过 validateMatrix（含环检测）。
export function topologicalOrder(checks) {
  const byId = new Map(checks.map((c) => [c.name, c]));
  const done = new Set();
  const out = [];
  const visit = (name) => {
    if (done.has(name)) return;
    done.add(name);
    for (const d of byId.get(name)?.dependencies || []) if (byId.has(d)) visit(d);
    const c = byId.get(name);
    if (c) out.push(c);
  };
  for (const n of byId.keys()) visit(n);
  return out;
}

// plan 机制是否被采纳：matrix 声明 riskChecks/conservativeChecks 或 catalog 任一模块声明 verification。
// 未采纳 → gate 传统模式（不执法组队），既有项目零迁移成本（69/69 基线不回归的兼容面）。
export function planAdopted(matrix, catalog) {
  if (matrix?.riskChecks !== undefined || matrix?.conservativeChecks !== undefined) return true;
  return (catalog?.modules || []).some((m) => Array.isArray(m.verification) && m.verification.length > 0);
}

// ---------- verification plan 推导 ----------

// 返回：
//   { ok:true, taskId, risk, affectedModules, expandedToAll, degraded, empty, checks[], planHash, note }
//   { ok:false, code:'TASK_NOT_FOUND' | 'PLAN_NOT_ADOPTED' | 'MATRIX_*', message/note }
// 每 check 携带 reasons（来源可追溯：risk:<档> / module:<id> / conservative-impact / dependency-of:<id>）。
export function verificationPlan({ task } = {}) {
  const state = loadState();
  const t = task || state.tasks.find((x) => x.id === state.activeTask?.id) || null;
  if (!t) {
    return { ok: false, code: 'TASK_NOT_FOUND', note: '无活跃任务：plan 组队以任务风险档与受影响模块为输入——先 node .zcode/zbase.mjs task start --input <envelope>' };
  }
  const matrix = loadMatrix();
  const catalog = loadCatalog();
  if (!planAdopted(matrix, catalog)) {
    return { ok: false, code: 'PLAN_NOT_ADOPTED', note: 'verification plan 未采纳：matrix 未声明 riskChecks/conservativeChecks 且 catalog 无 module.verification——gate 按传统模式执行。采纳：在 matrix 增 riskChecks{low,medium,high} 与（可选）conservativeChecks，或在 catalog 模块补 verification 字段' };
  }
  const val = validateMatrix(matrix);
  if (!val.ok) return { ok: false, code: val.code, message: val.message };

  // ① risk 起始组
  const checkIds = new Set(matrix.riskChecks?.[t.risk] || []);
  const reasons = {};
  for (const id of checkIds) reasons[id] = [`risk:${t.risk}`];

  // ② 受影响模块（反向依赖闭包 ⊇ 直接受影响）的 verification 声明并集
  const impact = analyze({ changed: changedPaths() });
  let affectedModules = [];
  let expandedToAll = false;
  let degraded = null;
  if (impact.ok) {
    affectedModules = impact.fanout;
    expandedToAll = impact.degraded === true; // unmapped/global/catchall/overlap → 保守扩散
    if (impact.degraded) degraded = impact.reasons;
    const byName = new Map((catalog?.modules || []).map((m) => [m.name, m]));
    for (const name of affectedModules) {
      for (const id of byName.get(name)?.verification || []) {
        checkIds.add(id);
        (reasons[id] ??= []).push(`module:${name}`);
      }
    }
  } else degraded = impact.reason; // 小仓模式（无 catalog）：仅 riskChecks 组队

  // ③ 保守扩散：并入 conservativeChecks
  if (expandedToAll) {
    for (const id of matrix.conservativeChecks || []) {
      checkIds.add(id);
      (reasons[id] ??= []).push('conservative-impact');
    }
  }

  // ④ 依赖传递闭包（dependency-of:<引用者>）
  const byCheck = new Map(matrix.checks.map((c) => [c.name, c]));
  const addDeps = (id, seen = new Set()) => {
    for (const dep of byCheck.get(id)?.dependencies || []) {
      if (!checkIds.has(dep)) {
        checkIds.add(dep);
        reasons[dep] = [`dependency-of:${id}`];
      }
      if (!seen.has(dep)) { seen.add(dep); addDeps(dep, seen); }
    }
  };
  for (const id of [...checkIds]) addDeps(id);

  // ⑤ 拓扑序输出
  const checks = topologicalOrder(matrix.checks)
    .filter((c) => checkIds.has(c.name))
    .map((c) => ({
      name: c.name,
      tier: c.tier ?? null,
      dependencies: c.dependencies || [],
      resourceLocks: c.resourceLocks || [],
      platform: c.platform || 'any',
      reasons: reasons[c.name] || [],
    }));

  // planHash = 计划身份（选中集+reasons+推导上下文；**不含 fingerprint**——新鲜性由回执 fingerprint 字段独立执法）
  const base = {
    version: 1,
    taskId: t.id,
    risk: t.risk,
    affectedModules: [...affectedModules].sort(),
    expandedToAll,
    empty: checks.length === 0,
    checks,
  };
  return {
    ok: true,
    ...base,
    planHash: sha256(canonicalJson(base)),
    degraded,
    note: checks.length === 0
      ? 'EMPTY_PLAN：空计划是配置失败不是绿灯——riskChecks 与受影响模块 module.verification 均未组队任何检查'
      : null,
  };
}
