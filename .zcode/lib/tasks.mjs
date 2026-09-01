// 任务生命周期：start（envelope+risk+ownedPaths+fingerprint 绑定）/ status / finish（质量门收口）。
// v2.1：状态写入走 updateState（跨进程锁内读-改-写）；finish 加 fast 贷款阻断——证据贷款不能关闭任务。
// v2.2（Task 7.6）：start 对 owned+tracked+dirty 路径逐文件 digest 建 knownHashes 基线（含 preexistingDirty 标记，
// 候选过滤到信封 ownedPaths 内——并发检测只对任务可能写的路径有意义，全仓 digest 在大仓不可行，同 codex baselineHashes）；
// refreshTask 供 PostToolUse 在成功写后更新基线与 touchedPaths（自己写的样子=新基线，他人的改动才叫冲突）。
import path from 'node:path';
import { nowIso } from './common.mjs';
import { loadState, updateState, fastStatus } from './state.mjs';
import { fingerprint, listPaths, statusPaths } from './git.mjs';
import { verify as qualityVerify, completionStatus } from './quality.mjs';
import { verifyLedger, fastDebtReceipts } from './receipts.mjs';
import { fileDigest, pathOwned } from './writes.mjs';
import { ROOT } from './config.mjs';

const ENVELOPE_FIELDS = ['goal', 'scope', 'outOfScope', 'existingPattern', 'verification', 'escalation'];

// 基线候选：ownedPaths ∪ tracked ∪ dirty（staged+unstaged+untracked），过滤到信封内 —— IO 重活，锁外完成。
function baselineHashes(ownedPaths) {
  const dirty = statusPaths();
  const tracked = listPaths();
  const candidates = [...new Set([...ownedPaths, ...tracked, ...dirty.staged, ...dirty.unstaged, ...dirty.untracked])]
    .filter((p) => pathOwned(ownedPaths, p));
  const knownHashes = {};
  for (const rel of candidates) knownHashes[rel] = fileDigest(path.join(ROOT, rel));
  return { knownHashes, preexistingDirty: [...new Set([...dirty.staged, ...dirty.unstaged, ...dirty.untracked])] };
}

export function start({ envelope, risk = 'medium', ownedPaths = [], refs = {}, reviewExclusions = [] }) {
  if (loadState().activeTask) return { ok: false, reason: '已有活跃任务，先 finish 或显式放弃' };
  const missing = ENVELOPE_FIELDS.filter((f) => !envelope[f]);
  if (missing.length) return { ok: false, reason: `派单信封缺字段：${missing.join(', ')}` };
  const fp = fingerprint(); // 重计算在锁外
  const baseline = baselineHashes(ownedPaths); // digest 重活同样锁外
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
      baseline: { ...fp, knownHashes: baseline.knownHashes, preexistingDirty: baseline.preexistingDirty },
      touchedPaths: [],
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

// 成功写后刷新：把已写路径的当前 digest 并入基线（下次写前比对的是「自己上一次写的样子」）+ 记 touchedPaths。
export function refreshTask(relPaths) {
  const digests = {};
  for (const rel of relPaths) digests[rel] = fileDigest(path.join(ROOT, rel)); // 锁外 IO
  const next = updateState((s) => {
    const t = s.tasks.find((x) => x.id === s.activeTask?.id);
    if (!t) return s;
    t.touchedPaths = [...new Set([...(t.touchedPaths || []), ...relPaths])].sort();
    t.baseline = { ...(t.baseline || {}), knownHashes: { ...(t.baseline?.knownHashes || {}), ...digests } };
    return s;
  });
  return { ok: true, refreshed: relPaths };
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
  // completion 完成门聚合（Task 8.6）：required 检查可接受性（planHash/executor 绑定）+
  // optional 已执行 FAIL 阻断 + review 门（requireForFinish 采纳且 risk∈{medium,high} 无 fast）
  const completion = completionStatus(active);
  if (!completion.ok) blockers.push(...completion.blockers);
  if (blockers.length && !force) {
    return { ok: false, blockers, completion, note: '用 --force 显式强收（留痕为 forced）' };
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
