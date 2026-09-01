// quality：四态门 + 五性覆盖验证（反证优先）。
// v2.1：PROTECTED 扩三性（security/safety/privacy，唯一事实源 common.mjs）；
//      gate 执行器加 fast 贷款分支（allowFastSkip 预标记 + protected 永不跳 + windowId 留痕）；
//      verify 聚合判定——已执行的 FAIL 永不可被 fast 豁免（反证优先于一切 skip 判定）。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readJson, nowIso, readLines, boundedTail, PROTECTED_ATTRS } from './common.mjs';
import { FILES } from './config.mjs';
import { loadCatalog } from './catalog.mjs';
import { latestReceipts, verifyLedger, writeReceipt } from './receipts.mjs';
import { covers } from './waivers.mjs';
import { fastStatus } from './state.mjs';

const ATTRS = ['resilience', 'security', 'safety', 'privacy', 'reliability'];
const ENFORCE_LEVELS = ['critical', 'high'];

export function loadMatrix() {
  if (!fs.existsSync(FILES.matrix)) return { checks: [] };
  return readJson(FILES.matrix);
}

// gate <check>：执行 verification-matrix 中声明的检查命令，四态落账。
// Fast Mode 贷款：检查声明 allowFastSkip:true 且不证明红线三性且 fast 窗口开启 → 不执行，
// 直接落 SKIPPED 回执（reason=fast-mode，带 fastModeWindow）——只有同窗口的 SKIPPED 有效，债务由 task finish/risk scan 收口。
export function runGate(checkName, { note } = {}) {
  const matrix = loadMatrix();
  const check = matrix.checks.find((c) => c.name === checkName);
  if (!check) return { ok: false, reason: `verification-matrix 中无检查：${checkName}` };
  if (!check.command) return { ok: false, reason: `检查 ${checkName} 未声明 command（人工/外部检查，走 receipt write）` };
  const fast = fastStatus();
  const provesProtected = (check.proves || []).some((a) => PROTECTED_ATTRS.includes(a));
  if (provesProtected && check.allowFastSkip) {
    return { ok: false, reason: `红线：${check.proves.filter((a) => PROTECTED_ATTRS.includes(a)).join('/')} 检查不可声明 allowFastSkip（PROTECTED_FAST_SKIP）` };
  }
  if (fast.enabled && check.allowFastSkip === true && !provesProtected) {
    const receipt = writeReceipt({ check: checkName, status: 'SKIPPED', note: 'fast-mode', fastModeWindow: fast.windowId });
    return {
      ok: true, status: 'SKIPPED', skippedByFast: true, fastModeWindow: fast.windowId,
      until: fast.until, receiptSeq: receipt.seq, note: `Fast Mode 窗口内跳过（windowId ${fast.windowId}，until ${fast.until}）：证据贷款，task finish 前须补验`,
    };
  }
  let status = 'BLOCKED', out = '', code = null;
  try {
    out = execFileSync(check.shell || 'bash', ['-c', check.command], { encoding: 'utf8', timeout: check.timeoutMs || 300_000, maxBuffer: 64 * 1024 * 1024 });
    status = 'PASS'; code = 0;
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
    status = e.killed ? 'BLOCKED' : 'FAIL';
  }
  const receipt = writeReceipt({ check: checkName, status, note: note || (out ? boundedTail(out, 2000) : `exit ${code}`) });
  return { ok: status === 'PASS', status, exitCode: code, outputTail: boundedTail(out, 2000), receiptSeq: receipt.seq };
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
// 规则：同属性存在新鲜 FAIL = uncovered（FAIL 覆盖早先 PASS 的证明力，也覆盖一切 SKIPPED——
//       已执行出的 FAIL 永不可被 fast 豁免，fast 只允许跳过「未运行」）；
// BLOCKED 不算覆盖；waiver SKIPPED 需有效豁免；fast SKIPPED 需同 windowId 且 check 声明 allowFastSkip；
// critical/high 未覆盖 → 阻断。security/safety/privacy 红线三性无豁免通道且永不可 Fast 跳过。
export function verify() {
  const fast = fastStatus();
  const rows = coverageStatus();
  const ver = verifyLedger();
  if (!ver.ok) {
    return { ok: false, code: 'LEDGER_BROKEN', issues: ver.issues.slice(0, 5), uncovered: [], blocking: [], covered: 0, note: '账本断链：先修复证据体系再谈覆盖' };
  }
  const matrix = loadMatrix();
  const allowFastSkipChecks = new Set(matrix.checks.filter((c) => c.allowFastSkip === true).map((c) => c.name));
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
        evs.push({
          status: e.content.status,
          fresh: e.content.fingerprint === ver.currentFingerprint,
          waived: covers(cn, row.attribute),
          fastModeWindow: e.content.fastModeWindow || null,
          allowFastSkip: allowFastSkipChecks.has(cn),
        });
      }
    }
    const freshEvs = evs.filter((e) => e.fresh);
    const hasFail = freshEvs.some((e) => e.status === 'FAIL');
    const hasPass = freshEvs.some((e) => e.status === 'PASS');
    const allBlocked = freshEvs.length > 0 && freshEvs.every((e) => e.status === 'BLOCKED');
    const isProtected = PROTECTED_ATTRS.includes(row.attribute);
    const waivedSkip = !isProtected && evs.some((e) => e.status === 'SKIPPED' && e.waived);
    // fast skip 有效三条件：窗口开着 + 回执带同一 windowId + 该 check 声明 allowFastSkip
    const fastSkipValid = !isProtected && fast.enabled && fast.windowId && evs.some((e) =>
      e.status === 'SKIPPED' && e.fresh && e.fastModeWindow === fast.windowId && e.allowFastSkip);

    if (hasFail) uncovered.push({ ...row, reason: '反证：存在同属性新鲜 FAIL 回执（已执行的 FAIL 不可被 fast/waiver 豁免）' });
    else if (hasPass) covered++;
    else if (waivedSkip) covered++;
    else if (fastSkipValid) skippedByFast.push({ ...row, windowId: fast.windowId });
    else if (allBlocked) uncovered.push({ ...row, reason: 'BLOCKED 不算覆盖' });
    else if (ENFORCE_LEVELS.includes(row.level)) {
      uncovered.push({
        ...row,
        reason: isProtected
          ? `${row.attribute} 红线：critical/high 必须有新鲜 PASS 回执（不可豁免、不可 Fast 跳过）`
          : '无新鲜认领检查回执',
      });
    }
    // 低档位无回执：不阻断，建议补齐（也计入 uncovered 供展示）
    else if (freshEvs.some((e) => e.status === 'SKIPPED')) {
      uncovered.push({ ...row, reason: 'SKIPPED 回执无效（fast 窗口已关闭或 windowId 不匹配或 check 未声明 allowFastSkip）' });
    } else uncovered.push({ ...row, reason: '低档位无回执（不阻断，建议补齐）' });
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
