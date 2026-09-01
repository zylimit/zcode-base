// arch：真实 import 边 vs 声明依赖执法 + 债务棘轮 + ADR 幽灵引用检测。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, FILES, DIRS } from './config.mjs';
import { readJson, writeJsonAtomic, rel, nowIso } from './common.mjs';
import { loadCatalog, classify, moduleByName } from './catalog.mjs';
import { listPaths } from './git.mjs';

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
  const key = (v) => `${v.code}|${v.from}|${v.to}`;
  const baseKeys = new Set((baseline.debts || []).map(key));
  const known = violations.filter((v) => baseKeys.has(key(v)));
  const fresh = violations.filter((v) => !baseKeys.has(key(v)));
  return { ok: fresh.length === 0, totalEdges: edges.length, violations, knownDebts: known.length, fresh, baselineCount: baseKeys.size };
}

// 棘轮：存量违例入基线放行；日常只对「新债」失败。
export function baselineWrite() {
  const res = check();
  if (!res.ok && res.reason) return res;
  const debts = res.violations.map((v) => ({ key: `${v.code}|${v.from}|${v.to}`, code: v.code, from: v.from, to: v.to, reason: 'legacy', since: nowIso() }));
  writeJsonAtomic(FILES.archBaseline, { version: 1, generatedAt: nowIso(), debts });
  return { written: debts.length, file: rel(ROOT, FILES.archBaseline) };
}

// trend：债务数只许减不许增。
export function trend() {
  const res = check();
  if (!res.ok && res.reason) return res;
  const baseline = fs.existsSync(FILES.archBaseline) ? readJson(FILES.archBaseline) : { debts: [] };
  const current = res.violations.length;
  const baseCount = (baseline.debts || []).length;
  return { ok: current <= baseCount, current, baseline: baseCount, direction: current < baseCount ? 'improved' : current === baseCount ? 'flat' : 'worse' };
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
