// context：派生/风险/发布面——context-pack + risk（失败连击/危险状态）+ retention（留痕滚动清理）+ memory（recap/invariants/archive/ledgerHealth）+ sync（三文件同步）+ release（dod/发布十二条件）。
// Task 8.10 模块界重组（dsh 界）：risk/retention/memory/sync/release 旧文件现为 re-export shim（retention 的 rotateGateLog 已并入 quality）。
// 依赖方向：core/graph/quality/scan；被 hooks 依赖。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { branchName, changedPaths, diffText, DIRS, fastStatus, FILES, fingerprint, headCommit, human, isBinaryFile, listPaths, loadHarnessConfig, loadState, matchAny, nowIso, quarantineEvents, readLines, rel, ROOT, sha256, statusPaths } from './core.mjs';
import { adrCheck, agentsLint, analyze, check as archCheckFn, capsulePath, classify, lint, loadCatalog } from './graph.mjs';
import { assessBudget, backlogList, expiredCount, fastDebtReceipts, latestReceipts, ledgerStats, REVIEW_PROFILES, verify as qualityVerify, readGateLog, rotateGateLog, verifyLedger } from './quality.mjs';
import { audit as fitnessAudit, graduationCandidates, rulesAudit, skillsLint, specLint, trace as specTrace } from './scan.mjs';

// 组内别名（合并前是旧文件里的 `import {x as y}`；x 的定义现已并入本文件）：
const riskScan = scan;

// ══════════════════ 原 context.mjs ═══════════════════

// context pack：预算化上下文打包。DENY 路径永不入包；只打印 manifest，全文落盘。
// Task 9.3 升级（源 codex 1.20 两点，收敛算法与分级裁剪序记录为已知边界后补）：
//   - denied→diff 整体省略：变更集含 DENY 名单路径 → canonical diff 段整体替换为占位+hash——
//     秘密变更内容不得经 diff 进包（文件内容侧原有 DENY 拦截不变，本条封住 diff 侧绕行）。
//   - 摘要/证据分离：模型可见面（返回的 manifest）只含元数据+文件清单+证据句柄；
//     全文（含 diff）落盘 evidence 侧（pack 附属文件），modelChars 预算（config 可调）只约束摘要面。

// 秘密/依赖/构建产物/harness 自身运行时永不入包。
const DENY = [
  '.git/**', '.zcode/state/**', '.zbase/**', 'node_modules/**', '**/node_modules/**',
  '.env', '.env.*', '**/.env', '**/.env.*', '**/*.key', '**/*.pem', '**/.ssh/**',
  '**/dist/**', '**/build/**', '**/coverage/**', '**/__pycache__/**',
  '**/*.lock', '**/package-lock.json',
];

export function pack({ changed, budget } = {}) {
  const cfg = {
    totalChars: budget?.totalChars || 120000,
    fileChars: budget?.fileChars || 20000,
    diffChars: budget?.diffChars || 40000,
    modelChars: budget?.modelChars || loadHarnessConfig().context?.modelChars || 8000,
    maxFiles: budget?.maxFiles || 40,
  };
  const imp = analyze({ changed });
  const manifest = { generatedAt: nowIso(), budget: cfg, impact: { degraded: imp.degraded, reasons: imp.reasons }, files: [], truncated: false, denied: 0 };

  // canonical diff 段（Task 9.3）：DENY 命中变更集 → 整体占位+hash（内容只在内存中哈希，绝不进包）。
  const deniedChanged = changed.filter((p) => matchAny(p, DENY));
  let diffSection;
  if (deniedChanged.length) {
    const hash = sha256(diffText(changed));
    diffSection = `[DENIED-IN-CHANGESET] 变更集含 DENY 名单路径（${deniedChanged.slice(0, 5).join(', ')}${deniedChanged.length > 5 ? ' 等' : ''}）：canonical diff 整体省略——秘密变更内容不得经 diff 进包。sha256:${hash}`;
    manifest.diffOmitted = deniedChanged;
  } else {
    const raw = diffText(changed);
    diffSection = raw.length > cfg.diffChars
      ? `${raw.slice(0, cfg.diffChars)}\n... [diff truncated at ${cfg.diffChars} chars]`
      : (raw || '(无 tracked diff——变更可能全部是 untracked，全文见文件段)');
  }

  // 优先级：task diff 文件 > 受影响模块胶囊 > 公共契约 > diff 同目录文档
  const candidates = [];
  const push = (abs, priority, reason) => {
    const r = rel(ROOT, abs);
    if (r.startsWith('..')) return;
    if (matchAny(r, DENY)) { manifest.denied++; return; }
    candidates.push({ abs, r, priority, reason });
  };

  for (const p of changed) push(path.join(ROOT, p), 0, 'task-diff');
  if (imp.ok) {
    for (const m of imp.fanout) {
      const cap = capsulePath(m);
      if (fs.existsSync(cap)) push(cap, 1, `capsule:${m}`);
    }
    push(path.join(DIRS.harness, 'module-catalog.json'), 2, 'catalog');
    push(path.join(DIRS.harness, 'verification-matrix.json'), 2, 'verification-matrix');
    const docDirs = new Set(changed.map((p) => path.dirname(p)));
    for (const d of docDirs) {
      for (const cand of ['README.md', 'AGENTS.md']) {
        const abs = path.join(ROOT, d, cand);
        if (fs.existsSync(abs)) push(abs, 3, 'nearby-doc');
      }
    }
  }

  // 去重 + 按优先级排序 + 预算裁剪
  const seen = new Set();
  const uniq = candidates.filter((c) => (seen.has(c.r) ? false : (seen.add(c.r), true)));
  uniq.sort((a, b) => a.priority - b.priority || a.r.localeCompare(b.r));

  let total = 0;
  const packParts = [];
  for (const c of uniq) {
    if (manifest.files.length >= cfg.maxFiles) { manifest.truncated = true; break; }
    let content;
    try {
      if (!fs.existsSync(c.abs) || isBinaryFile(c.abs)) continue;
      const stat = fs.statSync(c.abs);
      if (stat.size > cfg.fileChars * 4) { manifest.truncated = true; continue; }
      content = fs.readFileSync(c.abs, 'utf8');
    } catch { continue; }
    if (content.length > cfg.fileChars) content = content.slice(0, cfg.fileChars) + '\n... [truncated]';
    if (total + content.length > cfg.totalChars) { manifest.truncated = true; break; }
    total += content.length;
    manifest.files.push({ path: c.r, chars: content.length, reason: c.reason });
    packParts.push(`### ${c.r} (${c.reason})\n\n\`\`\`\n${content}\n\`\`\`\n`);
  }
  manifest.totalChars = total;

  fs.mkdirSync(path.join(DIRS.state, 'context'), { recursive: true });
  const outFile = path.join(DIRS.state, 'context', `pack-${Date.now()}.md`);
  const packBody = [
    `# Context Pack ${manifest.generatedAt}`,
    '',
    `evidencePath: ${rel(ROOT, outFile)}（模型只见 manifest 摘要，全文在此——摘要/证据分离）`,
    '',
    '## Canonical Diff',
    '',
    diffSection,
    '',
    packParts.join('\n'),
  ].join('\n');
  fs.writeFileSync(outFile, packBody);
  // 证据句柄：路径 + 尺寸 + 内容哈希（evidence 侧可独立复核，模型可见面只携带柄不携带全文）
  const packBytes = fs.statSync(outFile).size;
  manifest.packFile = rel(ROOT, outFile);
  manifest.evidencePath = manifest.packFile;
  manifest.packSize = human(packBytes);
  manifest.packHash = sha256(packBody);

  // 摘要/证据分离的预算面：manifest（modelSummary）超 modelChars → 清单截尾（保留句柄与统计），
  // 文件内容本来就不在 manifest——预算只可能被超长清单撑破。summaryChars 在全部字段就位后测量。
  manifest.note = 'modelSummary=本返回值（元数据+清单+句柄）；全文（含 canonical diff）在 evidencePath。DENY 路径内容与 diff 永不入包。';
  manifest.modelChars = cfg.modelChars;
  manifest.summaryChars = 0; // 先占位（键入序列化面）
  const summaryChars = () => JSON.stringify(manifest).length;
  while (summaryChars() > cfg.modelChars && manifest.files.length > 10) {
    manifest.files = manifest.files.slice(0, Math.max(10, Math.floor(manifest.files.length / 2)));
    manifest.filesTruncated = true;
  }
  // 字段值位数自指（0→1509 使序列化 +3）：迭代至定点，summaryChars 与实际序列化长度严格一致
  for (let i = 0; i < 5 && manifest.summaryChars !== summaryChars(); i++) manifest.summaryChars = summaryChars();
  return manifest;
}


// ══════════════════ 原 risk.mjs ═══════════════════

// 风险扫描：失败连击诊断（连败 3 次 = 诊断问题非重试问题）+ 危险状态面。
// v2.1：FAST_MODE_DEBT error 级点名 fast 窗口跳过的检查（证据贷款未清偿）；
//      STATE_QUARANTINED 单列损坏隔离事件（核实无工作丢失前不可绿）。
// v2.4：FAIL_STREAK 同 check 连续 FAIL≥3（账本按 check 分组取尾）——重试不是验证，
//      连续失败 3 次是诊断问题，转根因分析（bug-fixer）；FEEDBACK_GRADUATION_PENDING
//      毕业候选信号（教训复发 ≥3 未毕业，进化引擎不靠自觉发现饿死）。

const FAIL_STREAK_THRESHOLD = 3;

// 同 check 连续 FAIL（取尾）：该 check 的账本子序列末尾连续 FAIL 数。
// 中间夹其他 check 的回执不打断本 check 的连击（按 check 分组）。
export function failStreaks() {
  const byCheck = new Map();
  for (const l of readLines(FILES.ledger)) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    const c = e?.content?.check;
    if (!c) continue;
    if (!byCheck.has(c)) byCheck.set(c, []);
    byCheck.get(c).push(e.content.status);
  }
  const streaks = [];
  for (const [check, statuses] of byCheck) {
    let n = 0;
    for (let i = statuses.length - 1; i >= 0 && statuses[i] === 'FAIL'; i--) n++;
    if (n >= FAIL_STREAK_THRESHOLD) streaks.push({ check, count: n });
  }
  return streaks;
}

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

  // 同 check 连续 FAIL≥3：重试不是验证——停止重试，转根因分析（bug-fixer）
  for (const s of failStreaks()) {
    findings.push({ severity: 'high', code: 'FAIL_STREAK', check: s.check, count: s.count, note: `check "${s.check}" 连续 FAIL ${s.count} 次（≥${FAIL_STREAK_THRESHOLD}）：停止重跑，转根因分析（bug-fixer：复现→隔离首个坏状态→修复）` });
  }

  // 毕业候选：教训复发 ≥3 未毕业——进化引擎饿死信号（不阻断，只提醒派 evolution-runner）
  const candidates = graduationCandidates();
  if (candidates.length > 0) {
    findings.push({
      severity: 'info', code: 'FEEDBACK_GRADUATION_PENDING', count: candidates.length,
      candidates: candidates.map((c) => c.id),
      note: `${candidates.length} 条 feedback 复发 ≥3 未毕业：派 evolution-runner 评估毕业（优先毕业为检查/命令而非提示词文本）`,
    });
  }

  const ver = verifyLedger();
  if (!ver.ok) findings.push({ severity: 'critical', code: 'LEDGER_BROKEN', issues: ver.issues.slice(0, 5), note: '账本断链：证据体系不可信，先查篡改/截断' });

  // 损坏隔离：核对隔离原件确认无工作丢失，不要删除取证文件
  const quarantined = quarantineEvents();
  if (quarantined.length > 0) {
    findings.push({
      severity: 'high', code: 'STATE_QUARANTINED', count: quarantined.length,
      events: quarantined.slice(-5).map((q) => ({ ts: q.ts, file: q.file, quarantinedAs: q.quarantinedAs })),
      note: `状态文件损坏被隔离 ${quarantined.length} 次：核对 .zcode/state/*.corrupt-* 原件确认无工作丢失`,
    });
  }

  const fast = fastStatus();
  if (fast.enabled) {
    const debt = fastDebtReceipts({ windowId: fast.windowId });
    const skipped = [...new Set(debt.map((e) => e.content.check))];
    if (skipped.length) {
      findings.push({
        severity: 'high', code: 'FAST_MODE_DEBT', skipped, windowId: fast.windowId, until: fast.until,
        note: `证据贷款未清偿：fast 窗口内跳过了 ${skipped.join(', ')}——补跑偿贷前 task finish 被阻断`,
      });
    } else {
      findings.push({ severity: 'info', code: 'FAST_MODE_ON', until: fast.until, reason: fast.reason, note: 'Fast Mode 生效中：质量流程放水，安全护栏照旧' });
    }
  }

  const expired = expiredCount();
  if (expired > 0) findings.push({ severity: 'medium', code: 'WAIVER_EXPIRED', count: expired, note: '豁免已到期：重新计入未覆盖' });

  return { ok: !findings.some((f) => f.severity === 'critical' || f.severity === 'high'), findings, ledger, recentDenies: recentDenies.length };
}


// ══════════════════ 原 retention.mjs ═══════════════════

// 证据留存：按策略销毁过期留痕；deny 记录窗口加倍保留（审计需要拦截历史）。
// v2.3（Task 8.4）：
//   - evidence 引用保护：删除前构造 protectedPaths——当前 diff（fingerprint）回执引用的 evidence
//     + 每 (task,check) 最新回执引用的 evidence +（zcode 特有超集）保留账本内任一条目引用的 evidence。
//     超集是必须的：verifyLedger 逐条复验全账本 evidence，删掉任何仍被保留条目引用的文件 =
//     自己制造 EVIDENCE_MISSING 断链。轮转（ledger.rotateKeep）丢出的旧条目解除引用后，其 evidence 才可清理。
//   - quarantine 取证文件（.corrupt-*）永不删。
//   - gate-log 尺寸轮转（默认 4MB → .1 保一代，retention.gateLogMaxBytes 可调）。
//   - --dry-run：只报清单不动盘。

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


// ══════════════════ 原 memory.mjs ═══════════════════

// 项目记忆（Task 7.9 + 7.12，源 dsh context.mjs memory law）：
//   - recap：预算化派生摘要（6000 字符）——恢复成本是「当前状态」的函数，不是「项目年龄」的函数；
//   - invariants：不可谈判集（1200 字符）——compaction 不修正漂移（ContextEcho 23 模型实测），
//     最小法则集 + 活状态在每次阶段边界/压缩后重注入；
//   - ledgerHealth / archiveLedger：活账本保持小而有界；历史只移动、永不删除、永不改写（append-only）；
//     M3 阈值（Done>m3Threshold=100）提示自动归档。

function memoryConfig() {
  const cfg = loadHarnessConfig().memory || {};
  return {
    ledger: 'progress.md',
    archive: 'progress.archive.md',
    keepDone: 40,
    keepNotes: 30,
    keepMinDone: 2, // 字节模式保留下限：活账本 bytes 超限时 Done 至少留 2 条（harness.memory.* 可覆盖）
    keepMinNotes: 1, // 字节模式保留下限：Notes 至少留 1 条
    recapBudget: 6000,
    invariantsBudget: 1200,
    maxLedgerBytes: 24000,
    m3Threshold: 100,
    order: 'append', // 段内顺序契约：append=最新在尾部（本仓/流水账惯例）；prepend=最新在前（dsh 惯例）
    ...cfg,
  };
}

const ledgerPath = (cfg) => path.join(ROOT, cfg.ledger);
const archivePath = (cfg) => path.join(ROOT, cfg.archive);

// progress.md 按 '## ' 标题切段（保序）
export function parseLedger(text) {
  const sections = [];
  let current = null;
  for (const line of String(text || '').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { current = { title: m[1], lines: [] }; sections.push(current); }
    else if (current) current.lines.push(line);
  }
  return sections;
}

// 归档指针行不算账本条目（否则二次归档会把指针当最旧条目搬走，永不止步）
const POINTER_RE = /^-\s*Older entries are in \[.+\]\(.+\)\.?\s*$/;
// 指针行全文单点构造：apply 插入与字节投影成本核算共用——两处各自拼接一旦漂移即账实不符（P2-F1）
const archivePointerLine = (cfg) => `- Older entries are in [${cfg.archive}](${cfg.archive}).`;
const entriesOf = (s) => (s ? s.lines.filter((l) => /^\s*-\s+\S/.test(l) && !POINTER_RE.test(l.trim())) : []);
const sectionNamed = (sections, name) =>
  sections.find((s) => s.title.toLowerCase().startsWith(name.toLowerCase())) || null;

// 条目行级截断：一条带证据指针的流水可以很长，全文引用会让三条流水吃掉整个预算
const clip = (line, max = 200) => (line.length <= max ? line : `${line.slice(0, max - 3).trimEnd()}...`);

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

// ---------- ledgerHealth ----------

export function ledgerHealth() {
  const cfg = memoryConfig();
  const text = readText(ledgerPath(cfg));
  const bytes = Buffer.byteLength(text, 'utf8');
  const sections = parseLedger(text);
  const done = entriesOf(sectionNamed(sections, 'Done')).length;
  const notes = entriesOf(sectionNamed(sections, 'Notes')).length;
  const over = bytes > cfg.maxLedgerBytes || done > cfg.keepDone;
  const m3 = done > cfg.m3Threshold;
  // 无可搬判定：Done/Notes 都已到字节模式保留下限——archive --apply 是空药方（死锁根因），出路在收紧条目或上调预算
  const nothingMovable = done <= (cfg.keepMinDone ?? 0) && notes <= (cfg.keepMinNotes ?? 0);
  return {
    ledger: cfg.ledger, bytes, maxLedgerBytes: cfg.maxLedgerBytes,
    doneEntries: done, keepDone: cfg.keepDone, noteEntries: notes,
    archive: cfg.archive, archiveBytes: Buffer.byteLength(readText(archivePath(cfg)), 'utf8'),
    autoArchiveSuggested: m3,
    ok: !over,
    advice: m3
      ? `Done ${done} 条已超 M3 阈值 ${cfg.m3Threshold}——建议立即自动归档：node .zcode/zbase.mjs archive --apply（历史只移动不删除）`
      : over
        ? (nothingMovable
          ? `账本超预算（${bytes}B / Done ${done} 条）且已到保留下限（Done ≤ keepMinDone=${cfg.keepMinDone}、Notes ≤ keepMinNotes=${cfg.keepMinNotes}），无可搬条目——收紧条目长度或上调 harness.memory.maxLedgerBytes（当前 ${cfg.maxLedgerBytes}B）`
          : `账本超预算（${bytes}B / Done ${done} 条）：跑 node .zcode/zbase.mjs archive --apply 把最旧条目移入 ${cfg.archive}，recap 保持恒定成本`)
        : '账本在预算内',
  };
}

// ---------- archive（append-only 归档） ----------

export function archiveLedger({ apply = false } = {}) {
  const cfg = memoryConfig();
  if (!fs.existsSync(ledgerPath(cfg))) {
    return { ok: false, degraded: true, reason: `无账本文件 ${cfg.ledger}（不强造）`, health: null };
  }
  const text = readText(ledgerPath(cfg));
  const sections = parseLedger(text);

  // 条数模式规划（语义不变）：Done>keepDone / Notes>keepNotes 才搬。append 契约=最新在尾 → 头部即最旧，
  // 搬头留尾；prepend 反之（ordered = 最旧→最新序）。
  const itemsOf = { Done: [], Notes: [] };
  const moveCount = { Done: 0, Notes: 0 };
  for (const [name, keep] of [['Done', cfg.keepDone], ['Notes', cfg.keepNotes]]) {
    const s = sectionNamed(sections, name);
    if (!s) continue; // 无段跳过
    itemsOf[name] = entriesOf(s);
    if (itemsOf[name].length > keep) moveCount[name] = itemsOf[name].length - keep;
  }
  const ordered = (name) => (cfg.order === 'append' ? itemsOf[name] : [...itemsOf[name]].reverse());

  // 字节模式（死锁修复）：条数规划后活账本 bytes > maxLedgerBytes → 追加搬最旧条目——先 Done（搬到位后
  // 仍 ≥ keepMinDone），再 Notes（≥ keepMinNotes），直到投影 ≤ maxLedgerBytes 或触底。投影 = 当前 bytes +
  // 首次归档指针行成本（P2-F1，见下）− Σ(被搬行字节长+1)；指针行替换 / append-only 归档 / 幂等语义沿用下方
  // 现有 apply 实现。
  const lineCost = (l) => Buffer.byteLength(l, 'utf8') + 1; // 行本体 + 换行符
  // P2-F1：apply 写盘会在被搬块首插指针行——无既有指针行（首次归档）时投影必须计入该成本，否则压线区间
  // 顶层 overBudget:false 而内嵌 health.ok:false 自相矛盾；已有指针行则 apply 删旧插新、内容相同净零不加。
  // 仅本轮确实会写盘（条数模式已有搬迁，或已超预算待字节模式搬迁）才计入：纯空转不落指针，虚加成本会让
  // 预算内的账本误报 overBudget（反向矛盾）。
  const hasPointerLine = text.split('\n').some((l) => POINTER_RE.test(l.trim()));
  const pointerCost = hasPointerLine ? 0 : lineCost(archivePointerLine(cfg));
  const willWrite = moveCount.Done + moveCount.Notes > 0 || Buffer.byteLength(text, 'utf8') > cfg.maxLedgerBytes;
  let projected = Buffer.byteLength(text, 'utf8') + (willWrite ? pointerCost : 0);
  for (const name of ['Done', 'Notes']) for (let i = 0; i < moveCount[name]; i++) projected -= lineCost(ordered(name)[i]);
  const byteDriven = { Done: false, Notes: false };
  if (projected > cfg.maxLedgerBytes) {
    for (const [name, keepMin] of [['Done', cfg.keepMinDone ?? 0], ['Notes', cfg.keepMinNotes ?? 0]]) {
      while (projected > cfg.maxLedgerBytes && itemsOf[name].length - moveCount[name] > keepMin) {
        projected -= lineCost(ordered(name)[moveCount[name]]);
        moveCount[name]++;
        byteDriven[name] = true;
      }
    }
  }
  // 触底仍超预算：flag 诚实上报（fail-visible），CLI exit 仍 0——机械搬迁本身成功，出路在收紧条目或上调预算
  const overBudget = projected > cfg.maxLedgerBytes;
  const overReason = overBudget
    ? `字节触底仍超预算：投影 ${projected}B > maxLedgerBytes ${cfg.maxLedgerBytes}B，保留下限不可再搬（Done ≥ keepMinDone=${cfg.keepMinDone}、Notes ≥ keepMinNotes=${cfg.keepMinNotes}）——收紧条目长度或上调 harness.memory.maxLedgerBytes`
    : null;

  const plan = [];
  const moved = { Done: [], Notes: [] };
  for (const name of ['Done', 'Notes']) {
    if (moveCount[name] === 0) continue;
    moved[name] = ordered(name).slice(0, moveCount[name]);
    const row = { section: name, total: itemsOf[name].length, keep: name === 'Done' ? cfg.keepDone : cfg.keepNotes, moving: moveCount[name] };
    if (byteDriven[name]) row.byteDriven = true; // 该段搬迁由字节预算驱动（条数之外追加）
    plan.push(row);
  }

  const total = plan.reduce((n, p) => n + p.moving, 0);
  if (total === 0) {
    return { ok: true, applied: false, moved: 0, plan: [], overBudget, reason: overBudget ? overReason : '无可归档条目', health: ledgerHealth() };
  }
  if (!apply) {
    return { ok: true, applied: false, moved: total, plan, overBudget, ...(overBudget ? { reason: overReason } : {}), health: ledgerHealth() };
  }

  // 归档文件：append-only，头声明「条目只移动、永不改写」
  const stamp = nowIso().slice(0, 10);
  let archive = readText(archivePath(cfg));
  if (!archive) {
    archive = `# Archived project memory\n\nAppend-only：已归档条目永不改写；更正是活账本里的新条目。归档动机：活账本保持小而有界，recap 恒定成本。\n`;
  }
  archive += `\n## Archived ${stamp}\n`;
  for (const name of ['Done', 'Notes']) {
    if (moved[name].length === 0) continue;
    archive += `\n### ${name}\n\n${moved[name].join('\n')}\n`;
  }
  fs.mkdirSync(path.dirname(archivePath(cfg)), { recursive: true });
  fs.writeFileSync(archivePath(cfg), archive);

  // 活账本：删已移条目 + 被移块首处插指针行（旧指针一并替换，只保留一条）
  // P2-F2：按出现计数删除（multiset）——moved 行构造 Map<行文本, 剩余次数>，走文件行序命中计数>0 才删并
  // 递减。全行文本 Set 精确匹配会把逐字节相同的保留区条目连带误删（击穿 keepMin、丢副本）；append 契约
  // （最旧在头）下首个命中即最旧副本，语义正确。
  const movedCounts = new Map();
  for (const line of [...moved.Done, ...moved.Notes]) movedCounts.set(line, (movedCounts.get(line) ?? 0) + 1);
  const pointer = archivePointerLine(cfg);
  const out = [];
  let placed = false;
  for (const line of text.split('\n')) {
    const remaining = movedCounts.get(line) ?? 0;
    if (remaining > 0) {
      movedCounts.set(line, remaining - 1);
      if (!placed) { out.push(pointer); placed = true; }
      continue;
    }
    if (POINTER_RE.test(line.trim())) continue; // 旧指针让位给新指针
    out.push(line);
  }
  fs.writeFileSync(ledgerPath(cfg), out.join('\n'));
  return { ok: true, applied: true, moved: total, plan, overBudget, ...(overBudget ? { reason: overReason } : {}), archive: cfg.archive, health: ledgerHealth() };
}

// ---------- recap ----------

// 条目自身的优先级 token（#N P0/P1/P2 前缀），非正文提及
const priorityOf = (line) => {
  const m = /^\s*-\s+(?:#\d+\s+)?(P[0-2])\b/.exec(line);
  return m ? m[1] : null;
};

function feedbackPendingCount() {
  const index = path.join(DIRS.feedback, 'FEEDBACK-INDEX.md');
  if (!fs.existsSync(index)) return 0;
  let count = 0;
  for (const line of readText(index).split('\n')) {
    if (!line.startsWith('|') || /^\|\s*(条目|---|\s*$)/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    const graduation = cells[cells.length - 2] || ''; // 最后一格是行尾空段前的「毕业」列
    if (!/已/.test(graduation)) count++;
  }
  return count;
}

export function recap({ budget } = {}) {
  const cfg = memoryConfig();
  const cap = budget || cfg.recapBudget;
  const sections = parseLedger(readText(ledgerPath(cfg)));
  // 近期条目：append 契约（最新在尾）取尾 N 条；prepend 取头 N。Pinned 是策展清单非流水，恒取头 12。
  const pickRecent = (name, limit) => {
    const items = entriesOf(sectionNamed(sections, name));
    if (!items.length) return [];
    const picked = cfg.order === 'append' ? items.slice(-limit) : items.slice(0, limit);
    return picked.map((l) => clip(l));
  };
  const pick = (name, limit) => pickRecent(name, limit);
  const todoAll = entriesOf(sectionNamed(sections, 'Next')) || entriesOf(sectionNamed(sections, 'TODO')) || [];
  const todo = cfg.order === 'append' ? todoAll.slice(-10) : todoAll.slice(0, 10);

  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id) || null;
  const fast = fastStatus(state);
  const ver = verifyLedger();
  const lastLine = readLines(FILES.ledger).at(-1);
  const lastReceipt = lastLine ? (() => { try { return JSON.parse(lastLine).content; } catch { return null; } })() : null;
  const risks = riskScan().findings;
  const branch = branchName();
  const dirty = changedPaths().length;

  const blocks = [];
  const push = (title, lines) => { if (lines && lines.length) blocks.push(`## ${title}\n${lines.join('\n')}`); };

  const position = [
    `- 分支 ${branch} @ ${headCommit().slice(0, 10)}，${dirty} 个未提交路径`,
    `- 活跃任务: ${active ? `${active.id}（${active.risk}）${active.envelope.goal}` : '无'}`,
    `- 账本: ${ver.total} 条，${ver.ok ? '链完整' : '断链（证据不可信）'}；最新回执 ${lastReceipt ? `${lastReceipt.check}/${lastReceipt.status} @ ${lastReceipt.ts}` : '无'}`,
  ];
  if (fast.enabled) position.push(`- Fast Mode 贷款生效中：${fast.minutes}min 到期 ${fast.until}（windowId ${fast.windowId}，reason ${fast.reason}）——SKIPPED 是债不是免` );
  push('Position', position);
  push('Pinned', pick('Pinned', 12));
  push('In progress', active ? [
    `- ${active.id}：${active.envelope.goal}`,
    `- ownedPaths: ${active.ownedPaths.join(', ') || '（未声明）'}`,
    `- touched: ${(active.touchedPaths || []).length} 个路径；baselineDrift=${active.baseline.fingerprint !== ver.currentFingerprint ? 'true（旧证据腐化需重验）' : 'false'}`,
  ] : ['- 无活跃任务：新任务先读宪法与 .zcode/rules/workflow.md']);
  const p0 = todo.filter((l) => priorityOf(l) === 'P0').map((l) => clip(l));
  const p1 = todo.filter((l) => priorityOf(l) === 'P1').map((l) => clip(l));
  if (p0.length) push('Next (P0)', p0.slice(0, 10));
  if (p1.length) push('Next (P1)', p1.slice(0, 10));
  if (!p0.length && !p1.length) push('Next', todo.map((l) => clip(l)));
  push('Recent decisions', pick('Decisions', 5));
  push('Recently done', pick('Done', 6));
  push('Risks', pick('Risks', 8).length ? pick('Risks', 8) : pick('Open Issues', 8));
  if (risks.length) push('Decay signals', risks.slice(0, 8).map((f) => clip(`- ${f.code}(${f.severity}): ${f.note}`)));

  let body = `# Recap — ${nowIso()}\n\n${blocks.join('\n\n')}\n`;
  let truncated = false;
  if (body.length > cap) {
    body = `${body.slice(0, cap)}\n\n...[recap 已在 ${cap} 字符处截断；全文见 ${cfg.ledger}]\n`;
    truncated = true;
  }
  return {
    ok: true, chars: body.length, budget: cap, truncated, text: body,
    health: ledgerHealth(), dirtyPaths: dirty, feedbackPending: feedbackPendingCount(),
  };
}

// ---------- invariants ----------

// 批次 5（源 cc State 块 + boundToCurrentDiff 模式）：
//   - 块序 State→铁律→Pinned——序决定小预算下什么活下来（State 活状态最先保、Pinned 策展最先让位；
//     截断从尾，头部的 State 天然存活）；
//   - gate.boundToCurrentDiff：最后一条账本回执的 fingerprint === 当前 fingerprint()——
//     「上次绿灯是不是这次的」一眼可判，直接戳穿拿旧回执说事；
//   - fast 窗口只报剩余小时数不报时钟值（cc 教训：绝对时间戳随缓存比对失效，相对值才可校准）；
//   - 头声明「刚从文件派生」：按它校准，别按压缩后印象走。
// 回注 hook 侧不做（ZCode 无 PostCompact 事件，OQ 待实测）——本输出是拉取式校准源。
export function invariants({ budget } = {}) {
  const cfg = memoryConfig();
  const cap = budget || cfg.invariantsBudget;
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id) || null;
  const fast = fastStatus(state);
  const ver = verifyLedger();
  const lastLine = readLines(FILES.ledger).at(-1);
  const lastReceipt = lastLine ? (() => { try { return JSON.parse(lastLine).content; } catch { return null; } })() : null;
  const currentFp = fingerprint().fingerprint;
  const backlog = backlogList();

  const laws = [
    '1. EVIDENCE 证据五步：想清证明命令→跑全新命令→读完整输出与 exit code→确认输出支持本结论→才下结论。禁用「应该/大概/看起来」。',
    '2. STATES 四态退出码：0 通过 / 1 错误 / 2 hook 拦截（DENY 保留码）/ 3 检查发现 / 4 账本校验失败。gate BLOCKED 非 PASS——按 exit 1 拒绝（2 是 hook 拦截保留码，不是 gate BLOCKED 的码）；缺工具是 BLOCKED 不是 PASS；exit 3 不是通过，是 gap。',
    '3. FLOOR 三性红线：security / safety / privacy 永不可豁免、永不可 Fast 跳过、永不可降级——结构上无可表达之例外。',
    '4. SCOPE 只改派单 Scope 内文件；活跃任务的 ownedPaths 之外禁止写（写路径预检机器闸）；缺信息不是许可。',
    '5. TIERS HIGH 档停下等明确人工审批：push/发版/部署/密钥/迁移/新依赖/豁免/不可逆操作。',
  ];

  // State 块：全部数据源现成（loadState/fastStatus/verifyLedger/backlogList/账本尾条）
  const envField = (e, k) => {
    const v = e?.[k];
    if (v === undefined || v === null || String(v).trim() === '') return null;
    // scope/verification 常为数组；verification 元素是对象（{command,expect}）——JSON 化而非 [object Object]
    const val = Array.isArray(v)
      ? v.map((x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
      : String(v);
    return `${k}: ${clip(val, 60)}`;
  };
  const stateLines = [];
  if (active) {
    const e = active.envelope || {};
    const six = ['goal', 'scope', 'outOfScope', 'existingPattern', 'verification', 'escalation']
      .map((k) => envField(e, k)).filter(Boolean).join(' | ');
    stateLines.push(`- 任务: ${active.id}（${active.risk}）${six}`);
  } else {
    stateLines.push('- 任务: 无活跃任务');
  }
  if (fast.enabled) {
    const hoursLeft = Math.max(0, (new Date(fast.until).getTime() - Date.now()) / 3600_000).toFixed(1);
    const debt = [...new Set(fastDebtReceipts({ windowId: fast.windowId }).map((x) => x.content.check))];
    stateLines.push(`- FAST MODE 贷款剩余 ${hoursLeft}h（${clip(fast.reason, 40)}）：${debt.length ? `DEBT 未偿——SKIPPED 了 ${debt.join(', ')}，task finish 被阻断` : '暂无未偿 SKIPPED'}`);
  } else {
    stateLines.push('- FAST MODE: 关闭');
  }
  stateLines.push(`- 账本: ${ver.ok ? `intact（${ver.total} 条）` : '断链——此前一切验证在重跑前均不可信'}`);
  stateLines.push(`- 待审: backlog ${backlog.count} 条${backlog.expired ? `（${backlog.expired} 过期）` : ''}`);
  const bound = Boolean(lastReceipt?.fingerprint) && lastReceipt.fingerprint === currentFp;
  stateLines.push(`- gate.boundToCurrentDiff: ${bound ? 'true（最后回执即当前 diff——上次绿灯就是这次的）' : lastReceipt ? 'false（最后回执 ≠ 当前 diff——旧回执不算数，先重跑 gate）' : 'false（账本无回执——从未落账）'}`);

  // Pinned 块：progress.md Pinned 段头部（策展清单非流水，恒取头）
  const pinned = (entriesOf(sectionNamed(parseLedger(readText(ledgerPath(cfg))), 'Pinned')) || [])
    .slice(0, 5).map((l) => clip(l, 120));

  const title = '# Invariants — 每次阶段边界与任何压缩后重读。刚从文件派生（state/账本/progress.md），按它校准，别按压缩后印象走。';
  const sections = [['State', stateLines], ['铁律', laws], ...(pinned.length ? [['Pinned', pinned]] : [])];
  let body = `${title}\n\n${sections.map(([t, ls]) => `## ${t}\n${ls.join('\n')}`).join('\n\n')}\n`;
  let truncated = false;
  if (body.length > cap) {
    body = `${body.slice(0, cap)}\n...[truncated]\n`;
    truncated = true;
  }
  return { ok: true, chars: body.length, budget: cap, truncated, text: body };
}


// ══════════════════ 原 sync.mjs ═══════════════════

// 三文件同步执法（Task 7.10，源 dsh syncCheck + cc A2）：项目记忆不得落后代码；Spec 与 CHANGELOG 成对。
// 双缝共用本判定：git pre-commit（--staged 仅 index）与 Stop 事件（工作树+untracked 合集）。
// 判定：
//   ① MEMORY_BEHIND_CODE（error）：governed 代码路径变了而 progress.md 不在变更集；
//   ② SPEC_WITHOUT_CHANGELOG（error）：Product-Spec*.md 非 CHANGELOG 变了而同窗无 Product-Spec-CHANGELOG.md
//      （仅当两份文件都在盘上时执法——「文件存在即维护，不存在的不强造」）；反向 CHANGELOG_WITHOUT_SPEC 为 warning。

const STATE_PREFIXES = ['.zcode/state/', '.zbase/'];

// governed 代码：有 catalog 时按归类（module/catchall/overlap）；无 catalog 时按启发式（非 .md 且非纯文档面）。
function isGovernedCode(catalog, p) {
  if (p.endsWith('.md')) return false;
  if (STATE_PREFIXES.some((s) => p.startsWith(s))) return false;
  if (catalog) {
    const c = classify(catalog, p);
    return c.kind === 'module' || c.kind === 'catchall' || c.kind === 'overlap';
  }
  return true;
}

export function syncCheck({ staged = false } = {}) {
  const s = statusPaths();
  const paths = [...new Set(staged ? s.staged : [...s.staged, ...s.unstaged, ...s.untracked])]
    .filter((p) => !STATE_PREFIXES.some((pre) => p.startsWith(pre)));
  const catalog = loadCatalog();
  const errors = [];
  const warnings = [];

  // ① 代码脏而账本不脏（progress.md 在盘上才执法——「文件存在即维护，不存在的不强造」；
  //    不存在时降为提示：建议建立，不强造也不阻断）
  const codeChanged = paths.filter((p) => isGovernedCode(catalog, p));
  if (codeChanged.length > 0 && !paths.includes('progress.md')) {
    if (fs.existsSync(path.join(ROOT, 'progress.md'))) {
      errors.push({ code: 'MEMORY_BEHIND_CODE', changed: codeChanged.length, note: `${codeChanged.length} 个 governed 代码路径已变更而 progress.md 未同步——三文件同步铁律：决策/约束/完成即时写 progress.md` });
    } else {
      warnings.push({ code: 'LEDGER_NOT_CREATED', changed: codeChanged.length, note: `${codeChanged.length} 个 governed 代码路径已变更而仓内无 progress.md——建议建立项目记忆（宪法：文件存在即维护）` });
    }
  }

  // ② Spec 与 CHANGELOG 成对（两份都在盘上才执法；缺 CHANGELOG 文件 → warning 提示建立）
  const specFile = 'Product-Spec.md';
  const changelogFile = 'Product-Spec-CHANGELOG.md';
  const specChanged = paths.filter((p) => /^Product-Spec.*\.md$/.test(p) && !p.includes('CHANGELOG'));
  const changelogChanged = paths.includes(changelogFile);
  const specOnDisk = fs.existsSync(path.join(ROOT, specFile));
  const changelogOnDisk = fs.existsSync(path.join(ROOT, changelogFile));
  if (specChanged.length > 0 && !changelogChanged) {
    if (changelogOnDisk) {
      errors.push({ code: 'SPEC_WITHOUT_CHANGELOG', changed: specChanged, note: `${specChanged.join(', ')} 变更而 ${changelogFile} 未同步——需求变更必须成对更新（只改一个不算完成）` });
    } else {
      warnings.push({ code: 'SPEC_NO_CHANGELOG_FILE', note: `${specChanged.join(', ')} 变更但仓内无 ${changelogFile}——建议建立并成对维护` });
    }
  }
  if (changelogChanged && !specChanged.length && specOnDisk) {
    warnings.push({ code: 'CHANGELOG_WITHOUT_SPEC', note: `${changelogFile} 单独变更（无 Spec 变更）——确认这是纯记录性更新` });
  }

  return { ok: errors.length === 0, staged, checkedPaths: paths.length, errors, warnings };
}


// ══════════════════ 原 release.mjs ═══════════════════

// release + dod（Task 8.7，源 dsh releaseReadiness/dod + cc make-release 的证据侧；批次 2 扩十二条件）。
// release 汇齐人类签字所需的十二条件证据（9 阻断 + 3 非阻断，批次 2 新增 worktree-clean / ci-status /
// review-profile），但 tagging/pushing/deploying 是 HIGH 档人类行为，
// 本命令永不执行——它只装配证据，决定权在人类（宪法：关键闸口以人工审批为准）。
// dod 是静态 DoD 聚合闸：12 步静态检查聚合，每步 try-catch（引擎错误→DEGRADED 标注，
// degraded 绝不假装绿）；blocking 步失败 → exit 2（gate 阻断）。dod 只做静态治理，
// 行为证明仍需 gate（四态落账 + fingerprint 新鲜性）。

// 引擎错误 ≠ 检查失败：try-catch 包裹，抛异常 → {ok:false, degraded:true}（DEGRADED 标注，fail-visible）。
const run = (fn) => {
  try { return fn(); } catch (e) { return { ok: false, degraded: true, detail: `engine error: ${e.message}` }; }
};

// dod 静态八项（release 条件①内部复用同一定义）：catalog/skills/agents/spec(若有)/adr/attributes/arch/fitness。
// spec-lint 属 R5（spec-id 体系）；引入前以 legacy 注释放行——不伪造覆盖，也不假装已执法。
function dodStaticCore() {
  const failures = [];
  const degraded = [];
  const steps = [
    ['catalog', () => {
      const catalog = loadCatalog();
      if (!catalog) return { ok: true, detail: '小仓模式（无 module-catalog）' };
      const res = lint(catalog, { trackedPaths: listPaths() });
      return { ok: res.errors.length === 0, detail: res.errors.length ? `errors: ${res.errors.slice(0, 3).map((e) => e.code).join(',')}` : `lint 通过，归类 ${res.totalPaths ?? '?'} 路径` };
    }],
    ['skills', () => {
      const res = skillsLint();
      return { ok: (res.counts?.error ?? 1) === 0, detail: `${res.counts?.skills ?? 0} skills，error ${res.counts?.error ?? 1}` };
    }],
    ['agents', () => {
      const res = agentsLint();
      if (res.degraded) return { ok: true, degraded: true, detail: res.reason };
      return { ok: res.errors.length === 0, detail: res.errors.length ? `errors: ${res.errors.map((e) => e.code).slice(0, 3).join(',')}` : `${res.checked.length} 模块契约` };
    }],
    ['spec', () => {
      // Task 9.2 起 R5 spec-lint 已落地：真值接线（此前 legacy degraded 放行）。
      const res = specLint();
      if (res.degraded) return { ok: true, degraded: true, detail: res.reason };
      return {
        ok: res.ok,
        detail: res.ok
          ? `${res.counts.requirements} 需求，error 0（warning ${res.counts.warning}）`
          : `errors: ${res.findings.filter((f) => f.severity === 'error').slice(0, 3).map((f) => f.code).join(',')}`,
      };
    }],
    ['adr', () => {
      const res = adrCheck();
      return { ok: res.ok, detail: res.ok ? `${res.files} ADR，零幽灵引用` : `幽灵引用：${(res.errors || []).slice(0, 3).map((e) => e.file || e).join(', ')}` };
    }],
    ['attributes', () => {
      const res = qualityVerify();
      if (!res.ok && res.code === 'LEDGER_BROKEN') return { ok: false, detail: '账本断链：先修复证据体系再谈覆盖' };
      if (!res.ok && res.code === 'PLAN_INVALID') return { ok: false, detail: `verification plan 无效（${res.issues?.[0]?.code ?? '?'}）` };
      return { ok: res.ok, detail: res.ok ? `covered ${res.covered}，uncovered ${res.uncovered.length}` : `blocking：${(res.blocking || []).slice(0, 3).map((b) => `${b.module}/${b.attribute}`).join(', ')}` };
    }],
    ['arch', () => {
      const res = archCheckFn();
      if (res.reason) return { ok: false, degraded: true, detail: res.reason }; // 无 catalog = 配置态错误（degraded），非违规
      return { ok: res.ok, detail: res.ok ? `依赖执法通过（${res.totalEdges} 边）` : `违规 ${res.fresh.length} 项` };
    }],
    ['fitness', () => {
      const res = fitnessAudit();
      return { ok: res.ok, detail: res.results.map((r) => `${r.id}:${r.ok ? 'PASS' : 'FAIL'}`).join(' ') };
    }],
  ];
  const details = {};
  for (const [id, fn] of steps) {
    const r = run(fn);
    details[id] = r;
    if (!r.ok) failures.push(id);
    if (r.degraded) degraded.push(id);
  }
  return { ok: failures.length === 0, failures, degraded, details };
}

// dod：12 步静态聚合（11 阻断 + risk/budget 非阻断；trace legacy degraded 放行）。
export function dod({ textBudget = 3000 } = {}) {
  const core = dodStaticCore();
  const step = (id, blocking, r) => ({ id, blocking, ok: r.ok !== false, degraded: Boolean(r.degraded), detail: r.detail || null });
  const steps = [
    step('catalog-lint', true, core.details.catalog),
    step('skills-lint', true, core.details.skills),
    step('agents-lint', true, core.details.agents),
    // rules-audit（批次 4 起阻断）：phantom 幽灵执法点 >0 = FAIL——读起来被执法实际没执是最危险的
    // 假执法；unenforced 维持非阻断语义（执法覆盖率是可视化不是闸，宪法「检查优先」的度量面）。
    step('rules-audit', true, run(() => {
      const r = rulesAudit({ max: Infinity });
      if (r.counts.phantom > 0) {
        return { ok: false, detail: `phantom ${r.counts.phantom}：${r.phantoms.slice(0, 3).map((p) => `${p.kind}:${p.ref}`).join(', ')}——执法点引用不存在，修文本或补实现` };
      }
      return { ok: true, detail: `enforced ${r.counts.enforced}/${r.counts.total}（ratio ${r.enforcementRatio}），phantom 0；未执法 ${r.counts.unenforced} 条不阻断（覆盖率可视化非闸）` };
    })),
    step('adr-check', true, core.details.adr),
    step('attributes', true, core.details.attributes),
    step('arch-check', true, core.details.arch),
    step('fitness', true, core.details.fitness),
    step('trace', true, run(() => {
      // Task 9.2 起 R5 trace 已落地：悬空引用 fail、coverage 对 minCoverage（默认 0，理由见 trace advice）。
      const r = specTrace();
      if (r.degraded) return { ok: true, degraded: true, detail: r.reason };
      return {
        ok: r.ok,
        detail: r.ok
          ? `${r.total} 需求，coverage ${r.coverage}（min ${r.minCoverage}），悬空 0，孤儿 ${r.orphaned.length}`
          : `悬空 ${r.dangling.length + r.danglingTests.length}，coverage ${r.coverage} < min ${r.minCoverage}`,
      };
    })),
    step('ledger', true, run(() => {
      const r = verifyLedger();
      return { ok: r.ok, detail: r.ok ? `账本 ${r.total} 条链完整` : `断链：${JSON.stringify(r.issues.slice(0, 2))}` };
    })),
    step('risk', false, run(() => {
      const r = riskScan();
      const high = r.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
      return { ok: r.ok, detail: `high/critical ${high}，warning ${r.findings.filter((f) => f.severity === 'medium').length}（非阻断）` };
    })),
    step('budget', false, run(() => {
      const r = assessBudget({ staged: false });
      return { ok: r.ok, detail: r.ok ? '预算内' : `超限：${r.findings.map((f) => `${f.metric} ${f.actual}>${f.limit}`).join(', ')}（非阻断，拆分或记 ADR）` };
    })),
  ];
  const blockingFailed = steps.filter((s) => s.blocking && !s.ok);
  const nonBlockingFailed = steps.filter((s) => !s.blocking && !s.ok);
  const ok = blockingFailed.length === 0;

  const lines = [
    `# DoD 静态聚合 - ${nowIso()}`,
    '',
    'dod 只做静态治理，行为证明仍需 gate（四态落账 + fingerprint 新鲜性）。',
    '',
  ];
  for (const s of steps) {
    lines.push(`- [${s.ok ? 'x' : ' '}] ${s.id}${s.blocking ? ' (blocking)' : ''}${s.degraded ? ' [DEGRADED]' : ''}${s.detail ? ` - ${s.detail}` : ''}`);
  }
  lines.push('');
  lines.push(ok ? '## PASS - 全部阻断项通过（非阻断项见上）' : `## FAIL - 阻断项未过：${blockingFailed.map((s) => s.id).join(', ')}`);
  let text = lines.join('\n');
  let truncated = false;
  if (text.length > textBudget) { text = `${text.slice(0, textBudget)}\n...[truncated]`; truncated = true; }
  return {
    ok,
    steps,
    blockingFailed: blockingFailed.map((s) => s.id),
    nonBlockingFailed: nonBlockingFailed.map((s) => s.id),
    degraded: steps.filter((s) => s.degraded).map((s) => s.id),
    truncated,
    textBudget,
    text,
  };
}

// CI 判决查询（批次 2，源 cc 4bf5d2e 模式）：unknown is not a pass——
//   success → PASS；任一终态非 success → FAIL（CI 红不发版）；
//   无 run / conclusion=null（running）/ 仓无 remote / 无 commit → UNKNOWN（阻断——先推再发）；
//   gh 不存在 / 查询失败（网络/认证）→ DEGRADED（非阻断，附安装/登录指引——环境缺口 ≠ 判决）。
const GH_TIMEOUT_MS = 15000;
function ciConclusion() {
  const head = headCommit();
  if (head === 'no-commits') return { ok: false, detail: 'CI 对此 commit 无判决——unknown is not a pass（仓无 commit：先提交推送再发）' };
  let remotes = '';
  try {
    remotes = execFileSync('git', ['remote'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* git 不可用 → 走 gh 查询路径由其自报 */ }
  if (!remotes) return { ok: false, detail: `CI 对此 commit（${head.slice(0, 10)}）无判决——unknown is not a pass（仓无 git remote：先推再发）` };
  const gh = spawnSync('gh', ['run', 'list', '--commit', head, '--json', 'conclusion'], { cwd: ROOT, encoding: 'utf8', timeout: GH_TIMEOUT_MS });
  if (gh.error) {
    return { ok: true, degraded: true, detail: `gh CLI 不可用（${gh.error.code === 'ENOENT' ? '未安装' : gh.error.code}）——CI 判决未知（DEGRADED 非阻断）。安装：https://cli.github.com/ 或 brew install gh；登录：gh auth login` };
  }
  if (gh.status !== 0) {
    return { ok: true, degraded: true, detail: `gh 查询失败（exit ${gh.status}：${String(gh.stderr || '').trim().slice(0, 120)}）——CI 判决未知（DEGRADED 非阻断）。检查网络与 gh auth login` };
  }
  let runs = null;
  try { runs = JSON.parse(gh.stdout); } catch { /* 输出形态异常 → degraded */ }
  if (!Array.isArray(runs)) return { ok: true, degraded: true, detail: 'gh 输出不可解析（非 run 数组）——CI 判决未知（DEGRADED 非阻断）' };
  if (runs.length === 0) return { ok: false, detail: `CI 对此 commit（${head.slice(0, 10)}）无判决——unknown is not a pass，先推再发` };
  const done = runs.filter((r) => r.conclusion != null);
  if (done.length === runs.length && done.every((r) => r.conclusion === 'success')) {
    return { ok: true, detail: `CI success（${runs.length} run @ ${head.slice(0, 10)}）` };
  }
  if (done.some((r) => r.conclusion !== 'success')) {
    const verdicts = [...new Set(done.map((r) => r.conclusion).filter(Boolean))].join(',');
    return { ok: false, detail: `CI 判决 ${verdicts}（${done.length}/${runs.length} run）——CI 红不发版` };
  }
  return { ok: false, detail: `CI running（${runs.length - done.length}/${runs.length} run 未落判决）——unknown is not a pass，等判决落定再发` };
}

// releaseReadiness：十二条件聚合（9 阻断 + 3 非阻断）。blockers 空 → READY（exit 0），否则 NOT READY（exit 2）。
// 批次 2 新增：worktree-clean / ci-status（阻断，源 dsh·cc 复查裁决）+ review-profile（非阻断，降档还款可见化）。
export function releaseReadiness({ budget = 3000 } = {}) {
  const cond = (id, blocking, r) => ({ id, blocking, ok: r.ok !== false, degraded: Boolean(r.degraded), detail: r.detail || null });

  const items = [
    cond('dod-static', true, run(() => {
      const c = dodStaticCore();
      return { ok: c.ok, detail: c.ok ? '八项静态检查通过' : `failing: ${c.failures.join(', ')}` };
    })),
    cond('trace-coverage', true, run(() => {
      // Task 9.2 起 R5 trace 真值：悬空引用（code/test 引用未声明 id）阻断发布；
      // coverage 对 minCoverage（默认 0——自举 Spec 验收靠 dod 链非单测引用，目标项目可上调）。
      const r = specTrace();
      if (r.degraded) return { ok: true, degraded: true, detail: r.reason };
      return {
        ok: r.ok,
        detail: r.ok
          ? `${r.total} 需求，coverage ${r.coverage}（min ${r.minCoverage}），悬空 0`
          : `悬空 ${(r.dangling || []).length + (r.danglingTests || []).length} 项，coverage ${r.coverage} < min ${r.minCoverage}`,
      };
    })),
    cond('ledger-intact', true, run(() => {
      const r = verifyLedger();
      return { ok: r.ok, detail: r.ok ? `${r.total} entries` : `断链：${JSON.stringify(r.issues.slice(0, 2))}` };
    })),
    cond('receipt-fresh', true, run(() => {
      const ver = verifyLedger();
      if (!ver.ok) return { ok: false, detail: '账本不可信，新鲜性无从谈起' };
      const fresh = latestReceipts({ fresh: true });
      return fresh.size > 0
        ? { ok: true, detail: `${fresh.size} 条新鲜回执（fingerprint 匹配当前 diff）` }
        : { ok: false, detail: 'stale：当前 diff 下无任何新鲜回执（先跑 gate / receipt write）' };
    })),
    cond('fast-mode-closed', true, run(() => {
      const s = fastStatus();
      return s.enabled
        ? { ok: false, detail: `fast 窗口开启至 ${s.until}（reason: ${s.reason ?? '?'}）——发版前必须窗口关闭且债务清偿` }
        : { ok: true, detail: 'closed（无活跃 fast 窗口）' };
    })),
    cond('fast-debt-repaid', true, run(() => {
      const debt = fastDebtReceipts();
      if (!debt.length) return { ok: true, detail: '无未偿 SKIPPED 债务' };
      const byCheck = [...new Set(debt.map((e) => e.content.check))];
      return { ok: false, detail: `未偿证据贷款：${byCheck.join(', ')}（SKIPPED 须补验非 SKIPPED 回执）` };
    })),
    cond('review-backlog', false, run(() => {
      const b = backlogList();
      return b.expired
        ? { ok: false, detail: `${b.expired} 条过期积压（非阻断）：过期债要么偿还要么显式记 waiver` }
        : { ok: true, detail: `${b.count} 条积压，0 过期` };
    })),
    cond('decay-signals', false, run(() => {
      const r = riskScan();
      const high = r.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
      return { ok: r.ok, detail: `risk ${high} high/critical（非阻断，逐项给下一步动作）` };
    })),
    cond('sync-clean', true, run(() => {
      const r = syncCheck({ staged: false });
      return r.ok
        ? { ok: true, detail: `sync-check 通过（${r.checkedPaths} 变更路径）` }
        : { ok: false, detail: `errors: ${r.errors.map((e) => e.code).join(',')}` };
    })),
    cond('worktree-clean', true, run(() => {
      // 要发的=被测的：脏树上打的 tag 语义不明（tag 内容 ≠ 验证过的内容）。
      // 运行态（.zcode/state/** 等）不算脏——stripState 语义与 fingerprint 一致（core.mjs 先例）。
      const dirty = changedPaths();
      if (!dirty.length) return { ok: true, detail: '工作树干净（.zcode/state/ 运行态不计入）' };
      return { ok: false, detail: `工作树脏（${dirty.length} 路径：${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ' 等' : ''}）——要发的=被测的：先提交或清理，脏树上的 tag 语义不明` };
    })),
    cond('ci-status', true, run(ciConclusion)),
    cond('review-profile', false, run(() => {
      // 降档还款可见化（源 dsh 28bb5f2 论点）：unconvened security lens is a gap, not a pass——
      // 降档可能是合法决策，但合法决策要留痕（waiver/ADR），不能是静默的免费默认。非阻断 warning。
      const catalog = loadCatalog();
      const review = catalog?.review || null;
      const explicit = Array.isArray(review?.lenses) && review.lenses.length ? review.lenses : null;
      const profile = review?.profile || 'production';
      if (!review || (!review.profile && !explicit)) {
        return { ok: true, detail: 'review profile: default（production）——catalog 无 review 覆盖，引擎隐式默认' };
      }
      const full = REVIEW_PROFILES.production;
      const effective = explicit || REVIEW_PROFILES[profile] || full;
      const missing = full.filter((l) => !effective.includes(l));
      if (profile === 'production' && !explicit) {
        return { ok: true, detail: 'review profile: production（default）' };
      }
      if (!missing.length) {
        return { ok: true, detail: `review profile: ${profile}${explicit ? ' + 显式 lenses override' : ''}（组队 ${effective.join('+')}，不低于全员）` };
      }
      return {
        ok: false,
        detail: `review profile 降档（${profile}${explicit ? ' + lenses override' : ''}，未召集 lens：${missing.join(',')}）——降档是合法决策但不是免费默认：unconvened lens is a gap, not a pass；发版前记 waiver/ADR 显式豁免或恢复 profile`,
      };
    })),
  ];

  const blockers = items.filter((i) => i.blocking && !i.ok);
  const warnings = items.filter((i) => !i.blocking && !i.ok);
  const ready = blockers.length === 0;

  const lines = [
    `# Release readiness - ${nowIso()}`,
    '',
    'tagging/pushing/deploying 是 HIGH 档人类行为，本命令永不执行——它只装配证据，决定权在人类。',
    '',
    '## Conditions',
  ];
  for (const i of items) {
    lines.push(`- [${i.ok ? 'x' : ' '}] ${i.id}${i.blocking ? ' (blocking)' : ''}${i.degraded ? ' [DEGRADED]' : ''}${i.detail ? ` - ${i.detail}` : ''}`);
  }
  lines.push('');
  lines.push(ready
    ? '## READY - 全部阻断条件成立。人类现在可以 tag / publish（并由人类执行，不是本命令）。'
    : `## NOT READY - 阻断条件须先修复：${blockers.map((b) => b.id).join(', ')}`);

  let text = lines.join('\n');
  let truncated = false;
  if (text.length > budget) { text = `${text.slice(0, budget)}\n...[truncated]`; truncated = true; }
  const degraded = items.filter((i) => i.degraded).map((i) => i.id);
  return { ok: ready, ready, blockers: blockers.map((b) => b.id), warnings: warnings.map((w) => w.id), degraded, items, chars: text.length, budget, truncated, text };
}
