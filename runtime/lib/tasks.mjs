// 任务生命周期：start（envelope+risk+ownedPaths+fingerprint 绑定）/ status / finish（质量门收口）。
import { nowIso } from './common.mjs';
import { loadState, saveState, fastStatus } from './state.mjs';
import { fingerprint } from './git.mjs';
import { verify as qualityVerify } from './quality.mjs';
import { verifyLedger } from './receipts.mjs';

const ENVELOPE_FIELDS = ['goal', 'scope', 'outOfScope', 'existingPattern', 'verification', 'escalation'];

export function start({ envelope, risk = 'medium', ownedPaths = [], refs = {}, reviewExclusions = [] }) {
  const state = loadState();
  if (state.activeTask) return { ok: false, reason: `已有活跃任务 ${state.activeTask.id}，先 finish 或显式放弃` };
  const missing = ENVELOPE_FIELDS.filter((f) => !envelope[f]);
  if (missing.length) return { ok: false, reason: `派单信封缺字段：${missing.join(', ')}` };
  const fp = fingerprint();
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
  saveState(state);
  return { ok: true, task };
}

export function status() {
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id) || null;
  const fp = fingerprint();
  return {
    active: active ? { ...active, baselineDrift: active.baseline.fingerprint !== fp.fingerprint } : null,
    total: state.tasks.length,
    fast: fastStatus(state),
    stopCount: state.stopCount,
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
  if (blockers.length && !force) {
    return { ok: false, blockers, note: '用 --force 显式强收（留痕为 forced）' };
  }
  active.finishedAt = nowIso();
  active.forced = force && blockers.length > 0;
  active.finishBlockers = blockers;
  state.activeTask = null;
  saveState(state);
  return { ok: true, task: active.id, forced: active.forced, skippedBlockers: blockers };
}
