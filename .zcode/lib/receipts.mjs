// 哈希链账本：receipt write/verify。断链 fail-closed（篡改/删除/截断都破坏链）。
// v2.1：追加走跨进程锁（读尾算 prev + append 必须原子，并发双花 prev = 断链）；
//      note 统一脱敏+预算截断（秘密不入账本红线）；SKIPPED 回执携带 fastModeWindow 窗口身份。
// v2.3（Task 8.4）：
//   - 回执新增 evidencePath/evidenceBytes/evidenceHash 三重句柄 + planHash（可选字段，链内覆盖；
//     旧回执缺省这些字段——canonicalJson 按各自 content 重算，旧链不受影响，兼容放行并标注 legacy）
//   - verifyLedger 逐条复验 evidence：路径必须相对且不含 ..（EVIDENCE_PATH_UNSAFE）→ realpath 落在
//     .zcode/state/evidence 内（EVIDENCE_PATH_ESCAPE）→ 字节长+sha256 逐字节比对（EVIDENCE_TAMPERED/EVIDENCE_MISSING）→ fail-closed exit 4
//   - 账本轮转：保留最新 rotateKeep 条（默认 500，harness.json ledger.rotateKeep 可调，≤0 关闭）；
//     anchor=最后被丢弃条目的链值（sidecar ledger.anchor.json）——保留尾部仍可从 anchor 端到端验证；
//     anchor 侧车损坏/缺失与账本状态不一致时按断链报（fail-visible，不静默降级）
import fs from 'node:fs';
import path from 'node:path';
import { FILES, DIRS, ROOT, loadHarnessConfig } from './config.mjs';
import { sha256, canonicalJson, readLines, appendLine, rel, nowIso, boundedTail, writeJsonAtomic } from './common.mjs';
import { fingerprint } from './git.mjs';
import { loadState, withStateLock } from './state.mjs';

const ANCHOR_FILE = path.join(DIRS.state, 'ledger.anchor.json');
const EVIDENCE_ROOT = () => path.join(DIRS.state, 'evidence');

export function writeReceipt({ check, status, task, evidence = [], note, fingerprint: fp, fastModeWindow, planHash, evidenceFile }) {
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
  if (planHash) content.planHash = planHash;
  // evidence 三重句柄（Task 8.4）：全量输出在独立文件，回执只带路径+字节长+哈希
  if (evidenceFile) {
    content.evidencePath = evidenceFile.path;
    content.evidenceBytes = evidenceFile.bytes;
    content.evidenceHash = evidenceFile.hash;
  }
  // 读尾取 prev + 追加（+轮转）：锁内原子完成（并发写会双花 prev 导致断链）
  const written = withStateLock(FILES.ledger, () => {
    let lines = readLines(FILES.ledger);
    // 轮转：追加后超 rotateKeep → 丢最旧（anchor 记其链值），保留尾部原子重写。
    // 崩溃窗口两侧（账本已转/anchor 未落，或反之）都表现为 verify 失败（SEQ_GAP/CHAIN_BROKEN）——fail-visible。
    let rotation = null;
    const keep = rotateKeepLines();
    if (keep > 0 && lines.length + 1 > keep) {
      const dropped = lines.slice(0, lines.length + 1 - keep);
      const kept = lines.slice(lines.length + 1 - keep);
      const lastDropped = JSON.parse(dropped[dropped.length - 1]);
      const tmp = `${FILES.ledger}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '');
      fs.renameSync(tmp, FILES.ledger);
      writeJsonAtomic(ANCHOR_FILE, {
        version: 1,
        chainHash: lastDropped.chainHash,
        throughSeq: lastDropped.seq,
        dropped: dropped.length,
        rotatedAt: nowIso(),
      });
      lines = kept;
      rotation = { dropped: dropped.length, anchorChainHash: lastDropped.chainHash, throughSeq: lastDropped.seq };
    }
    const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    const prev = last ? last.chainHash : (rotation ? rotation.anchorChainHash : '');
    const seq = last ? last.seq + 1 : (rotation ? rotation.throughSeq + 1 : 1);
    const chainHash = sha256(prev + '\n' + canonicalJson(content));
    appendLine(FILES.ledger, { seq, chainHash, content });
    return { seq, chainHash, rotation };
  });
  const out = { seq: written.seq, chainHash: written.chainHash, content };
  if (written.rotation) out.rotation = written.rotation;
  return out;
}

// 轮转保留条数：harness.json ledger.rotateKeep（默认 500；≤0 关闭轮转）。测试用小阈值参数化。
function rotateKeepLines() {
  const cfg = loadHarnessConfig();
  const v = cfg.ledger?.rotateKeep;
  return Number.isFinite(v) ? v : 500;
}

// anchor 侧车：{ chainHash, throughSeq } | { corrupt:true } | null
function readAnchor() {
  if (!fs.existsSync(ANCHOR_FILE)) return null;
  try {
    const a = JSON.parse(fs.readFileSync(ANCHOR_FILE, 'utf8'));
    if (typeof a.chainHash !== 'string' || !Number.isInteger(a.throughSeq)) return { corrupt: true };
    return a;
  } catch { return { corrupt: true }; }
}

// evidence 三重校验（单条回执）：返回 issue 或 null。导出供测试直接验证路径安全逻辑。
export function checkEvidence(content) {
  if (content.evidencePath === undefined) return null; // 旧回执：无 evidence 句柄（legacy 兼容放行）
  const p = content.evidencePath;
  if (typeof p !== 'string' || !p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
    return { code: 'EVIDENCE_PATH_UNSAFE', path: p };
  }
  if (!Number.isInteger(content.evidenceBytes) || content.evidenceBytes < 0
    || typeof content.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(content.evidenceHash)) {
    return { code: 'EVIDENCE_PATH_UNSAFE', path: p, detail: 'evidenceBytes/evidenceHash 缺失或非法' };
  }
  const abs = path.resolve(ROOT, p);
  const root = EVIDENCE_ROOT();
  const inside = (base, target) => {
    const r = path.relative(base, target);
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
  };
  if (!inside(root, abs)) return { code: 'EVIDENCE_PATH_ESCAPE', path: p };
  let realAbs, realRoot;
  try {
    realAbs = fs.realpathSync(abs);
    realRoot = fs.realpathSync(root);
  } catch (e) {
    if (e.code === 'ENOENT') return { code: 'EVIDENCE_MISSING', path: p };
    return { code: 'EVIDENCE_PATH_ESCAPE', path: p, detail: e.code };
  }
  if (!inside(realRoot, realAbs)) return { code: 'EVIDENCE_PATH_ESCAPE', path: p };
  let buf;
  try { buf = fs.readFileSync(realAbs); } catch (e) {
    if (e.code === 'ENOENT') return { code: 'EVIDENCE_MISSING', path: p };
    throw e;
  }
  if (buf.length !== content.evidenceBytes) return { code: 'EVIDENCE_TAMPERED', path: p, detail: `bytes ${buf.length} ≠ ${content.evidenceBytes}` };
  if (sha256(buf) !== content.evidenceHash) return { code: 'EVIDENCE_TAMPERED', path: p, detail: 'sha256 mismatch' };
  return null;
}

export function verifyLedger({ task: taskId } = {}) {
  const anchor = readAnchor();
  const lines = readLines(FILES.ledger);
  let prev = anchor && !anchor.corrupt ? anchor.chainHash : '';
  const issues = [];
  if (anchor?.corrupt) issues.push({ seq: null, code: 'ANCHOR_CORRUPT', path: rel(ROOT, ANCHOR_FILE) });
  let expectedSeq = anchor && !anchor.corrupt ? anchor.throughSeq + 1 : 1;
  let legacyEvidence = 0;
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
    // evidence 三重句柄复验（Task 8.4）：路径安全 → realpath 逃逸 → 逐字节比对
    if (entry.content.evidencePath === undefined) legacyEvidence++;
    else {
      const issue = checkEvidence(entry.content);
      if (issue) issues.push({ seq: entry.seq, ...issue });
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
    rotated: Boolean(anchor),
    anchor: anchor && !anchor.corrupt ? { throughSeq: anchor.throughSeq, chainHash: anchor.chainHash } : null,
    // 旧格式回执（无 evidence 三重句柄）：兼容放行，标注 legacy——下次写入起新格式（不强制迁移）
    legacyEvidenceReceipts: legacyEvidence,
    legacy: legacyEvidence > 0 ? '旧回执无 evidence 句柄：兼容放行；下次写入起新格式' : null,
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
