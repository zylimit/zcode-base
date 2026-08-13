// 哈希链账本：receipt write/verify。断链 fail-closed（篡改/删除/截断都破坏链）。
import fs from 'node:fs';
import path from 'node:path';
import { FILES, DIRS } from './config.mjs';
import { sha256, canonicalJson, readLines, appendLine, rel, nowIso } from './common.mjs';
import { fingerprint } from './git.mjs';
import { loadState } from './state.mjs';

export function writeReceipt({ check, status, task, evidence = [], note, fingerprint: fp }) {
  if (!['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(status)) throw new Error(`非法状态：${status}`);
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
    note: note || null,
  };
  const lines = readLines(FILES.ledger);
  const prev = lines.length ? JSON.parse(lines[lines.length - 1]).chainHash : '';
  const chainHash = sha256(prev + '\n' + canonicalJson(content));
  const seq = lines.length + 1;
  appendLine(FILES.ledger, { seq, chainHash, content });
  return { seq, chainHash, content };
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
