// 嵌套模块契约 lint（Task 7.11，源 dsh agentsLint）：高风险模块的目录级 AGENTS.md（宿主自动加载）
// 是最便宜的边界契约——riskTier ∈ {high, critical} 的模块目录无 AGENTS.md = error NO_MODULE_AGENTS；
// 有则校验四段 Purpose/Boundaries/Invariants/Verification（缺段 warning MODULE_AGENTS_INCOMPLETE）；
// 超 12000 bytes warning（AGENTS.md 长文件零收益——按触加载优于常驻全文）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { loadCatalog } from './catalog.mjs';

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

function rel(root, p) {
  return path.relative(root, p).split(path.sep).join('/');
}
