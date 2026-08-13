// 运行态：.zbase/state.json（任务/fast/停止计数）。
import fs from 'node:fs';
import path from 'node:path';
import { FILES, DIRS } from './config.mjs';
import { readJson, writeJsonAtomic, nowIso } from './common.mjs';

const EMPTY = { version: 1, activeTask: null, tasks: [], fast: null, stopCount: 0, stopCountDate: null, degraded: [] };

export function loadState() {
  if (!fs.existsSync(FILES.state)) return structuredClone(EMPTY);
  const s = readJson(FILES.state);
  return { ...structuredClone(EMPTY), ...s };
}

export function saveState(state) {
  fs.mkdirSync(DIRS.state, { recursive: true });
  writeJsonAtomic(FILES.state, state);
}

export function fastStatus(state = loadState()) {
  const f = state.fast;
  if (!f || !f.enabled) return { enabled: false };
  const expires = new Date(f.expiresAt).getTime();
  if (Date.now() > expires) return { enabled: false, expiredAt: f.expiresAt };
  return { enabled: true, expiresAt: f.expiresAt, reason: f.reason || null };
}

export function fastSet(on, hours, reason, state = loadState()) {
  if (on) {
    const h = hours && hours > 0 ? hours : 24;
    state.fast = { enabled: true, startedAt: nowIso(), expiresAt: new Date(Date.now() + h * 3600_000).toISOString(), reason: reason || null };
  } else {
    state.fast = null;
  }
  saveState(state);
  return fastStatus(state);
}

// Stop 续命计数：按天归零，封顶 2 次（ZCode 原生上限 3，留 1 次余量防死循环）。
export function bumpStopCount(limit = 2) {
  const state = loadState();
  const today = nowIso().slice(0, 10);
  if (state.stopCountDate !== today) { state.stopCount = 0; state.stopCountDate = today; }
  state.stopCount += 1;
  saveState(state);
  return { count: state.stopCount, over: state.stopCount > limit };
}
