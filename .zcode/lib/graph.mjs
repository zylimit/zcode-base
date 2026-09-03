// graph：图与契约面——catalog（模块账本装载/归类/lint）+ impact（反向依赖闭包）+ arch（import 提取/禁边执法/棘轮/ADR 幽灵）+ agentslint（嵌套模块契约）。
// Task 8.10 模块界重组（dsh 界）：catalog/impact/arch/agentslint 旧文件现为 re-export shim。
// 依赖方向：只依赖 core；被 quality/scan/context/doctor 依赖。

import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTES, catalogExists, DIRS, FILES, listPaths, matchAny, nowIso, readJson, rel, ROOT, REASON_REQUIRED_TIERS, TIERS, writeJsonAtomic } from './core.mjs';

// ══════════════════ 原 catalog.mjs ═══════════════════

// module-catalog：装载/归类/lint。大仓治理的唯一事实源。

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
    // 八属性六档校验（Task 9.1，源 dsh lintCatalog）：未知属性/未知档位 error；
    // tier ∈ {minimal, none} 无对应 attributeReasons → UNJUSTIFIED_TIER——退出治理是记录的决策不是免费默认。
    for (const [attr, tier] of Object.entries(m.attributes || {})) {
      if (!ATTRIBUTES.includes(attr)) {
        errors.push({ code: 'UNKNOWN_ATTRIBUTE', module: m.name, attr });
      }
      if (tier !== undefined && !TIERS.includes(tier)) {
        errors.push({ code: 'UNKNOWN_TIER', module: m.name, attr, tier });
      }
      if (tier !== undefined && REASON_REQUIRED_TIERS.has(tier) && !(m.attributeReasons || {})[attr]) {
        errors.push({
          code: 'UNJUSTIFIED_TIER', module: m.name, attr, tier,
          note: `opting out of governance must be a recorded decision：补 attributeReasons.${attr}（一句话书面理由）`,
        });
      }
    }
    // riskTier（Task 7.11）：模块风险档，驱动 agents-lint 嵌套契约要求
    if (m.riskTier !== undefined && !['low', 'medium', 'high', 'critical'].includes(m.riskTier)) {
      errors.push({ code: 'BAD_RISK_TIER', module: m.name, riskTier: m.riskTier });
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
      // 八属性默认 none 且不带 attributeReasons：init 骨架跑 lint 会报 UNJUSTIFIED_TIER——
      // 这是有意的（骨架不是成品）：逐模块补档位与理由后 lint 才该绿。
      attributes: {
        resilience: 'none', security: 'none', safety: 'none', privacy: 'none', reliability: 'none',
        availability: 'none', performance: 'none', maintainability: 'none',
      },
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
  return path.join(DIRS.harness, 'modules', `${name}.md`);
}

export function capsuleExists(name) {
  return fs.existsSync(capsulePath(name));
}


// ══════════════════ 原 impact.mjs ═══════════════════

// impact：改动路径 → 所属模块 → 反向依赖闭包。保守扩张铁律。

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


// ══════════════════ 原 arch.mjs ═══════════════════

// arch：真实 import 边 vs 声明依赖执法 + 债务棘轮 + ADR 幽灵引用检测。

// 多语言 import 提取（regex 近似，覆盖主流形态；未能解析的忽略而非误报）。
const PATTERNS = [
  { exts: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'], extract: /(?:import\s+(?:[\s\S]*?)\s+from\s*|import\s*|require\s*\(\s*|export\s+(?:[\s\S]*?)\s+from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g },
  { exts: ['.py'], extract: /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm },
  { exts: ['.go'], extract: /"([\w./-]+)"/g },
  { exts: ['.java', '.kt', '.cs', '.scala', '.swift'], extract: /^\s*import\s+(?:static\s+)?([\w.]+);?/gm },
  { exts: ['.rb'], extract: /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm },
  { exts: ['.php'], extract: /^\s*(?:require(?:_once)?|include(?:_once)?)\s*[('"]\s*([^'")]+)/gm },
  { exts: ['.rs'], extract: /^\s*(?:use\s+|pub\s+use\s+)([\w:]+)/gm },
];

function extractImports(file) {
  const ext = path.extname(file);
  const pat = PATTERNS.find((p) => p.exts.includes(ext));
  if (!pat) return [];
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  let m;
  const re = new RegExp(pat.extract.source, pat.extract.flags);
  while ((m = re.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (spec) out.push(spec);
    if (out.length > 500) break;
  }
  return out;
}

// 相对/别名导入 → 归属模块；包名导入忽略（外部依赖不由 catalog 管）。
function resolveToModule(root, fromFile, spec, catalog) {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
  const base = spec.startsWith('@/') ? path.join(root, 'src', spec.slice(2)) : path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}.py`, path.join(base, 'index.js'), path.join(base, 'index.ts'), path.join(base, '__init__.py')]) {
    if (!fs.existsSync(cand)) continue;
    const r = rel(root, cand);
    const c = classify(catalog, r);
    if (c.kind === 'module' || c.kind === 'catchall') return c.module;
    return null;
  }
  return null;
}

// 棘轮豁免面（源 cc-base 4b14be8 论点）：只有 UNDECLARED_DEP 是能慢慢还的债；
// FORBIDDEN_EDGE / LAYER_VIOLATION 永不参与基线豁免——catalog.forbidden 是显式声明的安全边界，
// 「第一天 2 条、此后 ≤2 过闸」与禁令语义自相矛盾。禁边只要在场就 fail，修掉或改声明，没有第三条路。
const EXEMPTABLE_CODES = new Set(['UNDECLARED_DEP']);
const debtKey = (v) => `${v.code}|${v.from}|${v.to}`;

export function check() {
  const catalog = loadCatalog();
  if (!catalog) return { ok: false, reason: 'module-catalog 不存在' };
  const paths = listPaths();
  const violations = [];
  const edges = [];
  for (const p of paths) {
    if (path.extname(p) === '' || p.includes('node_modules')) continue;
    const from = classify(catalog, p);
    if (from.kind !== 'module' && from.kind !== 'catchall') continue;
    const abs = path.join(ROOT, p);
    for (const spec of extractImports(abs)) {
      const to = resolveToModule(ROOT, abs, spec, catalog);
      if (!to || to === from.module) continue;
      edges.push({ from: from.module, to });
      const m = moduleByName(catalog, from.module);
      if (!m) continue;
      const declared = (m.deps || []).includes(to);
      const forbidden = (catalog.forbidden || []).some((f) => f.from === from.module && f.to === to);
      const layerBad = (catalog.layers || []).length && m.layer && moduleByName(catalog, to)?.layer
        ? (catalog.layers.indexOf(m.layer) > catalog.layers.indexOf(moduleByName(catalog, to).layer))
        : false;
      if (forbidden) violations.push({ code: 'FORBIDDEN_EDGE', from: from.module, to, path: p, spec });
      else if (layerBad) violations.push({ code: 'LAYER_VIOLATION', from: from.module, to, path: p, spec });
      else if (!declared) violations.push({ code: 'UNDECLARED_DEP', from: from.module, to, path: p, spec });
    }
  }
  const baseline = fs.existsSync(FILES.archBaseline) ? readJson(FILES.archBaseline) : { debts: [] };
  // 基线豁免只对 UNDECLARED_DEP 生效；旧基线文件里已存在的禁边/层次违例 key 豁免效力作废（计数可见）。
  const baseDebts = (baseline.debts || []).filter((d) => EXEMPTABLE_CODES.has(d.code));
  const baseKeys = new Set(baseDebts.map(debtKey));
  const known = violations.filter((v) => EXEMPTABLE_CODES.has(v.code) && baseKeys.has(debtKey(v)));
  const fresh = violations.filter((v) => !EXEMPTABLE_CODES.has(v.code) || !baseKeys.has(debtKey(v)));
  const ignoredBaselineEntries = (baseline.debts || []).length - baseDebts.length;
  return {
    ok: fresh.length === 0,
    totalEdges: edges.length,
    violations,
    knownDebts: known.length,
    fresh,
    baselineCount: baseKeys.size,
    ...(ignoredBaselineEntries ? { ignoredBaselineEntries } : {}),
  };
}

// 棘轮：UNDECLARED_DEP 存量入基线放行；日常只对「新债」失败。
// 禁边/层次违例拒收（写基线时过滤并响亮说明——禁边不是债，不入基线）。
export function baselineWrite() {
  const res = check();
  if (!res.ok && res.reason) return res;
  const debts = res.violations
    .filter((v) => EXEMPTABLE_CODES.has(v.code))
    .map((v) => ({ key: debtKey(v), code: v.code, from: v.from, to: v.to, reason: 'legacy', since: nowIso() }));
  const rejected = res.violations.length - debts.length;
  writeJsonAtomic(FILES.archBaseline, { version: 1, generatedAt: nowIso(), debts });
  return {
    written: debts.length,
    ...(rejected ? { rejected, note: `禁边不是债，不入基线：${rejected} 条 FORBIDDEN_EDGE/LAYER_VIOLATION 被拒收——只要在场就 fail，修掉或改 catalog.forbidden/layers 声明` } : {}),
    file: rel(ROOT, FILES.archBaseline),
  };
}

// trend：集合比较（点名 fresh 边与还清边）——计数比较会放行「还一条旧债+欠一条新债」的平移。
// 禁边/层次违例永不算存量（fresh 常驻 → ok 常假）。
export function trend() {
  const res = check();
  if (!res.ok && res.reason) return res;
  const baseline = fs.existsSync(FILES.archBaseline) ? readJson(FILES.archBaseline) : { debts: [] };
  const baseDebts = (baseline.debts || []).filter((d) => EXEMPTABLE_CODES.has(d.code));
  const baseKeys = new Set(baseDebts.map(debtKey));
  const curKeys = new Set(res.violations.filter((v) => EXEMPTABLE_CODES.has(v.code)).map(debtKey));
  const fresh = res.violations.filter((v) => !EXEMPTABLE_CODES.has(v.code) || !baseKeys.has(debtKey(v)));
  const retired = [...baseKeys].filter((k) => !curKeys.has(k));
  return {
    ok: fresh.length === 0,
    current: res.violations.length,
    baseline: baseKeys.size,
    fresh,
    retired,
    direction: fresh.length ? 'worse' : retired.length ? 'improved' : 'flat',
  };
}

// adr check：ADR 的 Enforced-by 必须引用真实存在的检查，幽灵引用 fail。
export function adrCheck() {
  const knownChecks = [
    'catalog lint', 'arch check', 'arch baseline', 'arch trend', 'adr check', 'fitness',
    'quality verify', 'receipt verify', 'gate-audit', 'risk scan', 'impact', 'selftest', 'doctor',
  ];
  const errors = [];
  if (!fs.existsSync(DIRS.adr)) return { ok: true, files: 0, errors };
  const files = fs.readdirSync(DIRS.adr).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIRS.adr, f), 'utf8');
    const enforced = [...src.matchAll(/Enforced-by:\s*(.+)/g)].map((m) => m[1].trim());
    for (const e of enforced) {
      const parts = e.split(/[,,]/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (!knownChecks.includes(part)) errors.push({ file: f, ref: part });
      }
    }
  }
  return { ok: errors.length === 0, files: files.length, errors };
}


// ══════════════════ 原 agentslint.mjs ═══════════════════

// 嵌套模块契约 lint（Task 7.11，源 dsh agentsLint）：高风险模块的目录级 AGENTS.md（宿主自动加载）
// 是最便宜的边界契约——riskTier ∈ {high, critical} 的模块目录无 AGENTS.md = error NO_MODULE_AGENTS；
// 有则校验四段 Purpose/Boundaries/Invariants/Verification（缺段 warning MODULE_AGENTS_INCOMPLETE）；
// 超 12000 bytes warning（AGENTS.md 长文件零收益——按触加载优于常驻全文）。

export const RISK_TIERS = ['low', 'medium', 'high', 'critical'];
const DEFAULT_REQUIRE_FOR = ['high', 'critical'];
const DEFAULT_MAX_BYTES = 12000;

// 模块 glob → 实目录：去通配段（'src/api/**' → 'src/api'；'.zcode/lib/**' → '.zcode/lib'）；
// 文件形尾（'.zcode/zbase.mjs'）回退父目录。空（'*' 全仓 glob）→ null（根 AGENTS.md 即契约）。
export function moduleDirOf(glob) {
  const parts = String(glob).replace(/\\/g, '/').split('/');
  const cut = [];
  for (const seg of parts) {
    if (/[*?]/.test(seg)) break;
    if (seg === '' || seg === '.') continue;
    cut.push(seg);
  }
  if (cut.length === 0) return null;
  const last = cut[cut.length - 1];
  if (cut.length > 1 && /\.[a-z0-9]+$/i.test(last)) cut.pop(); // 文件形尾 → 父目录
  return cut.length ? cut.join('/') : null;
}

const SECTIONS = ['Purpose', 'Boundaries', 'Invariants', 'Verification'];

export function agentsLint({ requireForRiskTiers = DEFAULT_REQUIRE_FOR, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const catalog = loadCatalog();
  if (!catalog) {
    return { ok: false, degraded: true, reason: 'module-catalog 不存在（小仓模式），嵌套契约未启用', errors: [], warnings: [], checked: [] };
  }
  const errors = [];
  const warnings = [];
  const checked = [];

  for (const m of catalog.modules || []) {
    if (!requireForRiskTiers.includes(m.riskTier)) continue;
    const dirs = [...new Set((m.globs || []).map(moduleDirOf).filter(Boolean))];
    if (dirs.length === 0) continue; // 全仓 glob：根 AGENTS.md（宪法）即契约
    const existing = dirs.map((d) => path.join(ROOT, d, 'AGENTS.md')).filter((f) => fs.existsSync(f));
    checked.push({ module: m.name, riskTier: m.riskTier, dirs, contract: existing[0] ? rel(ROOT, existing[0]) : null });
    if (existing.length === 0) {
      errors.push({ code: 'NO_MODULE_AGENTS', module: m.name, riskTier: m.riskTier, dirs, note: `${m.riskTier} 风险模块缺目录级契约——按 .zcode/harness/templates/MODULE-AGENTS.md 四段骨架补 ${dirs.map((d) => `${d}/AGENTS.md`).join(' 或 ')}` });
      continue;
    }
    const text = fs.readFileSync(existing[0], 'utf8');
    const missing = SECTIONS.filter((s) => !new RegExp(`^#{1,4}\\s*${s}\\b`, 'im').test(text));
    if (missing.length) warnings.push({ code: 'MODULE_AGENTS_INCOMPLETE', module: m.name, missing, file: rel(ROOT, existing[0]) });
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) warnings.push({ code: 'MODULE_AGENTS_LARGE', module: m.name, bytes, maxBytes, file: rel(ROOT, existing[0]) });
  }

  return { ok: errors.length === 0, errors, warnings, checked, requiredTiers: requireForRiskTiers };
}

