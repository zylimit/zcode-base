// module-catalog：装载/归类/lint。大仓治理的唯一事实源。
import fs from 'node:fs';
import path from 'node:path';
import { readJson, matchAny, rel } from './common.mjs';
import { ROOT, FILES, catalogExists } from './config.mjs';

export function loadCatalog() {
  if (!catalogExists()) return null;
  return readJson(FILES.catalog);
}

// 路径 → 模块。返回 {module, match} ；global/ignored 显式归类。
export function classify(catalog, p) {
  for (const g of catalog.ignored || []) {
    if (matchAny(p, [g])) return { module: null, kind: 'ignored' };
  }
  const hits = (catalog.modules || []).filter((m) => matchAny(p, m.globs || []));
  if (hits.length === 0) {
    for (const g of catalog.global || []) {
      if (matchAny(p, [g])) return { module: null, kind: 'global' };
    }
    return { module: catalog.catchAll || null, kind: catalog.catchAll ? 'catchall' : 'unmapped' };
  }
  if (hits.length > 1) return { module: hits[0].name, kind: 'overlap', hits: hits.map((h) => h.name) };
  return { module: hits[0].name, kind: 'module' };
}

export function moduleByName(catalog, name) {
  return (catalog.modules || []).find((m) => m.name === name) || null;
}

export function lint(catalog, { trackedPaths } = {}) {
  const errors = [], warnings = [];
  const names = new Set();
  for (const m of catalog.modules || []) {
    if (!m.name) errors.push({ code: 'MODULE_NO_NAME', module: null });
    if (names.has(m.name)) errors.push({ code: 'DUP_MODULE', module: m.name });
    names.add(m.name);
    if (!m.globs || m.globs.length === 0) errors.push({ code: 'NO_GLOBS', module: m.name });
    if (m.layer && (catalog.layers || []).length && !(catalog.layers || []).includes(m.layer)) {
      errors.push({ code: 'BAD_LAYER', module: m.name, layer: m.layer });
    }
    for (const attr of Object.values(m.attributes || {})) {
      if (!['critical', 'high', 'medium', 'low', 'none'].includes(attr)) {
        errors.push({ code: 'BAD_ATTRIBUTE', module: m.name, attr });
      }
    }
  }
  for (const m of catalog.modules || []) {
    for (const d of m.deps || []) {
      if (!names.has(d)) errors.push({ code: 'DANGLING_DEP', module: m.name, dep: d });
    }
    if ((m.deps || []).includes(m.name)) errors.push({ code: 'SELF_DEP', module: m.name });
  }
  if (catalog.catchAll && !names.has(catalog.catchAll)) {
    errors.push({ code: 'BAD_CATCH_ALL', module: catalog.catchAll });
  }
  // 环检测（DFS 三色标记）
  const adj = new Map((catalog.modules || []).map((m) => [m.name, m.deps || []]));
  const color = new Map();
  const stack = [];
  const dfs = (n) => {
    color.set(n, 1); stack.push(n);
    for (const d of adj.get(n) || []) {
      const c = color.get(d) || 0;
      if (c === 1) warnings.push({ code: 'CYCLE', modules: [...stack.slice(stack.indexOf(d)), n] });
      else if (c === 0) dfs(d);
    }
    stack.pop(); color.set(n, 2);
  };
  for (const n of adj.keys()) if (!color.get(n)) dfs(n);
  // 真实路径归类审计（传入 trackedPaths 时启用，60W 行约 3s 内）
  if (trackedPaths && trackedPaths.length) {
    const stats = new Map();
    let unmapped = 0, truncated = false;
    const max = 100000;
    const paths = trackedPaths.length > max ? (truncated = true, trackedPaths.slice(0, max)) : trackedPaths;
    for (const p of paths) {
      const c = classify(catalog, p);
      stats.set(c.kind === 'ignored' ? 'ignored' : c.module || c.kind, (stats.get(c.kind === 'ignored' ? 'ignored' : c.module || c.kind) || 0) + 1);
      if (c.kind === 'unmapped') unmapped++;
      if (c.kind === 'overlap') errors.push({ code: 'OVERLAP', path: p, modules: c.hits });
    }
    if (unmapped > 0) errors.push({ code: 'UNMAPPED', count: unmapped });
    if (truncated) warnings.push({ code: 'TRUNCATED', note: `tracked paths > ${max}，归类审计按截断处理` });
    return { errors, warnings, stats: Object.fromEntries(stats), totalPaths: paths.length };
  }
  return { errors, warnings };
}

// 仓库扫描生成 catalog 骨架（顶级目录 → 模块候选），供 init。
export function initSkeleton({ trackedPaths }) {
  const top = new Map();
  for (const p of trackedPaths) {
    const seg = p.split('/');
    const name = seg.length > 1 ? seg[0] : 'root';
    top.set(name, (top.get(name) || 0) + 1);
  }
  const modules = [...top.entries()]
    .filter(([n]) => !['.git', '.zbase', 'node_modules'].includes(n))
    .map(([name]) => ({
      name: name === 'root' ? 'misc' : name.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      globs: [name === 'root' ? '*' : `${name}/**`],
      classification: 'product',
      description: 'TODO: 补充模块职责',
      deps: [],
      attributes: { resilience: 'none', security: 'none', safety: 'none', privacy: 'none', reliability: 'none' },
    }));
  return {
    version: 1,
    layers: [],
    modules,
    global: ['docs/**', '*.md'],
    ignored: ['.git/**', '.zbase/**', 'node_modules/**', '*.zbase-new'],
    catchAll: null,
  };
}

export function capsulePath(name) {
  return path.join(ROOT, 'harness', 'modules', `${name}.md`);
}

export function capsuleExists(name) {
  return fs.existsSync(capsulePath(name));
}
