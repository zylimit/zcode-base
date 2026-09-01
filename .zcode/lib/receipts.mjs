// 哈希链账本：receipt write/verify。断链 fail-closed（篡改/删除/截断都破坏链）。
// v2.1：追加走跨进程锁（读尾算 prev + append 必须原子，并发双花 prev = 断链）；
//      note 统一脱敏+预算截断（秘密不入账本红线）；SKIPPED 回执携带 fastModeWindow 窗口身份。
import fs from 'node:fs';
import path from 'node:path';
import { FILES, DIRS } from './config.mjs';
import { sha256, canonicalJson, readLines, appendLine, rel, nowIso, boundedTail } from './common.mjs';
import { fingerprint } from './git.mjs';
import { loadState, withStateLock } from './state.mjs';

export function writeReceipt({ check, status, task, evidence = [], note, fingerprint: fp, fastModeWindow }) {
  if (!['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(status)) throw new Error(`非法状态：${status}`);
  // 重计算（fingerprint/证据哈希）在锁外——持锁跑全仓 diff 会超出锁 stale 窗口
  const fpResult = fp ? { fingerprint: fp, truncated: false } : fingerprint();
  const activeTask = task || loadState().activeTask?.id || null;
  const content = {
    ts: nowIso(),
    task: activeTask,
    check,
    status,
    fingerprint: fpResult.fingerprint,
    evidence: evidence.map((p) => {
      const abs = path.resolve(p);
      return { path: rel(process.cwd(), abs), sha256: fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : null };
    }),
    // 出口脱敏：命令输出里的 token 不得原样进账本（账本可能随项目分发）
    note: note ? boundedTail(String(note), 2000) : null,
  };
  if (fastModeWindow) content.fastModeWindow = fastModeWindow;
  // 读尾取 prev + 追加：锁内原子完成（并发写会双花 prev 导致断链）
  const written = withStateLock(FILES.ledger, () => {
    const lines = readLines(FILES.ledger);
    const prev = lines.length ? JSON.parse(lines[lines.length - 1]).chainHash : '';
    const chainHash = sha256(prev + '\n' + canonicalJson(content));
    const seq = lines.length + 1;
    appendLine(FILES.ledger, { seq, chainHash, content });
    return { seq, chainHash };
  });
  return { seq: written.seq, chainHash: written.chainHash, content };
}

export function verifyLedger({ task: taskId } = {}) {
  const lines = readLines(FILES.ledger);
  let prev = '';
  const issues = [];
  let expectedSeq = 1;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { issues.push({ seq: expectedSeq, code: 'MALFORMED_LINE' }); break; }
    if (entry.seq !== expectedSeq) issues.push({ seq: entry.seq, code: 'SEQ_GAP', expected: expectedSeq });
    const recomputed = sha256(prev + '\n' + canonicalJson(entry.content));
    if (recomputed !== entry.chainHash) issues.push({ seq: entry.seq, code: 'CHAIN_BROKEN' });
    // 证据文件重哈希（在盘时）
    for (const ev of entry.content.evidence || []) {
      if (ev.sha256 == null) continue;
      const abs = path.resolve(ev.path);
      if (!fs.existsSync(abs)) issues.push({ seq: entry.seq, code: 'EVIDENCE_MISSING', path: ev.path });
      else if (sha256(fs.readFileSync(abs)) !== ev.sha256) issues.push({ seq: entry.seq, code: 'EVIDENCE_TAMPERED', path: ev.path });
    }
    prev = entry.chainHash;
    expectedSeq++;
  }
  const currentFp = fingerprint().fingerprint;
  const receipts = taskId
    ? lines.map((l) => JSON.parse(l)).filter((e) => e.content.task === taskId)
    : lines.map((l) => JSON.parse(l));
  const staleCount = receipts.filter((e) => e.content.fingerprint !== currentFp).length;
  return {
    ok: issues.length === 0,
    total: lines.length,
    issues,
    staleCount,
    currentFingerprint: currentFp,
  };
}

// 当前 fingerprint 下的最新回执（按 check 取最后一条——后到覆盖先到）。
export function latestReceipts({ fresh = true } = {}) {
  const lines = readLines(FILES.ledger).map((l) => JSON.parse(l));
  const fp = fingerprint().fingerprint;
  const byCheck = new Map();
  for (const e of lines) {
    if (fresh && e.content.fingerprint !== fp) continue;
    byCheck.set(e.content.check, e);
  }
  return byCheck;
}

export function ledgerStats() {
  const lines = readLines(FILES.ledger);
  const byStatus = { PASS: 0, FAIL: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const l of lines) {
    try { byStatus[JSON.parse(l).content.status]++; } catch { /* malformed counted in verify */ }
  }
  return { total: lines.length, byStatus };
}

// fast 贷款债务（任务/窗口维度，**不做 fingerprint 过滤**——债务不随指纹漂移逃逸）：
// 带 fastModeWindow 的 SKIPPED 回执即债务，持续到还清（同 check 在其后重新执行出非 SKIPPED 回执才算偿贷）。
// 消费点：task finish 阻断（证据贷款不能关闭任务）+ risk scan FAST_MODE_DEBT 点名 + invariants 播报。
export function fastDebtReceipts({ task, windowId } = {}) {
  const lines = readLines(FILES.ledger)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const skipped = lines.filter((e) => e.content.status === 'SKIPPED' && e.content.fastModeWindow)
    .filter((e) => !task || e.content.task === task)
    .filter((e) => !windowId || e.content.fastModeWindow === windowId);
  // 还清判定：该 check 在 SKIPPED 之后（seq 更大、同任务）被真正执行过（任何非 SKIPPED 回执）
  return skipped.filter((s) => !lines.some((e) => e.seq > s.seq
    && e.content.check === s.content.check
    && (!task || e.content.task === task)
    && e.content.status !== 'SKIPPED'));
}
