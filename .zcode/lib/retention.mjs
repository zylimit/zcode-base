// 证据留存：按策略销毁过期留痕；deny 记录窗口加倍保留（审计需要拦截历史）。
// v2.3（Task 8.4）：
//   - evidence 引用保护：删除前构造 protectedPaths——当前 diff（fingerprint）回执引用的 evidence
//     + 每 (task,check) 最新回执引用的 evidence +（zcode 特有超集）保留账本内任一条目引用的 evidence。
//     超集是必须的：verifyLedger 逐条复验全账本 evidence，删掉任何仍被保留条目引用的文件 =
//     自己制造 EVIDENCE_MISSING 断链。轮转（ledger.rotateKeep）丢出的旧条目解除引用后，其 evidence 才可清理。
//   - quarantine 取证文件（.corrupt-*）永不删。
//   - gate-log 尺寸轮转（默认 4MB → .1 保一代，retention.gateLogMaxBytes 可调）。
//   - --dry-run：只报清单不动盘。
import fs from 'node:fs';
import path from 'node:path';
import { FILES, DIRS, ROOT, loadHarnessConfig } from './config.mjs';
import { readLines, nowIso, rel } from './common.mjs';
import { fingerprint } from './git.mjs';

// gate-log 尺寸轮转：超限 → 现文件改名 .1（覆盖旧一代，保一代），当前文件从空重新开始。
export function rotateGateLog({ maxBytes } = {}) {
  const cfg = loadHarnessConfig();
  const limit = maxBytes ?? cfg.retention?.gateLogMaxBytes ?? 4 * 1024 * 1024;
  let st;
  try { st = fs.statSync(FILES.gateLog); } catch (e) {
    if (e.code === 'ENOENT') return { rotated: false };
    throw e;
  }
  if (st.size <= limit) return { rotated: false };
  const archive = `${FILES.gateLog}.1`;
  try { fs.unlinkSync(archive); } catch { /* 无旧一代 */ }
  fs.renameSync(FILES.gateLog, archive);
  return { rotated: true, archive: rel(ROOT, archive), bytes: st.size, limit };
}

// evidence 引用保护集（仓库相对 posix 路径）。
function protectedEvidencePaths() {
  const entries = readLines(FILES.ledger)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const currentFp = fingerprint().fingerprint;
  const prot = new Set();
  let fresh = 0, latest = 0;
  const latestPerKey = new Map(); // task\0check → seq 最大条目
  for (const e of entries) {
    const p = e.content.evidencePath;
    if (typeof p !== 'string') continue;
    const posix = p.split('\\').join('/');
    prot.add(posix); // 超集：保留账本内任一引用（verifyLedger 全账本复验的配套）
    if (e.content.fingerprint === currentFp) fresh++;
    const key = `${e.content.task ?? 'no-task'}\0${e.content.check}`;
    const cur = latestPerKey.get(key);
    if (!cur || e.seq > cur.seq) latestPerKey.set(key, e);
  }
  for (const e of latestPerKey.values()) {
    if (typeof e.content.evidencePath === 'string') latest++;
  }
  return { prot, breakdown: { freshReceipts: fresh, latestPerCheck: latest, retainedReferences: prot.size } };
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

export function prune({ days, dryRun = false } = {}) {
  const cfg = loadHarnessConfig();
  const gateDays = days ?? cfg.retention.gateLogDays;
  const evidenceDays = cfg.retention.evidenceDays ?? 30;
  const results = {
    gateLog: { removed: 0, kept: 0 }, contextPacks: { removed: 0 },
    evidence: { removed: 0, kept: 0, protected: 0, deleted: [] },
    dryRun, at: nowIso(),
  };

  // gate-log 尺寸轮转（独立于按行清理：行级清理管内容年龄，尺寸轮转管文件体积）
  const rot = rotateGateLog();
  if (rot.rotated) results.gateLog.rotated = rot;

  const cutoff = Date.now() - gateDays * 86400_000;
  const denyCutoff = Date.now() - gateDays * 2 * 86400_000;
  const lines = readLines(FILES.gateLog);
  const kept = [];
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      const ts = new Date(e.ts || 0).getTime();
      const keep = e.action === 'deny' ? ts > denyCutoff : ts > cutoff;
      if (keep) kept.push(l); else results.gateLog.removed++;
    } catch { results.gateLog.removed++; }
  }
  results.gateLog.kept = kept.length;
  if (results.gateLog.removed > 0 && !dryRun) {
    fs.mkdirSync(DIRS.state, { recursive: true });
    fs.writeFileSync(FILES.gateLog, kept.length ? kept.join('\n') + '\n' : '');
  }

  // 过期上下文包清理（保留最新 3 份）
  const ctxDir = path.join(DIRS.state, 'context');
  if (fs.existsSync(ctxDir)) {
    const packs = fs.readdirSync(ctxDir).filter((f) => f.startsWith('pack-')).sort();
    for (const f of packs.slice(0, Math.max(0, packs.length - 3))) {
      if (!dryRun) fs.unlinkSync(path.join(ctxDir, f));
      results.contextPacks.removed++;
    }
  }

  // evidence 清理（引用保护 + quarantine 取证永不删）
  const evRoot = path.join(DIRS.state, 'evidence');
  if (fs.existsSync(evRoot)) {
    const { prot, breakdown } = protectedEvidencePaths();
    results.evidence.protectedBreakdown = breakdown;
    const evCutoff = Date.now() - evidenceDays * 86400_000;
    for (const file of walkFiles(evRoot)) {
      const relPath = rel(ROOT, file);
      if (/\.corrupt-/.test(path.basename(file))) { results.evidence.kept++; continue; } // 取证文件永不删
      if (prot.has(relPath)) { results.evidence.protected++; results.evidence.kept++; continue; }
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime >= evCutoff) { results.evidence.kept++; continue; }
      results.evidence.deleted.push(relPath);
      if (!dryRun) fs.unlinkSync(file);
    }
  }
  return results;
}
