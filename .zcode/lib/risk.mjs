// 风险扫描：失败连击诊断（连败 3 次 = 诊断问题非重试问题）+ 危险状态面。
import { readGateLog } from './audit.mjs';
import { ledgerStats, verifyLedger } from './receipts.mjs';
import { fastStatus } from './state.mjs';
import { expiredCount } from './waivers.mjs';

export function scan() {
  const findings = [];
  const ledger = ledgerStats();
  const entries = readGateLog();
  const recentDenies = entries.filter((e) => e.action === 'deny').slice(-20);

  // 同规则连续 deny ≥3：说明模型在反复撞同一堵墙，需要人看而不是继续重试。
  const streak = new Map();
  for (const e of entries.slice(-50)) {
    if (e.action !== 'deny') { streak.delete(`${e.event}:${e.rule}`); continue; }
    const k = `${e.event}:${e.rule}`;
    streak.set(k, (streak.get(k) || 0) + 1);
  }
  for (const [rule, n] of streak) {
    if (n >= 3) findings.push({ severity: 'high', code: 'DENY_STREAK', rule, count: n, note: '连续撞同一门禁 ≥3 次：停下诊断，不是换个写法再试' });
  }

  if (ledger.byStatus.FAIL >= 3) findings.push({ severity: 'medium', code: 'FAIL_ACCUMULATION', count: ledger.byStatus.FAIL, note: '账本 FAIL 累积 ≥3：先修根因再继续' });
  if (ledger.byStatus.BLOCKED > 0) findings.push({ severity: 'medium', code: 'BLOCKED_PENDING', count: ledger.byStatus.BLOCKED, note: '存在 BLOCKED 回执：阻断项未解除' });

  const ver = verifyLedger();
  if (!ver.ok) findings.push({ severity: 'critical', code: 'LEDGER_BROKEN', issues: ver.issues.slice(0, 5), note: '账本断链：证据体系不可信，先查篡改/截断' });

  const fast = fastStatus();
  if (fast.enabled) findings.push({ severity: 'info', code: 'FAST_MODE_ON', expiresAt: fast.expiresAt, note: 'Fast Mode 生效中：质量流程放水，安全护栏照旧' });

  const expired = expiredCount();
  if (expired > 0) findings.push({ severity: 'medium', code: 'WAIVER_EXPIRED', count: expired, note: '豁免已到期：重新计入未覆盖' });

  return { ok: !findings.some((f) => f.severity === 'critical' || f.severity === 'high'), findings, ledger, recentDenies: recentDenies.length };
}
