// 任务生命周期：start（envelope+risk+ownedPaths+fingerprint 绑定）/ status / finish（质量门收口）。
// v2.1：状态写入走 updateState（跨进程锁内读-改-写）；finish 加 fast 贷款阻断——证据贷款不能关闭任务。
import { nowIso } from './common.mjs';
import { loadState, updateState, fastStatus } from './state.mjs';
import { fingerprint } from './git.mjs';
import { verify as qualityVerify } from './quality.mjs';
import { verifyLedger, fastDebtReceipts } from './receipts.mjs';

const ENVELOPE_FIELDS = ['goal', 'scope', 'outOfScope', 'existingPattern', 'verification', 'escalation'];

export function start({ envelope, risk = 'medium', ownedPaths = [], refs = {}, reviewExclusions = [] }) {
  if (loadState().activeTask) return { ok: false, reason: '已有活跃任务，先 finish 或显式放弃' };
  const missing = ENVELOPE_FIELDS.filter((f) => !envelope[f]);
  if (missing.length) return { ok: false, reason: `派单信封缺字段：${missing.join(', ')}` };
  const fp = fingerprint(); // 重计算在锁外
  let conflict = null;
  const res = updateState((state) => {
    if (state.activeTask) { conflict = state.activeTask.id; return state; } // 并发兜底：另一进程已开任务
    const task = {
      id: `t-${Date.now().toString(36)}`,
      startedAt: nowIso(),
      envelope,
      risk,
      ownedPaths,
      refs,
      reviewExclusions,
      baseline: { ...fp },
    };
    state.activeTask = { id: task.id, startedAt: task.startedAt };
    state.tasks.push(task);
    return state;
  });
  if (conflict) return { ok: false, reason: `已有活跃任务 ${conflict}，先 finish 或显式放弃` };
  const active = res.tasks.find((t) => t.id === res.activeTask?.id);
  if (!active) return { ok: false, reason: '任务创建失败（状态异常）' };
  return { ok: true, task: active };
}

export function status() {
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id) || null;
  const fp = fingerprint();
  return {
    active: active ? { ...active, baselineDrift: active.baseline.fingerprint !== fp.fingerprint } : null,
    total: state.tasks.length,
    fast: fastStatus(state),
    stopStrikes: state.stopStrikes || null,
    degraded: state.degraded || [],
  };
}

export function finish({ force = false } = {}) {
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id);
  if (!active) return { ok: false, reason: '无活跃任务' };
  const qv = qualityVerify();
  const lv = verifyLedger({ task: active.id });
  const blockers = [];
  if (!qv.ok) blockers.push(...qv.blocking.map((b) => `${b.module}.${b.attribute}: ${b.reason}`));
  if (!lv.ok) blockers.push(`账本断链：${lv.issues.slice(0, 3).map((i) => i.code).join(',')}`);
  // fast 贷款债务：本任务名下存在新鲜 fast-SKIPPED 回执 → 证据贷款不能关闭任务
  const debt = fastDebtReceipts({ task: active.id });
  const debtChecks = [...new Set(debt.map((e) => e.content.check))];
  if (debtChecks.length) {
    blockers.push(`证据贷款不能关闭任务：fast 窗口跳过了 ${debtChecks.join(', ')}——补跑偿贷，或 --force 强收（留痕为 forced）`);
  }
  if (blockers.length && !force) {
    return { ok: false, blockers, note: '用 --force 显式强收（留痕为 forced）' };
  }
  const finished = nowIso();
  updateState((s) => {
    const t = s.tasks.find((x) => x.id === active.id);
    if (!t) return s;
    t.finishedAt = finished;
    t.forced = force && blockers.length > 0;
    t.finishBlockers = blockers;
    s.activeTask = null;
    return s;
  });
  return { ok: true, task: active.id, forced: force && blockers.length > 0, skippedBlockers: blockers };
}
