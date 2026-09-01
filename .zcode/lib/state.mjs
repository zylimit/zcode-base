// 运行态：.zcode/state/state.json（任务/fast/Stop 三振）。
// v2.1 机制层：
//   - 跨进程状态锁 withStateLock（hook 是宿主 spawn 的独立进程，无锁的读-改-写必然丢更新）
//   - 损坏隔离 quarantine（坏状态文件既不 brick 引擎也不静默重建：移开+留痕+按默认继续）
//   - fast 贷款语义（minutes/reason 必填 + windowId 窗口身份）
//   - Stop 三振按状态分键（sha256(task+fingerprint+缺失清单)，替换旧 stopCount 按天计数）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FILES, DIRS } from './config.mjs';
import { readJson, writeJsonAtomic, nowIso, appendLine, readLines } from './common.mjs';

const EMPTY = { version: 1, activeTask: null, tasks: [], fast: null, stopStrikes: null, degraded: [] };

// ---------- 跨进程状态锁 ----------
// open(lockPath,'wx') 独占创建 → 写 {pid, ownerToken, createdAt}；
// EEXIST 且锁龄 >staleMs 且持锁进程已死（信号 0 探测，EPERM=存活）→ 删锁重试（stale 突破）；
// 等待 busy-wait pollMs，超 timeoutMs 抛 LOCK_TIMEOUT；释放读回 ownerToken 匹配才删（防误删他人的锁）。
const LOCK_WAIT_MS = 15_000;
const LOCK_STALE_MS = 120_000;
const LOCK_POLL_MS = 25;

// 同步自旋等待（引擎全同步；零依赖下唯一可靠的忙等原语）
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lockOwnerAlive(lockPath) {
  try {
    const info = readJson(lockPath);
    if (!Number.isInteger(info.pid) || info.pid <= 0) return false;
    try { process.kill(info.pid, 0); return true; }
    catch (e) { return e.code === 'EPERM'; } // EPERM=目标进程存在但非本人所有 → 存活
  } catch { return false; }
}

export function withStateLock(file, fn) {
  const lockPath = `${file}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const ownerToken = crypto.randomUUID();
  const started = Date.now();
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ownerToken, createdAt: nowIso() }));
    } catch (e) {
      if (e.code !== 'EEXIST') throw new Error(`锁 ${lockPath} 获取失败：${e.message}（LOCK_FAILED）`);
      let age = -1;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { /* 锁刚被删，进下一轮竞争 */ }
      if (age > LOCK_STALE_MS && !lockOwnerAlive(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch { /* 已被他人突破，继续竞争 */ }
        continue;
      }
      if (Date.now() - started >= LOCK_WAIT_MS) {
        throw new Error(`锁 ${lockPath} 等待超时（${LOCK_WAIT_MS}ms）——另一进程持有中且未释放（LOCK_TIMEOUT）`);
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* 已关闭 */ }
    try {
      const cur = readJson(lockPath);
      if (cur && cur.ownerToken === ownerToken) fs.unlinkSync(lockPath);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e; // 非ENOENT的释放失败必须可见（锁残留可被 stale 突破，但不可静默）
    }
  }
}

// ---------- 损坏隔离 quarantine ----------
// JSON 损坏：改名 <file>.corrupt-<ts> 取证保留 + 追加 .zcode/state/quarantine.jsonl 事件 → 按默认值继续。
// 运营纪律：核对隔离原件确认无工作丢失，不要删除取证文件。
export function quarantineState(file, error) {
  const quarantined = `${file}.corrupt-${Date.now()}`;
  fs.renameSync(file, quarantined);
  try {
    appendLine(path.join(DIRS.state, 'quarantine.jsonl'), {
      ts: nowIso(),
      file: path.basename(file),
      quarantinedAs: path.basename(quarantined),
      error: String(error?.message ?? error).slice(0, 400),
    });
  } catch { /* 事件追加 best-effort：rename 已保全取证原件 */ }
  return quarantined;
}

export function quarantineEvents() {
  return readLines(path.join(DIRS.state, 'quarantine.jsonl')).map((l) => {
    try { return JSON.parse(l); } catch { return { ts: null, file: 'unknown', error: 'quarantine 记录自身不可解析' }; }
  });
}

// ---------- 读/写/更新 ----------
// 读不加锁（写全部走 tmp+rename 原子替换，读到的永远是完整 JSON）；写与读-改-写一律锁内。
// 重计算（git diff/fingerprint）必须在锁外完成后再进锁提交——持锁跑全仓 diff 会超出 stale 窗口导致双写。
function readStateFile(file, fallback) {
  if (!fs.existsSync(file)) return structuredClone(fallback);
  try {
    const s = readJson(file);
    return { ...structuredClone(fallback), ...s };
  } catch (e) {
    // 只对 JSON 语法损坏隔离（半写/篡改）；EACCES/EMFILE 等读写错误必须 rethrow——
    // 完好但暂不可读的状态若被静默隔离，等于把好数据当坏数据丢弃且引擎无感。
    if (e instanceof SyntaxError) {
      quarantineState(file, e);
      return structuredClone(fallback);
    }
    throw e;
  }
}

export function loadState() {
  return readStateFile(FILES.state, EMPTY);
}

export function saveState(state) {
  fs.mkdirSync(DIRS.state, { recursive: true });
  withStateLock(FILES.state, () => writeJsonAtomic(FILES.state, state));
}

// updateState：锁内读-改-写，并发安全的唯一入口（mutator 须为纯计算，不做 IO 重活）。
export function updateState(mutator) {
  fs.mkdirSync(DIRS.state, { recursive: true });
  return withStateLock(FILES.state, () => {
    const next = mutator(readStateFile(FILES.state, EMPTY));
    if (next === undefined) throw new Error('state 更新函数返回 undefined（STATE_UPDATE_FAILED）');
    writeJsonAtomic(FILES.state, next);
    return next;
  });
}

// ---------- Fast Mode 贷款语义 ----------
// fast on --minutes N --reason "..."：minutes 必填（clamp 1..480）、reason 必填非空——无期限无债务人的贷款永远无法偿还。
// 每次开启生成新 windowId：SKIPPED 回执绑定 fastModeWindow，只有同一窗口内的 SKIPPED 才有效；
// 旧窗口的 SKIPPED 在新窗口/无窗口时一律 invalid。已执行出 FAIL 的检查永不可被 fast 豁免（见 quality verify 反证优先）。
export function fastStatus(state = loadState()) {
  const f = state.fast;
  if (!f || !f.enabled) return { enabled: false };
  const untilRaw = f.until || f.expiresAt || null;
  const until = untilRaw ? new Date(untilRaw).getTime() : 0;
  if (!(until > Date.now())) return { enabled: false, expiredAt: untilRaw };
  return {
    enabled: true,
    reason: f.reason || null,
    minutes: f.minutes ?? null,
    windowId: f.windowId || null,
    createdAt: f.createdAt || null,
    until: untilRaw,
  };
}

export function fastSet(on, { minutes, reason } = {}) {
  if (!on) {
    updateState((s) => ({ ...s, fast: null }));
    return fastStatus();
  }
  const m = Number(minutes);
  if (minutes === undefined || minutes === null || minutes === '' || !Number.isFinite(m)) {
    throw new Error('fast on 缺 --minutes（必填，clamp 1..480）：贷款必须有期限');
  }
  if (!reason || !String(reason).trim()) {
    throw new Error('fast on 缺 --reason（必填非空）：贷款必须有债务人与事由，无期限的放水会活过它的借口');
  }
  const clamped = Math.min(480, Math.max(1, Math.round(m)));
  const createdAt = nowIso();
  const loan = {
    version: 1,
    enabled: true,
    reason: String(reason).trim(),
    minutes: clamped,
    windowId: crypto.randomUUID(),
    createdAt,
    until: new Date(Date.now() + clamped * 60_000).toISOString(),
  };
  const next = updateState((s) => ({ ...s, fast: loan }));
  return fastStatus(next);
}

// ---------- Stop 三振按状态分键 ----------
// strike key = sha256(taskId + fingerprint + 缺失清单 JSON)：不同缺失项各自计数（修好一项不误耗另一项额度，
// 两个缺失项交替出现也各自累计、互不消耗），清单/指纹/任务任一变化 → 新键从零计。
// 同键连拦 ≥limit 次 → 第 limit+1 次放行交人工审查。多槽 Map 存储（最近 MAX_KEYS 个键，访问序淘汰防无限增长）。
// 替换旧 stopCount（按天全局计数）：一个顽固缺失项耗尽全部额度、或两个缺失项交替各计一次永不触发，都是分键修正的缺陷。
const STOP_STRIKE_MAX_KEYS = 8;

export function bumpStopStrike(key, limit = 3) {
  const next = updateState((s) => {
    const prev = s.stopStrikes || {};
    const counts = { ...(prev.counts || {}) };
    const order = [...(prev.order || []).filter((k) => k in counts)];
    counts[key] = (counts[key] || 0) + 1;
    order.push(key);
    while (order.length > STOP_STRIKE_MAX_KEYS) {
      const evicted = order.shift();
      if (evicted !== key) delete counts[evicted];
    }
    return { ...s, stopStrikes: { version: 2, counts, order, updatedAt: nowIso() } };
  });
  const count = next.stopStrikes.counts[key] || 0;
  return { count, over: count > limit };
}
