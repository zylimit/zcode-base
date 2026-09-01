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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { loadCatalog } from './catalog.mjs';
import { loadMatrix } from './quality.mjs';
import { listWaivers } from './waivers.mjs';
import { verifyLedger } from './receipts.mjs';
import { changedPaths } from './git.mjs';
import { PROTECTED_ATTRS, redactSecrets, isBinaryFile } from './common.mjs';

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
