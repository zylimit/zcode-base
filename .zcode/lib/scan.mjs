// scan：扫描与 lint 面——fitness（五性接线审计/反模式扫描）+ skillslint + scaninstr（指令文件安全扫描）+ rulesaudit（宪法规则执法覆盖/测试路由/计划门）+ feedbacklint（教训契约/毕业候选）。
// Task 8.10 模块界重组（dsh 界）：fitness/skillslint/scaninstr/rulesaudit/feedbacklint 旧文件现为 re-export shim。
// 依赖方向：core/graph/quality；被 context/doctor 依赖。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedPaths, DIRS, FILES, isBinaryFile, PROTECTED_ATTRS, redactSecrets, ROOT } from './core.mjs';
import { loadCatalog } from './graph.mjs';
import { listWaivers, loadMatrix, verifyLedger } from './quality.mjs';

// ══════════════════ 原 fitness.mjs ═══════════════════

// fitness：五性接线审计——「声明了没人执法」的接线缺陷拦截。
// 五条零依赖规则（借鉴 pi-base fitness 思想）：
//   F1 声明完整性：所有模块五性档位合法，none/minimal 必须有 reason
//   F2 执法接线：critical/high 属性必须有认领检查（verification-matrix proves）
//   F3 红线完整性：security/safety 检查不可被豁免（waiver 中不得出现）
//   F4 账本健康：哈希链完整
//   F5 检查真实性：matrix 中每条 command 必须可解析（命令存在），Enforced-by 不空
//
// v2.4 增 `fitness scan` 子命令（codex 移植）：变更代码的反模式扫描——与接线审计互补，
// 前者查治理接线，后者查代码本身。五规则 + `zbase-fitness:ignore <rule>` 行内抑制
// （抑制留在 diff 内可见，不变成暗门）。只扫变更路径，2000 文件/1MB/200 findings 封顶。

export const AUDIT_IDS = ['F1', 'F2', 'F3', 'F4', 'F5'];

const ATTRS = ['resilience', 'security', 'safety', 'privacy', 'reliability'];
const VALID = ['critical', 'high', 'medium', 'low', 'none'];

// finding excerpt 也过脱敏：审计输出与证据输出同一红线（秘密不入模型可见通道）
const redactDetail = (d) => {
  if (typeof d === 'string') return redactSecrets(d);
  if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? redactSecrets(x) : x));
  return d;
};

export function audit() {
  const results = [];
  const check = (id, ok, detail) => results.push({ id, ok, detail: redactDetail(detail) });

  // F1
  const catalog = loadCatalog();
  if (!catalog) {
    check('F1', true, 'module-catalog 不存在（小仓模式，五性档位未启用）');
  } else {
    const bad = [];
    for (const m of catalog.modules || []) {
      const attrs = m.attributes || {};
      for (const a of ATTRS) {
        const lv = attrs[a] || 'none';
        if (!VALID.includes(lv)) bad.push(`${m.name}.${a}=${lv} 非法档位`);
        else if ((lv === 'none') && !attrs.reason && !(m.attributeReasons || {})[a]) {
          // none 档要求说明：模块级 reason 或逐属性 attributeReasons
          if (!m.reason) bad.push(`${m.name}.${a}=none 缺 reason`);
        }
      }
    }
    check('F1', bad.length === 0, bad.length ? bad.slice(0, 10) : `${catalog.modules.length} 模块五性档位声明完整`);
  }

  // F2
  const matrix = loadMatrix();
  const proved = new Set(matrix.checks.flatMap((c) => c.proves || []));
  const unwired = [];
  if (catalog) {
    for (const m of catalog.modules || []) {
      for (const a of ATTRS) {
        const lv = (m.attributes || {})[a] || 'none';
        if ((lv === 'critical' || lv === 'high') && !proved.has(a)) unwired.push(`${m.name}.${a}=${lv} 无认领检查`);
      }
    }
  }
  check('F2', unwired.length === 0, unwired.length ? unwired.slice(0, 10) : 'critical/high 属性全部有认领检查');

  // F3
  const waivers = listWaivers({ all: true });
  const badWaivers = waivers.filter((w) => PROTECTED_ATTRS.includes(w.attribute));
  check('F3', badWaivers.length === 0, badWaivers.length ? `红线属性出现 ${badWaivers.length} 条豁免记录` : 'security/safety/privacy 无豁免记录');

  // F4
  const ver = verifyLedger();
  check('F4', ver.ok, ver.ok ? `账本 ${ver.total} 条，链完整` : `账本断链：${JSON.stringify(ver.issues.slice(0, 3))}`);

  // F5
  const ghost = [];
  for (const c of matrix.checks) {
    if (c.command) {
      const bin = c.command.trim().split(/\s+/)[0];
      try { execFileSync('bash', ['-c', `command -v ${JSON.stringify(bin)} >/dev/null 2>&1 || command -v node >/dev/null 2>&1 && node -e "process.exit(0)"`], { timeout: 5000 }); }
      catch { ghost.push(`${c.name}: 命令 ${bin} 不可用`); }
      if (c.command.trim().startsWith('node') && !fs.existsSync('.zcode/zbase.mjs') && c.command.includes('.zcode/')) {
        ghost.push(`${c.name}: 引用 .zcode/zbase.mjs 但文件不存在`);
      }
    }
  }
  check('F5', ghost.length === 0, ghost.length ? ghost : `${matrix.checks.length} 条检查全部可解析`);

  return { ok: results.every((r) => r.ok), results };
}

// ════════════════════════════════════════════════════════════════════════════
// fitness scan：变更代码反模式扫描（codex 移植，刻意与输出脱敏解耦——
// 脱敏可过度匹配无害，扫描规则过宽会把真发现埋进噪声，故秘密检测保持高置信窄面）
// ════════════════════════════════════════════════════════════════════════════

const SECRET_LITERAL_PATTERNS = [
  /\b(sk|pk|rk|sess)-[A-Za-z0-9_-]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?|mssql):\/\/[^@\s"']+@/i,
  /(password|passwd|secret|api[_-]?key|access[_-]?key)\s*[=:]\s*["'][^"']{8,}["']/i,
];

const SCAN_RULES = [
  {
    id: 'no-secret-literal', severity: 'error',
    test: (line) => SECRET_LITERAL_PATTERNS.some((p) => p.test(line)),
    message: '疑似凭据字面量：移入 secret store 并轮换该凭据',
  },
  {
    id: 'no-pii-in-logs', severity: 'error',
    test: (line) => /\b(?:console\.(?:log|info|warn|error)|log(?:ger)?\.(?:log|info|warn|error|debug))\b[^\n]*\b(?:email|ssn|passport|credit_?card|phone_number|date_of_birth|dob)\b/i.test(line),
    message: '日志语句携带 PII 形态字段：改记稳定假名 id',
  },
  {
    id: 'empty-catch', severity: 'warning',
    test: (line) => /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line) || /except[^:\n]*:\s*pass\b/.test(line),
    message: '吞异常：失败必须可见',
  },
  {
    id: 'unbounded-retry', severity: 'warning',
    test: (line) => /\b(?:while\s*\(\s*true\s*\)|while\s+True\b|for\s*\(\s*;;\s*\))/.test(line) && /\b(?:retry|reconnect|attempt)/i.test(line),
    message: '无界重试循环：缺可见上限或退避',
  },
  {
    id: 'todo-without-owner', severity: 'info',
    test: (line) => /\b(?:TODO|FIXME)\b(?!\s*\(@?[\w.-]+\))/.test(line), // zbase-fitness:ignore todo-without-owner
    message: 'TODO/FIXME 无属主：署名或建档', // zbase-fitness:ignore todo-without-owner
  },
];

export const SCAN_RULE_IDS = SCAN_RULES.map((r) => r.id);

const SCAN_TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.cs', '.sh', '.ps1', '.psm1', '.sql', '.yaml', '.yml', '.toml', '.json', '.md', '.txt', '.cfg', '.ini']);
const SCAN_MAX_FILES = 2000;
const SCAN_MAX_BYTES = 1024 * 1024;
const SCAN_MAX_FINDINGS = 200;

function scannable(relative) {
  const pieces = relative.split('/');
  if (pieces.includes('.git') || relative.startsWith('.zcode/state/') || pieces.includes('node_modules')) return false;
  const ext = path.posix.extname(relative).toLowerCase();
  return ext === '' || SCAN_TEXT_EXT.has(ext);
}

function suppressed(lines, index, ruleId) {
  const scope = `${lines[index]}\n${index > 0 ? lines[index - 1] : ''}`;
  const m = scope.match(/zbase-fitness:ignore(?:\s+([\w,-]+))?/);
  if (!m) return false;
  if (!m[1]) return true;
  return m[1].split(',').map((s) => s.trim()).includes(ruleId);
}

export function fitnessScan({ paths = null } = {}) {
  const candidates = paths || changedPaths(); // 默认只扫变更路径（changed+untracked）
  const findings = [];
  const skipped = [];
  let scanned = 0;
  for (const relPath of candidates.slice(0, SCAN_MAX_FILES)) {
    const abs = path.join(ROOT, relPath);
    if (!scannable(relPath)) { skipped.push({ path: relPath, reason: '非文本/运行态路径' }); continue; }
    let text;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      if (st.size > SCAN_MAX_BYTES) { skipped.push({ path: relPath, reason: '超 1MB 上限' }); continue; }
      if (isBinaryFile(abs)) { skipped.push({ path: relPath, reason: '二进制' }); continue; }
      text = fs.readFileSync(abs, 'utf8');
    } catch { continue; }
    scanned++;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && findings.length < SCAN_MAX_FINDINGS; i++) {
      for (const rule of SCAN_RULES) {
        if (!rule.test(lines[i])) continue;
        if (suppressed(lines, i, rule.id)) continue;
        findings.push({ rule: rule.id, severity: rule.severity, path: relPath, line: i + 1, message: rule.message, excerpt: redactSecrets(lines[i].trim().slice(0, 100)) });
      }
    }
  }
  const errors = findings.filter((f) => f.severity === 'error');
  return {
    command: 'fitness scan',
    ok: errors.length === 0,
    scannedFiles: scanned,
    totalCandidates: candidates.length,
    truncated: candidates.length > SCAN_MAX_FILES || findings.length >= SCAN_MAX_FINDINGS,
    findings,
    counts: {
      error: errors.length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
  };
}


// ══════════════════ 原 skillslint.mjs ═══════════════════

// skills-lint：skill 发现契约机器校验——防「skill 写了但被宿主整丢/永不触发」的静默失效。
// 吸收 dsh skillsLint（frontmatter 完整性/命名/体积/重复）+ cc skill-description-lint ③④
// （触发式描述：描述若以流程总结作主体而无触发条件，模型读摘要跳正文导致漏触发）。
// 阈值沿用 dsh 数字：description >500 error（目录截断）、>220 warning；SKILL.md >24000B warning。

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_CAP = 500; // error：宿主目录截断阈值
const DESCRIPTION_SOFT = 220; // warning：每个会话每次请求都为它付费
const SKILL_LARGE_BYTES = 24000;

// 手写 frontmatter 解析：引号剥壳、块标量（>- | > | |-）折叠、缩进续行。
// 不引 YAML 依赖（零依赖红线），只解析 skill 契约需要的扁平键值形态。
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { ok: false, reason: '缺 YAML frontmatter（须以 --- 开头）' };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { ok: false, reason: 'frontmatter 未闭合（缺结束 ---）' };
  const raw = text.slice(3, end).replace(/^\r?\n/, '');
  const lines = raw.split('\n');
  const data = {};
  let key = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (m) {
      key = m[1];
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
      if (['>', '|', '>-', '|-', '>+', '|+'].includes(v)) {
        // 块标量：续读后续缩进行（折叠 > 拼空格；字面 | 拼换行——长度语义一致）
        const literal = v.startsWith('|');
        const block = [];
        i++;
        while (i < lines.length) {
          const nxt = lines[i];
          if (nxt.trim() === '') { i++; continue; } // 块内空行：长度语义忽略
          if (!/^\s/.test(nxt)) break; // 回到顶层键，块结束
          block.push(nxt.trim());
          i++;
        }
        data[key] = literal ? block.join('\n') : block.join(' ');
        continue;
      }
      data[key] = v;
    } else if (key && /^\s+\S/.test(line)) {
      data[key] = (data[key] ? `${data[key]} ` : '') + line.trim();
    }
    i++;
  }
  return { ok: true, data, raw };
}

// 触发条件信号（③）：「当…时」「…时(必须/应当)使用」「由…调用」或以 当/由 开头。
export function hasTrigger(desc) {
  if (/当[^。；\n]{1,40}时/.test(desc)) return true;
  if (/由[^。；\n]{1,30}调用/.test(desc)) return true;
  if (/时[^\s。；，]{0,3}使用/.test(desc)) return true;
  return desc.startsWith('当') || desc.startsWith('由');
}

// 流程总结词（④）：无触发条件时，这些词作主体开头 = 描述在总结流程而非告知何时触发。
const WORKFLOW_SUMMARY_TOKENS = ['生成', '支持', '分阶段', '输出', '执行', '维护'];

export function skillsLint(roots = null) {
  const scanRoots = roots || [path.join(ROOT, '.zcode', 'skills')];
  const findings = [];
  const skills = [];
  for (const dir of scanRoots) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory()) continue; // 发现形态只认 <name>/SKILL.md
      const skillDir = path.join(dir, e.name);
      const file = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(file)) {
        findings.push({ file: `${path.relative(ROOT, skillDir)}`, severity: 'error', code: 'NO_SKILL_MD', message: 'skill 目录无 SKILL.md——宿主只发现 <name>/SKILL.md，目录等于不存在' });
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.ok) { findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'BAD_FRONTMATTER', message: fm.reason }); continue; }
      const meta = fm.data;
      if (!meta.name) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NO_NAME', message: 'frontmatter 缺 name' });
      else {
        if (!KEBAB.test(meta.name)) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NAME_NOT_KEBAB', message: `skill name "${meta.name}" 须 kebab-case（宿主拒绝其他形态）` });
        if (meta.name !== e.name) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NAME_MISMATCH', message: `frontmatter name "${meta.name}" ≠ 目录名 "${e.name}"——发现与装载不一致即失效` });
      }
      if (!meta.description) {
        findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NO_DESCRIPTION', message: 'frontmatter 缺 description——它是模型看到的唯一路由信号' });
      } else {
        if (meta.description.length > DESCRIPTION_CAP) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'DESCRIPTION_TOO_LONG', message: `description ${meta.description.length} 字符，超目录截断阈值 ${DESCRIPTION_CAP}` });
        else if (meta.description.length > DESCRIPTION_SOFT) findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'DESCRIPTION_LONG', message: `description ${meta.description.length} 字符（>${DESCRIPTION_SOFT}）：每个会话每次请求都为它付费` });
        // ③ 触发式描述：无触发条件 → warning（skill 可能永不触发）
        if (!hasTrigger(meta.description)) {
          findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'DESCRIPTION_NO_TRIGGER', message: 'description 无触发条件（当…时使用/由…调用）——模型读摘要跳正文，skill 会静默漏触发' });
          // ④ 无触发条件时禁流程总结词作主体
          const hits = WORKFLOW_SUMMARY_TOKENS.filter((t) => meta.description.startsWith(t));
          if (hits.length) findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'DESCRIPTION_SUMMARY_SUBJECT', message: `description 以流程总结词「${hits.join('、')}」开头作主体且无触发条件——在总结流程而非告知何时触发` });
        }
      }
      for (const k of Object.keys(meta)) {
        if (/^[a-z]+[A-Z]/.test(k)) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'CAMEL_CASE_KEY', message: `frontmatter 键 "${k}" 是 camelCase——宿主整丢该 skill（只认 kebab-case 键）` });
      }
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > SKILL_LARGE_BYTES) findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'SKILL_LARGE', message: `skill ${bytes} 字节超 ${SKILL_LARGE_BYTES}：加载即全额付费，细节移 references/ 并链接` });
      skills.push({ name: meta.name || e.name, file: path.relative(ROOT, file), bytes, descriptionChars: (meta.description || '').length });
    }
  }
  const names = skills.map((s) => s.name);
  for (const n of [...new Set(names.filter((x, i) => names.indexOf(x) !== i))]) {
    findings.push({ severity: 'error', code: 'DUPLICATE_SKILL', message: `重名 skill "${n}"：近层静默遮蔽远层` });
  }
  const errors = findings.filter((f) => f.severity === 'error');
  return {
    ok: errors.length === 0,
    skills,
    findings,
    counts: { skills: skills.length, error: errors.length, warning: findings.length - errors.length },
  };
}


// ══════════════════ 原 scaninstr.mjs ═══════════════════

// scan-instructions：指令文件安全扫描——AGENTS.md/SKILL.md/commands/rules/docs/feedback
// 是宿主不经人审就自动装载的输入，属活跃攻击面（野外在 AI 指令文件中实测发现过
// 泄漏 API key 与攻击者控制的 base URL 覆写）。八规则行级扫描，security 级永不可豁免。
// 抑制：`scan-instructions:ignore` 注释（本行或上一行）——抑制留在 diff 内可见。

// 本仓指令面：宿主会装载的一切 markdown
const TARGET_SPECS = [
  { flat: 'AGENTS.md' },
  { dir: path.join('.zcode', 'skills'), leaf: 'SKILL.md' }, // <name>/SKILL.md
  { dir: path.join('.zcode', 'commands') }, // **/*.md
  { dir: path.join('.zcode', 'rules') }, // *.md
  { dir: path.join('.zcode', 'docs') }, // **/*.md
  { dir: path.join('.zcode', 'feedback') }, // *.md
];

const RULES = [
  {
    id: 'endpoint-override', severity: 'error',
    message: '改写模型/工具端点：指令文件挪动 API base URL = 把每次请求与凭据发给读者未选择的地方',
    re: /\b(ANTHROPIC_BASE_URL|OPENAI_BASE_URL|OPENAI_API_BASE|GEMINI_BASE_URL|LLM_BASE_URL|HTTPS?_PROXY|ALL_PROXY)\b\s*[:=]/i,
  },
  {
    id: 'embedded-credential', severity: 'error',
    message: '携带凭据形态材料：指令文件会被跨仓复制、被贴进 issue——这里的 key 等于已公开',
    re: /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: 'instruction-override', severity: 'error',
    message: '试图覆盖更高权威指令：仓库文本是最低权威，主张相反的文本即注入尝试',
    re: /\b(ignore (all )?(previous|prior|above|earlier) (instructions|rules|prompts)|disregard (the )?(system|previous|above)|you are now [a-z]|forget (everything|all previous)|override (the )?(system|safety))\b/i,
  },
  {
    id: 'exfiltration-command', severity: 'error',
    message: '指示 agent 把仓库内容发往网络端点：指令文件可以讲怎么构建，没有理由讲怎么上传',
    // 前导连字符旗标前置 \b 永无边界（空格与 - 都是非词字符）——用显式 \s 定位旗标（dsh 原版此规则实测漏检 curl -d）
    re: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^\n]{0,120}\s(-d|--data|--upload-file|-F|-T|--post-file|-Method\s+Post)\b|\bnc\b\s+-[a-z]*\s*\d{1,5}\b/i,
  },
  {
    id: 'silent-execution', severity: 'error',
    message: '下载的脚本直接进 shell：必须先读后跑的东西不该以这种方式到达',
    re: /\b(curl|wget)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba)?sh\b|\biex\s*\(\s*(new-object|iwr|invoke-webrequest)/i,
  },
  {
    id: 'hidden-characters', severity: 'error',
    message: '含零宽/双向控制字符：人看不见但模型会读的文本，按构造即为逃避审查的指令',
    re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/,
  },
  {
    id: 'gate-disable-instruction', severity: 'error',
    message: '指示 agent 绕过验证：告诉 agent 跳过自家门禁的仓库是在描述漏洞而非构建',
    // --no-verify 前导连字符：\b 无边界，改 (?:^|\s) 定位（词形旗标保留 \b）
    re: /(?:^|\s)(--no-verify)\b|\b(skip[- ]?(the )?(hook|gate|check|test)s?|disable (the )?(hook|gate|lint|check)s?)\b|跳过门禁|跳过钩子|跳过检查/i,
  },
  {
    id: 'secret-file-read', severity: 'warning',
    message: '点名秘密承载路径：指令文件没有理由指向它',
    re: /(^|[\s"'\x60])(\.env(\.[a-z]+)?|id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials|\.npmrc)\b/i,
  },
];

const SUPPRESS = /scan-instructions:ignore/;
const MAX_BYTES = 1024 * 1024;

function walkMd(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

export function instructionFiles() {
  const files = [];
  for (const spec of TARGET_SPECS) {
    if (spec.flat) {
      const p = path.join(ROOT, spec.flat);
      if (fs.existsSync(p)) files.push(p);
    } else if (spec.leaf) {
      // 发现形态精确一层：<root>/<name>/SKILL.md
      const dir = path.join(ROOT, spec.dir);
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory()) continue;
        const p = path.join(dir, e.name, spec.leaf);
        if (fs.existsSync(p)) files.push(p);
      }
    } else {
      const dir = path.join(ROOT, spec.dir);
      if (fs.existsSync(dir)) files.push(...walkMd(dir));
    }
  }
  return files;
}

export function scanInstructions() {
  const targets = instructionFiles();
  const findings = [];
  for (const file of targets) {
    let text;
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_BYTES) {
        findings.push({ file: path.relative(ROOT, file), rule: 'oversized', severity: 'warning', line: 0, message: `指令文件 ${st.size} 字节超 1MB 上限，未扫描` });
        continue;
      }
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (SUPPRESS.test(lines[i]) || (i > 0 && SUPPRESS.test(lines[i - 1]))) continue;
      for (const rule of RULES) {
        if (!rule.re.test(lines[i])) continue;
        findings.push({
          file: path.relative(ROOT, file), line: i + 1, rule: rule.id, severity: rule.severity,
          message: rule.message, excerpt: lines[i].trim().slice(0, 120),
        });
      }
    }
  }
  const errors = findings.filter((f) => f.severity === 'error');
  return {
    command: 'scan-instructions',
    ok: errors.length === 0,
    scanned: targets.length,
    findings,
    counts: { error: errors.length, warning: findings.length - errors.length },
  };
}


// ══════════════════ 原 rulesaudit.mjs ═══════════════════

// rules-audit：审「宪法里的规则是否有真实执法点」——未执法的规则不只无效，还与健康规则
// 竞争注意力（规则数有合规天花板）。三态：enforced（点名真实执法）/ declared-unenforced
// （自认 prompt-only）/ unenforced（error）。advisory 起步：默认不设上限阻断（--max 可设）。
// test-routing：宪法声明 ↔ 磁盘实体双向一致性（幽灵 skill/孤儿 skill/幽灵命令）。
// plan-lint：DEV-PLAN 计划侧质量门（占位词禁令 + Phase 结构锚点 + Task 粒度）。

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


// ══════════════════ 原 feedbacklint.mjs ═══════════════════

// feedback 引擎化（cursor 移植）：教训库是评审可读的文件而非数据库，但契约破坏
// （错 frontmatter/重复 id）与「复发 ≥3 未毕业」必须机器发现——不靠自觉。
// 契约：.zcode/feedback/<id>.md frontmatter 含 id（=文件名）/ occurrences（正整数）/
// graduated（bool）。复发时递增 occurrences 更新而非写重复文件；毕业 = 提升为被执法的
// 东西（规则/检查/命令）且须用户确认，文件保留作「规则为何存在」的档案。

const RESERVED = new Set(['FEEDBACK-INDEX.md']); // 索引非条目

export function parseFeedback() {
  const dir = DIRS.feedback;
  const entries = [];
  const errors = [];
  if (!fs.existsSync(dir)) return { entries, errors };
  const boolish = new Set(['true', 'false']);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !RESERVED.has(f)).sort();
  const seenIds = new Map();
  for (const f of files) {
    const file = path.join(dir, f);
    const relFile = path.relative(dir, file);
    const stem = f.replace(/\.md$/, '');
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm.ok) { errors.push({ file: relFile, code: 'BAD_FRONTMATTER', message: fm.reason }); continue; }
    const { id, occurrences, graduated } = fm.data;
    if (!id) errors.push({ file: relFile, code: 'NO_ID', message: 'frontmatter 缺 id' });
    else if (id !== stem) errors.push({ file: relFile, code: 'ID_MISMATCH', message: `frontmatter id "${id}" ≠ 文件名 "${stem}"——id 即文件名，双轨必漂移` });
    if (occurrences === undefined) errors.push({ file: relFile, code: 'NO_OCCURRENCES', message: 'frontmatter 缺 occurrences（正整数）' });
    else if (!/^\d+$/.test(String(occurrences).trim()) || Number(occurrences) < 1) errors.push({ file: relFile, code: 'BAD_OCCURRENCES', message: `occurrences "${occurrences}" 非正整数` });
    if (graduated === undefined) errors.push({ file: relFile, code: 'NO_GRADUATED', message: 'frontmatter 缺 graduated（true/false）' });
    else if (!boolish.has(String(graduated).trim())) errors.push({ file: relFile, code: 'BAD_GRADUATED', message: `graduated "${graduated}" 非 bool` });
    const idKey = id || stem;
    if (seenIds.has(idKey)) errors.push({ file: relFile, code: 'DUPLICATE_ID', message: `id "${idKey}" 与 ${seenIds.get(idKey)} 重复` });
    else seenIds.set(idKey, relFile);
    entries.push({
      id: idKey,
      file: relFile,
      occurrences: /^\d+$/.test(String(occurrences || '')) ? Number(occurrences) : null,
      graduated: String(graduated || '').trim() === 'true',
    });
  }
  return { entries, errors };
}

// feedback lint：契约破坏 exit 1（ERROR 而非 FINDINGS——契约是结构问题不是检查发现）
export function feedbackLint() {
  const { entries, errors } = parseFeedback();
  return {
    command: 'feedback lint',
    ok: errors.length === 0,
    entries: entries.length,
    errors,
  };
}

// feedback list：毕业候选（occurrences ≥3 未毕业）——进化引擎不被饿死的机器发现
export const GRADUATION_THRESHOLD = 3;
export function graduationCandidates() {
  const { entries } = parseFeedback();
  return entries.filter((e) => e.occurrences !== null && e.occurrences >= GRADUATION_THRESHOLD && !e.graduated);
}

export function feedbackList() {
  const candidates = graduationCandidates();
  return {
    command: 'feedback list',
    candidates,
    counts: { entries: parseFeedback().entries.length, candidates: candidates.length },
    advice: candidates.length
      ? `${candidates.length} 条教训复发 ≥${GRADUATION_THRESHOLD} 未毕业：派 evolution-runner 评估毕业（优先毕业为检查/命令而非常驻文本——检查不触发零成本，提示词每次请求都付费）`
      : '无待毕业教训',
  };
}
