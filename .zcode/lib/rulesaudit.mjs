// rules-audit：审「宪法里的规则是否有真实执法点」——未执法的规则不只无效，还与健康规则
// 竞争注意力（规则数有合规天花板）。三态：enforced（点名真实执法）/ declared-unenforced
// （自认 prompt-only）/ unenforced（error）。advisory 起步：默认不设上限阻断（--max 可设）。
// test-routing：宪法声明 ↔ 磁盘实体双向一致性（幽灵 skill/孤儿 skill/幽灵命令）。
// plan-lint：DEV-PLAN 计划侧质量门（占位词禁令 + Phase 结构锚点 + Task 粒度）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS, FILES } from './config.mjs';
import { loadMatrix } from './quality.mjs';
import { AUDIT_IDS, SCAN_RULE_IDS } from './fitness.mjs';

// ── 执法面动态枚举：绝不硬编码清单，否则审计自己的盲区（PHANTOM）─────────────────
// 来源：zbase.mjs 路由 case 名 + usage 子命令 + verification-matrix 检查名 + fitness 规则 id。
export function knownEnforcementTokens() {
  const known = new Set();
  const src = fs.readFileSync(path.join(DIRS.zcode, 'zbase.mjs'), 'utf8');
  for (const m of src.matchAll(/case '([^']+)':/g)) known.add(m[1]);
  for (const m of src.matchAll(/usage\('([^']+)'\)/g)) {
    for (const part of m[1].split(/[|\s]/)) {
      const w = part.trim().split(/\s+/)[0];
      if (w && /^[a-z][a-z0-9-]*$/.test(w)) known.add(w);
    }
  }
  try {
    for (const c of loadMatrix().checks) known.add(c.name);
  } catch { /* matrix 缺失不阻塞 token 集 */ }
  for (const id of AUDIT_IDS) known.add(id);
  for (const id of SCAN_RULE_IDS) known.add(id);
  return known;
}

const RULE_LINE = /^\s*(?:\d+\.|-|\|)\s+\S/;
const PROMPT_ONLY = /\b(prompt-only|prompt only|\(P\))\b/i;
const SECTION = /^#{2,3}\s+(.+?)\s*$/;
const PREFIXES = [/^node \.zcode\/zbase\.mjs\s+/, /^node \.zcode\/scripts\/gen-manifest\.mjs\s+/, /^zbase\s+/];

// 规则被执法 = 它点名了真实存在的执法点（反引号 token 剥命令前缀后命中执法面）。
function enforcementTokens(line, known) {
  const found = [];
  for (const m of line.matchAll(/`([^`]{2,80})`/g)) {
    let raw = m[1].trim();
    for (const p of PREFIXES) raw = raw.replace(p, '');
    const bare = raw.split(/[\s|]/)[0];
    if (known.has(bare)) found.push(bare);
  }
  return found;
}

export function rulesAudit({ files = null, max = Infinity } = {}) {
  const known = knownEnforcementTokens();
  const targets = files || ['AGENTS.md'];
  const rows = [];
  for (const f of targets) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    let section = '(preamble)';
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
      if (inFence) continue;
      const s = SECTION.exec(line);
      if (s) { section = s[1]; continue; }
      if (!RULE_LINE.test(line) || line.trim().length < 25) continue;
      const tokens = enforcementTokens(line, known);
      const declared = PROMPT_ONLY.test(line) || PROMPT_ONLY.test(lines[i + 1] || '') || PROMPT_ONLY.test(section);
      rows.push({
        file: f, line: i + 1, section,
        state: tokens.length ? 'enforced' : (declared ? 'declared-unenforced' : 'unenforced'),
        enforcedBy: tokens,
        text: line.trim().slice(0, 140),
      });
    }
  }
  const enforced = rows.filter((r) => r.state === 'enforced');
  const declared = rows.filter((r) => r.state === 'declared-unenforced');
  const silent = rows.filter((r) => r.state === 'unenforced');
  const findings = silent.map((r) => ({
    severity: 'error', code: 'RULE_UNENFORCED', file: r.file, line: r.line,
    message: `规则未点名执法点也未自认 prompt-only："${r.text}"——绑到命令、标注 prompt-only 或删除；未执法规则拉低已执法规则的合规`,
  }));
  // 输出预算：非 enforced 行才带全文（enforced 行健康，counts 已总结），findings 封顶 15
  const ROWS_CAP = 30;
  const FINDINGS_CAP = 15;
  return {
    ok: silent.length <= max,
    counts: { total: rows.length, enforced: enforced.length, declaredUnenforced: declared.length, unenforced: silent.length, maxUnenforced: max },
    enforcementRatio: rows.length ? Number((enforced.length / rows.length).toFixed(3)) : 1,
    rows: [...declared, ...silent].slice(0, ROWS_CAP).map((r) => ({ ...r, text: r.text.slice(0, 100) })),
    rowsTruncated: declared.length + silent.length > ROWS_CAP,
    findings: findings.slice(0, FINDINGS_CAP),
    findingsTruncated: findings.length > FINDINGS_CAP,
    advice: silent.length
      ? `${silent.length} 条规则言之无物（背后无检查）。每一条都在稀释有检查的规则的合规度。`
      : '每条规则要么点名执法点，要么自认无执法。',
  };
}

// ── test-routing：宪法声明 ↔ 磁盘双向一致性 ────────────────────────────────────
// 幽灵 skill（声明无实体）= error；孤儿 skill（实体无声明）= warning；
// 幽灵命令（宪法点名 zbase 动词但路由不存在）= error——PHANTOM 的正向拦截。
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/; // ≥1 连字符，排除普通单词误命中

export function testRouting() {
  const errors = [];
  const warnings = [];
  const agentsFile = path.join(ROOT, 'AGENTS.md');
  if (!fs.existsSync(agentsFile)) {
    return { ok: false, errors: [{ code: 'NO_AGENTS_MD', message: 'AGENTS.md 不存在' }], warnings, ghosts: [], orphans: [], commandGhosts: [] };
  }
  const text = fs.readFileSync(agentsFile, 'utf8');
  const lines = text.split('\n');

  // ① 工作流路由表（| 场景 | Skill |）声明的 skill 名：Skill 列首 token + " / " 后续 token
  const declaredSkills = new Set();
  let inRoutingTable = false;
  for (const line of lines) {
    if (/^\|\s*场景\s*\|\s*Skill\s*\|/.test(line)) { inRoutingTable = true; continue; }
    if (inRoutingTable) {
      if (!line.trim().startsWith('|')) break; // 表格结束
      if (/^\|[\s:-]+\|/.test(line.trim())) continue; // 分隔行
      const cells = line.split('|').map((c) => c.trim());
      const skillCell = cells[2] || '';
      const lead = /^[a-z0-9]+(?:-[a-z0-9]+)+/.exec(skillCell);
      if (lead) declaredSkills.add(lead[0]);
      const second = /\/\s*([a-z0-9]+(?:-[a-z0-9]+)+)/.exec(skillCell);
      if (second) declaredSkills.add(second[1]);
    }
  }

  const skillsDir = path.join(DIRS.zcode, 'skills');
  const actualSkills = new Set(fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : []);

  const ghosts = [...declaredSkills].filter((s) => !actualSkills.has(s)).sort();
  const orphans = [...actualSkills].filter((s) => !declaredSkills.has(s)).sort();
  for (const s of ghosts) errors.push({ code: 'GHOST_SKILL', skill: s, message: `AGENTS.md 路由表声明 skill "${s}" 但 .zcode/skills/ 无此目录——幽灵登记` });
  for (const s of orphans) warnings.push({ code: 'ORPHAN_SKILL', skill: s, message: `.zcode/skills/${s}/ 存在但 AGENTS.md 路由表未登记——孤儿 skill，模型不知道何时用它` });

  // ② 宪法命令参考 ↔ zbase.mjs 实际 case：点名的动词必须存在
  const src = fs.readFileSync(path.join(DIRS.zcode, 'zbase.mjs'), 'utf8');
  const cases = new Set();
  for (const m of src.matchAll(/case '([^']+)':/g)) cases.add(m[1]);
  const declaredVerbs = new Set();
  for (const m of text.matchAll(/zbase\.mjs\s+([a-z][a-z0-9-]*)/g)) declaredVerbs.add(m[1]);
  for (const line of lines) {
    if (!line.includes('常用动词') && !line.includes('治理 CLI：')) continue;
    for (const m of line.matchAll(/`([a-z][a-z0-9-]*)`/g)) declaredVerbs.add(m[1]);
  }
  const commandGhosts = [...declaredVerbs].filter((v) => !cases.has(v)).sort();
  for (const v of commandGhosts) errors.push({ code: 'GHOST_COMMAND', verb: v, message: `宪法点名动词 "${v}" 但 zbase.mjs 无此 case——PHANTOM 执法点` });

  // ③ 声明的 skill 目录必须有 SKILL.md 实体
  for (const s of declaredSkills) {
    if (actualSkills.has(s) && !fs.existsSync(path.join(skillsDir, s, 'SKILL.md'))) {
      errors.push({ code: 'NO_SKILL_MD', skill: s, message: `登记 skill ${s}/ 缺 SKILL.md 实体` });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ghosts,
    orphans,
    commandGhosts,
    counts: { declaredSkills: declaredSkills.size, actualSkills: actualSkills.size, ghosts: ghosts.length, orphans: orphans.length, commandGhosts: commandGhosts.length },
  };
}

// ── plan-lint：DEV-PLAN 计划侧质量门 ──────────────────────────────────────────
// 占位词禁令对「最坏执行者」设防：连「类似 Task/按需调整」这类计划特有偷懒词都拦。
const PLACEHOLDER_PATTERNS = ['TBD', 'TODO', '待补充', '待确定', '类似 Task', '类似 Phase', '按需调整', '做相应修改', 'implement later']; // zbase-fitness:ignore todo-without-owner
const PHASE_HEADING = /^## Phase\s+\d+/;

export function planLint(planFile = null) {
  const file = planFile || path.join(ROOT, 'DEV-PLAN.md');
  if (!fs.existsSync(file)) return { ok: true, skipped: 'DEV-PLAN 不存在，跳过（不强造计划）', findings: [] };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const findings = [];

  // code fence 标记：围栏内（含围栏行）跳过占位词扫描
  const fenced = new Set();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fenced.add(i); inFence = !inFence; continue; }
    if (inFence) fenced.add(i);
  }
  for (const pat of PLACEHOLDER_PATTERNS) {
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (let i = 0; i < lines.length; i++) {
      if (fenced.has(i)) continue;
      if (re.test(lines[i])) findings.push({ severity: 'error', code: 'PLAN_PLACEHOLDER', line: i + 1, message: `占位词命中 "${pat}"：计划对最坏执行者设防，占位词等于未计划` });
    }
  }

  // Phase 结构：每 `## Phase` 段须含 Task 表（验证/风险列）且 ≥1 Task 行
  const phaseStarts = [];
  for (let i = 0; i < lines.length; i++) if (PHASE_HEADING.test(lines[i])) phaseStarts.push(i);
  if (phaseStarts.length === 0) findings.push({ severity: 'error', code: 'NO_PHASE', message: '未找到任何 ## Phase 段' });
  for (let idx = 0; idx < phaseStarts.length; idx++) {
    const start = phaseStarts[idx];
    const end = idx + 1 < phaseStarts.length ? phaseStarts[idx + 1] : lines.length;
    const seg = lines.slice(start, end);
    const title = lines[start].trim();
    const header = seg.find((l) => /^\|\s*Task\b/.test(l));
    if (!header) {
      findings.push({ severity: 'error', code: 'PHASE_MISSING_TABLE', line: start + 1, message: `${title} 缺 Task 表` });
      continue;
    }
    const cols = header.split('|').map((c) => c.trim());
    // 验证列 = error（无验证锚点的 Task 不可验收）；风险列 = warning（早期表格式允许无风险列）
    if (!cols.includes('验证')) findings.push({ severity: 'error', code: 'PHASE_MISSING_COLUMN', line: start + 1, message: `${title} Task 表缺「验证」列——无验证锚点的 Task 不可验收` });
    if (!cols.includes('风险')) findings.push({ severity: 'warning', code: 'PHASE_MISSING_RISK_COLUMN', line: start + 1, message: `${title} Task 表缺「风险」列——补风险定档提升可验收性` });
    const taskRows = seg.filter((l) => /^\|\s*\d+\.\d+\s*\|/.test(l));
    if (taskRows.length === 0) findings.push({ severity: 'error', code: 'PHASE_NO_TASK', line: start + 1, message: `${title} 无可执行 Task 行（须 | N.M | 形态）` });
  }

  const errors = findings.filter((f) => f.severity === 'error');
  return {
    ok: errors.length === 0,
    phases: phaseStarts.length,
    findings,
    counts: { error: errors.length, warning: findings.length - errors.length },
    file: path.relative(ROOT, file),
  };
}
