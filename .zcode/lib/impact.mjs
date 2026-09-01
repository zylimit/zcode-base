// impact：改动路径 → 所属模块 → 反向依赖闭包。保守扩张铁律。
import { loadCatalog, classify, moduleByName } from './catalog.mjs';

// 反向依赖闭包：affected 的传递消费者（谁依赖我）。
export function reverseClosure(catalog, seeds) {
  const consumers = new Map(); // dep -> [modules]
  for (const m of catalog.modules || []) {
    for (const d of m.deps || []) {
      if (!consumers.has(d)) consumers.set(d, []);
      consumers.get(d).push(m.name);
    }
  }
  const seen = new Set(seeds);
  const fanout = new Set(seeds);
  let frontier = [...seeds];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      for (const c of consumers.get(cur) || []) {
        if (!fanout.has(c)) { fanout.add(c); next.push(c); }
      }
    }
    frontier = next;
  }
  return [...fanout];
}

export function analyze({ changed }) {
  const catalog = loadCatalog();
  if (!catalog) return { ok: false, reason: 'module-catalog 不存在，大仓治理未启用' };
  const reasons = [];
  let degraded = false;
  const affected = new Set();
  let unmappedCount = 0;
  for (const p of changed) {
    const c = classify(catalog, p);
    if (c.kind === 'ignored') continue;
    if (c.kind === 'global') { degraded = true; reasons.push(`global 路径：${p}`); affected.clear(); [...(catalog.modules || [])].forEach((m) => affected.add(m.name)); break; }
    if (c.kind === 'unmapped') { unmappedCount++; continue; }
    if (c.kind === 'catchall') { degraded = true; reasons.push(`catchall 归类：${p}`); }
    if (c.kind === 'overlap') { degraded = true; reasons.push(`overlap：${p} ∈ ${c.hits.join(',')}`); }
    if (c.module) affected.add(c.module);
  }
  if (unmappedCount > 0) {
    degraded = true; reasons.push(`unmapped 路径 ${unmappedCount} 条，保守扩大到全模块`);
    (catalog.modules || []).forEach((m) => affected.add(m.name));
  }
  const fanout = reverseClosure(catalog, [...affected]);
  const details = [...affected].map((n) => moduleByName(catalog, n)).filter(Boolean);
  return { ok: true, degraded, reasons, affected: [...affected], fanout, modules: details };
}
