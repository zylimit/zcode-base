// quality：四态门 + 五性覆盖验证（反证优先）。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readJson, nowIso, readLines } from './common.mjs';
import { FILES } from './config.mjs';
import { loadCatalog } from './catalog.mjs';
import { latestReceipts, verifyLedger, writeReceipt } from './receipts.mjs';
import { covers } from './waivers.mjs';
import { fastStatus } from './state.mjs';

const ATTRS = ['resilience', 'security', 'safety', 'privacy', 'reliability'];
const ENFORCE_LEVELS = ['critical', 'high'];
const PROTECTED_ATTRS = ['security', 'safety'];

export function loadMatrix() {
  if (!fs.existsSync(FILES.matrix)) return { checks: [] };
  return readJson(FILES.matrix);
}

// gate <check>：执行 verification-matrix 中声明的检查命令，四态落账。
export function runGate(checkName, { note } = {}) {
  const matrix = loadMatrix();
  const check = matrix.checks.find((c) => c.name === checkName);
  if (!check) return { ok: false, reason: `verification-matrix 中无检查：${checkName}` };
  if (!check.command) return { ok: false, reason: `检查 ${checkName} 未声明 command（人工/外部检查，走 receipt write）` };
  let status = 'BLOCKED', out = '', code = null;
  try {
    out = execFileSync(check.shell || 'bash', ['-c', check.command], { encoding: 'utf8', timeout: check.timeoutMs || 300_000, maxBuffer: 64 * 1024 * 1024 });
    status = 'PASS'; code = 0;
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
    status = e.killed ? 'BLOCKED' : 'FAIL';
  }
  const receipt = writeReceipt({ check: checkName, status, note: note || (out ? out.slice(-2000) : `exit ${code}`) });
  return { ok: status === 'PASS', status, exitCode: code, outputTail: out.slice(-2000), receiptSeq: receipt.seq };
}

// coverage status：每模块五性档位 → 认领检查 → 最新回执状态（全量视角，不筛新鲜）。
export function coverageStatus() {
  const catalog = loadCatalog();
  const matrix = loadMatrix();
  const receipts = latestReceipts({ fresh: false });
  const rows = [];
  if (!catalog) return rows;
  for (const m of catalog.modules || []) {
    for (const attr of ATTRS) {
      const level = m.attributes?.[attr] || 'none';
      if (level === 'none') continue;
      const claimChecks = matrix.checks.filter((c) => (c.proves || []).includes(attr) && (!c.scope || c.scope.length === 0 || c.scope.includes(m.name)));
      const latest = claimChecks.map((c) => receipts.get(c.name)).filter(Boolean).pop() || null;
      rows.push({ module: m.name, attribute: attr, level, claimedBy: claimChecks.map((c) => c.name), latestStatus: latest ? latest.content.status : null, latestTs: latest ? latest.content.ts : null });
    }
  }
  return rows;
}

function loadAllReceipts() {
  if (!fs.existsSync(FILES.ledger)) return [];
  return readLines(FILES.ledger).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// verify：反证优先。
// 规则：同属性存在新鲜 FAIL = uncovered（FAIL 覆盖早先 PASS 的证明力）；
// BLOCKED 不算覆盖；SKIPPED 需有效豁免；critical/high 未覆盖 → 阻断。
// security/safety 无豁免通道且 Fast Mode 不跳。
export function verify() {
  const fast = fastStatus();
  const rows = coverageStatus();
  const ver = verifyLedger();
  if (!ver.ok) {
    return { ok: false, code: 'LEDGER_BROKEN', issues: ver.issues.slice(0, 5), uncovered: [], blocking: [], covered: 0, note: '账本断链：先修复证据体系再谈覆盖' };
  }
  const matrix = loadMatrix();
  const allReceipts = loadAllReceipts();
  const byCheck = new Map();
  for (const e of allReceipts) {
    if (!byCheck.has(e.content.check)) byCheck.set(e.content.check, []);
    byCheck.get(e.content.check).push(e);
  }

  const uncovered = [], skippedByFast = [];
  let covered = 0;
  for (const row of rows) {
    const evs = [];
    for (const cn of row.claimedBy) {
      const scope = matrix.checks.find((c) => c.name === cn)?.scope || [];
      for (const e of byCheck.get(cn) || []) {
        if (scope.length && !scope.includes(row.module)) continue;
        evs.push({ status: e.content.status, fresh: e.content.fingerprint === ver.currentFingerprint, waived: covers(cn, row.attribute) });
      }
    }
    const freshEvs = evs.filter((e) => e.fresh);
    const hasFail = freshEvs.some((e) => e.status === 'FAIL');
    const hasPass = freshEvs.some((e) => e.status === 'PASS');
    const allBlocked = freshEvs.length > 0 && freshEvs.every((e) => e.status === 'BLOCKED');
    const waivedSkip = evs.some((e) => e.status === 'SKIPPED' && e.waived);
    const isProtected = PROTECTED_ATTRS.includes(row.attribute);
    const fastSkippable = fast.enabled && !isProtected && (row.level === 'medium' || row.level === 'low');

    if (hasFail) uncovered.push({ ...row, reason: '反证：存在同属性新鲜 FAIL 回执' });
    else if (hasPass) covered++;
    else if (waivedSkip && !isProtected) covered++;
    else if (allBlocked) uncovered.push({ ...row, reason: 'BLOCKED 不算覆盖' });
    else if (ENFORCE_LEVELS.includes(row.level)) {
      uncovered.push({
        ...row,
        reason: isProtected
          ? `${row.attribute} 红线：critical/high 必须有新鲜 PASS 回执（不可豁免、不可 Fast 跳过）`
          : '无新鲜认领检查回执',
      });
    } else if (fastSkippable && freshEvs.length === 0) skippedByFast.push(row);
    else uncovered.push({ ...row, reason: '低档位无回执（不阻断，建议补齐）' });
  }
  const blocking = uncovered.filter((r) => ENFORCE_LEVELS.includes(r.level));
  return {
    ok: blocking.length === 0,
    blocking,
    uncovered: uncovered.filter((r) => !ENFORCE_LEVELS.includes(r.level)),
    covered,
    skippedByFast,
    staleEvidence: ver.staleCount,
    checkedAt: nowIso(),
  };
}
