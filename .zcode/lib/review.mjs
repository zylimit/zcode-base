// 结构化分歧审查（Task 8.5，dsh review 全链移植 + cc CoVe 扩展）：
// 把「结构化分歧审查」做成闸——verdict 由已记录事实计算而非断言，并绑定 diffHash。
// 此前这只是 skill 里的一段散文（等于没有）；现在协议下沉进引擎：
//   start（impact→lens 组队/profile×属性裁剪+lineage）→ blue（自证必须带证据）→
//   lens <name>（finding 必须 file:line 或可跑 reproduction；stage 门=预算）→
//   verdict（errors 聚合/unable/escalate/maxRounds；仅 ACCEPT+isFinal 落回执）→
//   backlog（三性 finding 永不可入积压——积压会变成设计拒绝的豁免）。
// CoVe（cc §J）：findings 可带 verificationQuestion——Judge 前由不同验证者独立核验，
// verdict 输出标注「待独立核验」；价值在证据锚定字段，不在多 agent 形式。
//
// 退出码：协议违规 1 / FIX_REQUIRED 2 / degraded（空 diff）3 / stale（diffHash 变）4。
// 状态：.zcode/state/review/session.json（单文件会话，写一律 withStateLock 锁内）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { nowIso, sha256 } from './common.mjs';
import { DIRS, ROOT } from './config.mjs';
import { loadCatalog } from './catalog.mjs';
import { analyze } from './impact.mjs';
import { changedPaths, fingerprint, headCommit, isGitRepo } from './git.mjs';
import { loadState, withStateLock } from './state.mjs';
import { writeReceipt } from './receipts.mjs';

const REVIEW_DIR = () => path.join(DIRS.state, 'review');
const REVIEW_PATH = () => path.join(REVIEW_DIR(), 'session.json');
const LOCATION = /^[^\s:]+:\d+/;
const DIFF_SPILL_LINES = 800;

export const REVIEW_STAGES = Object.freeze({ 1: 'code', 2: 'functional', 3: 'trust' });

// 审查小组：五个 lens 各自认领一个失败面，finding 有明确归属、两个 lens 不重复报同一件事。
// lens 携带它代言的属性——引擎据此把「没有任何受影响模块声明该属性 low 以上」的 lens 裁出组队：
// 给不存隐私数据的模块召集隐私审查只会产出 nitpick，而 nitpick 正是审查循环失去信任的方式。
// correctness 无属性永留：它是每个审查的地板，缺了它 stage 模型就空转（dsh 同款论证）。
export const LENS_LIBRARY = Object.freeze({
  correctness: { stage: 1, attribute: null, asks: '是否做了需求所说的事——边界与错误路径上，不只快乐路径' },
  reliability: { stage: 2, attribute: 'reliability', asks: '没有修复时测试会红吗？每个用例可溯源吗？失败被分类而非重试吗？' },
  resilience: { stage: 3, attribute: 'resilience', asks: '部分失败时会怎样：出站调用有超时吗？重试有预算与退避吗？降级模式声明了吗？' },
  security: { stage: 3, attribute: 'security', asks: '横跨本变更信任边界的 STRIDE：认证/授权/注入面/密钥/传输/供应链' },
  privacy: { stage: 3, attribute: 'privacy', asks: '触碰/记录/导出/留存了哪些个人数据，依据什么，删除可证明吗？' },
});

// 档位：项目的赌注该买多大的审查组（dsh 数字为上限——本库 5 lens，production/regulated 封顶全员）。
// 默认 production（catalog.review.profile 可调）。
export const REVIEW_PROFILES = Object.freeze({
  personal: ['correctness'],
  team: ['correctness', 'reliability', 'resilience'],
  production: ['correctness', 'reliability', 'resilience', 'security', 'privacy'],
  regulated: ['correctness', 'reliability', 'resilience', 'security', 'privacy'],
});

// zcode catalog 属性五档（none/low/medium/high/critical）；阈值 low：low 以上才算「声明了」。
const TIER_RANK = ['none', 'low', 'medium', 'high', 'critical'];

// 本次审查召集哪些 lens。权威顺序：显式 catalog.review.lenses 赢；否则 profile 定组，
// 属性裁剪只能减不能加（否则把所有属性都声明 high 的项目会召集全员——恰是要防的失败）。
export function reviewLenses(catalog, { affected = null } = {}) {
  const explicit = catalog?.review?.lenses;
  if (Array.isArray(explicit) && explicit.length) return explicit;
  const profile = catalog?.review?.profile || 'production';
  const base = REVIEW_PROFILES[profile] || REVIEW_PROFILES.production;
  if (!affected || !catalog || !Array.isArray(catalog.modules)) return base;
  const mods = catalog.modules.filter((m) => affected.includes(m.name));
  if (mods.length === 0) return base;
  return base.filter((name) => {
    const attr = LENS_LIBRARY[name]?.attribute;
    if (!attr) return true; // correctness：无属性的地板 lens
    return mods.some((m) => TIER_RANK.indexOf((m.attributes || {})[attr] || 'none') >= TIER_RANK.indexOf('low'));
  });
}

// profile 点名却未召集的 lens：每个给出理由（组队可解释，不是黑箱）。
export function lensExclusions(catalog, affected) {
  if (Array.isArray(catalog?.review?.lenses) && catalog.review.lenses.length) return [];
  const profile = catalog?.review?.profile || 'production';
  const base = REVIEW_PROFILES[profile] || REVIEW_PROFILES.production;
  const kept = new Set(reviewLenses(catalog, { affected }));
  return base.filter((n) => !kept.has(n)).map((n) => ({
    lens: n,
    reason: `无受影响模块声明 ${LENS_LIBRARY[n].attribute} 在 low 以上（属性裁剪）`,
  }));
}

export function readReview() {
  try { return JSON.parse(fs.readFileSync(REVIEW_PATH(), 'utf8')); } catch { return null; }
}

function saveReview(s) {
  withStateLock(REVIEW_PATH(), () => {
    fs.mkdirSync(REVIEW_DIR(), { recursive: true });
    const tmp = `${REVIEW_PATH()}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    fs.renameSync(tmp, REVIEW_PATH());
  });
  return s;
}

// 会话只对它开审时的那棵树有效：fingerprint 变（含 untracked 内容字节）→ 一切写操作 stale（exit 4）。
// .zcode/state/ 本身不入指纹——写 session/账本不会使会话自废。
function freshness(s) {
  if (!s) return { ok: false, reason: '无审查会话：先 node .zcode/zbase.mjs review start' };
  if (s.diffHash !== fingerprint().fingerprint) {
    return { ok: false, stale: true, reason: '工作树在本次审查开审后已变化（stale）——重新 review start' };
  }
  return { ok: true };
}

// 默认审查范围 = 活跃任务的 ownedPaths（completion 门与 ownedPaths 排序比对的锚）；
// 无任务或显式 --paths 时取当前变更路径。
function defaultScope(paths) {
  if (paths && paths.length) return [...paths].sort();
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id);
  if (active?.ownedPaths?.length) return [...active.ownedPaths].sort();
  return changedPaths().sort();
}

export function startReview({ paths = null, packPath = null } = {}) {
  if (!isGitRepo()) return { ok: false, degraded: true, reason: 'not-a-git-repository' };
  const changed = changedPaths();
  if (changed.length === 0) {
    return { ok: false, degraded: true, reason: 'no-change：工作树是干净的，没有可审查的对象' };
  }
  const catalog = loadCatalog();
  const impact = analyze({ changed });
  // 保守扩张：fanout ⊇ 直接受影响（unmapped/global 时是全模块——宁可多召集不少召集）
  const affected = impact.ok ? impact.fanout : null;

  // 对同一工作的连续否决是关于标准的信息，不是「再试一次」的指令——血缘计数，超限 escalate。
  const previous = readReview();
  const lineage = previous?.lineage || [];
  const rejections = previous?.verdict?.verdict === 'FIX_REQUIRED'
    ? lineage.concat([{ at: previous.verdict.at, diffHash: previous.diffHash, errors: previous.verdict.errorCount, round: previous.verdict.round }])
    : lineage;

  const session = saveReview({
    version: 1,
    diffHash: fingerprint().fingerprint,
    baseCommit: headCommit(),
    startedAt: nowIso(),
    scope: defaultScope(paths),
    packPath: packPath || null,
    affectedModules: affected || [],
    impactDegraded: impact.ok ? (impact.degraded ? impact.reasons : null) : [impact.reason],
    requiredLenses: reviewLenses(catalog, { affected }),
    excludedLenses: lensExclusions(catalog, affected),
    lineage: rejections,
    blue: null,
    lenses: {},
    verdict: null,
    backlog: previous?.backlog || [],
  });
  return {
    ok: true,
    session,
    round: (session.lineage || []).length + 1,
    note: '按 stage 顺序报告：blue → 各 stage lens（node .zcode/zbase.mjs review status 看当前 stage 与待报 lens）',
  };
}

// Blue 陈述它验证了什么、怎么验证的。没有证据的主张只是观点。
export function recordBlue(payload) {
  const s = readReview();
  const f = freshness(s);
  if (!f.ok) return { ok: false, ...f };
  const claims = Array.isArray(payload?.claims) ? payload.claims : [];
  if (claims.length === 0) return { ok: false, reason: 'blue 至少陈述一条 claim' };
  const bad = claims.filter((c) => !c || !c.claim || !c.evidence);
  if (bad.length) {
    return { ok: false, reason: `${bad.length} 条 claim 无证据；没有命令/路径/退出码的主张只是观点` };
  }
  s.blue = { at: nowIso(), claims };
  return { ok: true, session: saveReview(s), claims: claims.length };
}

// 当前允许报告的最高 stage：更早 stage 的 required lens 未报完，更贵的 lens 不许上场（stage 门=预算）。
export function currentStage(s) {
  const stageOf = (n) => LENS_LIBRARY[n]?.stage ?? 1;
  const reported = new Set(Object.keys(s.lenses || {}));
  const required = s.requiredLenses || [];
  let current = 1;
  for (;;) {
    const lenses = required.filter((n) => stageOf(n) === current);
    if (lenses.length === 0) {
      // profile 没召集该 stage 的 lens 不是门：跳过，而不是要求没人被要求的报告。
      if (current < 3) { current++; continue; }
      return current;
    }
    if (!lenses.every((n) => reported.has(n))) return current;
    if (current < 3) { current++; continue; }
    return current;
  }
}

// 一个 lens 报告。finding 必须可定位（file:line）或可复现（别人能跑的 reproduction）——
// 其他是印象，而印象正是审查表演的材料。CoVe：可带 verificationQuestion 供 Judge 前独立核验。
export function recordLens(name, payload) {
  const s = readReview();
  const f = freshness(s);
  if (!f.ok) return { ok: false, ...f };
  if (!(s.requiredLenses || []).includes(name)) {
    return { ok: false, reason: `未知 lens "${name}"；本次审查要求：${s.requiredLenses.join(', ')}` };
  }
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  const unlocated = findings.filter((x) => !(x && ((x.location && LOCATION.test(String(x.location))) || (x.reproduction && String(x.reproduction).trim()))));
  if (unlocated.length) {
    return { ok: false, reason: `${unlocated.length} 条 finding 既无 file:line location 也无 reproduction；无法被行动的 finding 不算数` };
  }
  for (const x of findings) {
    if (!['error', 'warning', 'info'].includes(x.severity)) {
      return { ok: false, reason: '每条 finding 需要 severity error | warning | info' };
    }
  }
  // 更晚的 stage 不得在更早 stage 全员报完前开审：贵 lens 远离还没过便宜 lens 的代码。
  const stage = LENS_LIBRARY[name]?.stage ?? 1;
  const current = currentStage(s);
  if (stage > current) {
    return {
      ok: false, stageGated: true, lens: name, stage, currentStage: current,
      reason: `lens ${name} 属 stage ${stage}（${REVIEW_STAGES[stage]}），审查当前在 stage ${current}（${REVIEW_STAGES[current]}）——先报完更早 stage 的 lens（review status 查看待报清单）`,
    };
  }
  s.lenses[name] = {
    at: nowIso(),
    unable: !!(payload && payload.unable),
    unableReason: (payload && payload.unableReason) || null,
    findings,
  };
  return { ok: true, session: saveReview(s), findings: findings.length, stage };
}

const BACKLOG_FORBIDDEN = /(security|safety|privacy|pii|secret|credential)/i;

// 裁定。由已记录的事实计算，不是断言：未审查的 lens 不能被挥手放行，
// 报了 error 的 lens 不能被什么都没发现的 lens 投票否决。
export function reviewVerdict({ reviewer = 'reviewer', notes = '' } = {}) {
  const s = readReview();
  const f = freshness(s);
  if (!f.ok) return { ok: false, ...f };

  const catalog = loadCatalog();
  const stage = currentStage(s);
  const all = Object.entries(s.lenses);
  // error 跨 stage 聚合：任何 stage 的 error 都是主导事实——下一轮存在的意义就是修它。
  const errors = all.flatMap(([l, v]) => (v.findings || []).filter((x) => x.severity === 'error').map((x) => ({ lens: l, ...x })));
  const unable = all.filter(([, v]) => v.unable).map(([l]) => l);
  const pendingVerification = all.flatMap(([l, v]) => (v.findings || []).filter((x) => x.verificationQuestion).map((x) => ({ lens: l, summary: x.summary, verificationQuestion: x.verificationQuestion })));
  const blockers = [];
  if (!s.blue) blockers.push('blue 尚未陈述它验证了什么（review blue）');

  const stageLenses = (s.requiredLenses || []).filter((n) => (LENS_LIBRARY[n]?.stage ?? 1) === stage);
  const missing = stageLenses.filter((l) => !s.lenses[l]);
  let verdict = null;
  if (errors.length) verdict = 'FIX_REQUIRED';
  else if (unable.length) verdict = 'NEEDS_MORE_EVIDENCE';
  else if (missing.length) blockers.push(`stage ${stage}（${REVIEW_STAGES[stage]}）lens 未报告：${missing.join(', ')}`);
  else verdict = 'ACCEPT';
  if (blockers.length) {
    return { ok: false, blockers, stage, requiredLenses: s.requiredLenses, recorded: Object.keys(s.lenses) };
  }

  const maxRounds = catalog?.review?.maxRounds || 3;
  const round = (s.lineage || []).length + 1;
  const escalate = verdict === 'FIX_REQUIRED' && round >= maxRounds;
  const isFinal = stage >= 3 || !(s.requiredLenses || []).some((n) => (LENS_LIBRARY[n]?.stage ?? 1) > stage);

  s.verdict = {
    at: nowIso(), verdict, reviewer, notes, round, escalate, stage, isFinal,
    errorCount: errors.length, unableLenses: unable, lensCoverage: stageLenses,
  };
  saveReview(s);

  // 仅 ACCEPT+isFinal 自动落账：结构化分歧审查的最终产物是一张带 lens 覆盖的回执
  // （哈希链无缝——走现有 writeReceipt），completion 门按 check='review' 消费。
  let receipt = null;
  if (verdict === 'ACCEPT' && isFinal) {
    receipt = writeReceipt({
      check: 'review',
      status: 'PASS',
      note: `review ACCEPT：stage ${stage}/${REVIEW_STAGES[stage]} round ${round}，lenses=${(s.requiredLenses || []).join(',')}`,
      extra: {
        reviewVerdict: 'ACCEPT',
        reviewStage: stage,
        reviewRound: round,
        reviewScope: [...(s.scope || [])].sort(),
        reviewDiffHash: s.diffHash,
        reviewErrorCount: 0,
        lenses: s.requiredLenses,
      },
    });
  }

  const advice = escalate
    ? `第 ${round} 轮（上限 ${maxRounds}）：这个变更已被否决 ${round} 次。停。要么变更错了要么标准错了，再来一轮无法回答这个问题——交人工：缩小范围、降低 catalog.review.profile（赌注不值得这个组队）、或把 finding 记成有书面理由的债（review backlog）。`
    : verdict === 'ACCEPT'
      ? (isFinal
        ? `全部 stage 通过、每个 required lens 已报告、无人发现 error。警惕：共识比三个分歧的 lens 更差——agent 便宜地互相认同不是审查，lens 间无任何分歧时抽查 findings 是否真的核过证据。`
        : `stage ${stage}（${REVIEW_STAGES[stage]}）通过；报告 stage ${stage + 1} 的 lens 以推进（review status 查看待报清单）`)
      : verdict === 'FIX_REQUIRED'
        ? '修 error 后重开审查（review start）；发现 error 的 lens 不会被什么都没发现的 lens 投票否决'
        : '有 lens 无法得出结论（unable）；补它需要的证据，而不是绕过它接受';

  return {
    ok: true, verdict, stage, isFinal, round, maxRounds, escalate,
    errors: errors.slice(0, 20), errorCount: errors.length,
    unableLenses: unable,
    pendingVerification,
    lensCoverage: s.requiredLenses,
    excludedLenses: s.excludedLenses || [],
    receipt: receipt ? { seq: receipt.seq, chainHash: receipt.chainHash } : null,
    advice,
  };
}

export function reviewStatus() {
  const s = readReview();
  if (!s) return { ok: true, active: false, note: '无审查会话：node .zcode/zbase.mjs review start' };
  const f = freshness(s);
  const stage = currentStage(s);
  const stageLenses = (s.requiredLenses || []).filter((n) => (LENS_LIBRARY[n]?.stage ?? 1) === stage);
  const reported = Object.keys(s.lenses || {});
  return {
    ok: true,
    active: true,
    stale: !f.ok ? f.reason : null,
    diffHash: s.diffHash.slice(0, 12),
    scope: s.scope,
    round: (s.lineage || []).length + 1,
    stage, stageName: REVIEW_STAGES[stage],
    requiredLenses: s.requiredLenses,
    excludedLenses: s.excludedLenses || [],
    reported,
    missingForStage: stageLenses.filter((l) => !reported.includes(l)),
    blue: s.blue ? { claims: s.blue.claims.length } : null,
    verdict: s.verdict ? { verdict: s.verdict.verdict, round: s.verdict.round, escalate: s.verdict.escalate, isFinal: s.verdict.isFinal } : null,
    backlog: { count: (s.backlog || []).length, expired: (s.backlog || []).filter((e) => !(new Date(e.expiry) > new Date())).length },
  };
}

// ---------- backlog ----------
// 审查必须能结束。无休止的轮次是好标准被抛弃的方式，但 finding 不能就此蒸发：
// 人决定背负的 finding 变成积压条目（owner/expiry/理由）。三性 finding 永不可入积压——
// 积压会变成设计拒绝给它的那种豁免（backlog 即 waiver 的缺口）。
export function backlogAdd(payload) {
  const s = readReview();
  const f = freshness(s);
  if (!f.ok) return { ok: false, ...f };
  const required = ['owner', 'expiry', 'summary', 'lens'];
  const missing = required.filter((k) => !(payload && payload[k] && String(payload[k]).trim()));
  if (missing.length) return { ok: false, reason: `积压条目需要：${missing.join(', ')}（owner/expiry 未来 ISO/summary/lens）` };
  if (!(new Date(payload.expiry) > new Date())) return { ok: false, reason: 'expiry 必须是未来时间；无日期的债永远无人偿还' };
  const summary = String(payload.summary);
  if (BACKLOG_FORBIDDEN.test(summary)) {
    return { ok: false, reason: '三性（security/safety/privacy/pii/secret/credential）相关 finding 不可入积压——积压会变成它恰好要充当的豁免' };
  }
  s.backlog = s.backlog || [];
  const entry = {
    at: nowIso(),
    owner: String(payload.owner),
    expiry: payload.expiry,
    lens: String(payload.lens),
    summary,
    location: payload.location || null,
  };
  s.backlog.push(entry);
  saveReview(s);
  return { ok: true, entry, count: s.backlog.length };
}

export function backlogList() {
  const s = readReview();
  if (!s) return { ok: true, count: 0, entries: [], expired: 0 };
  const now = new Date();
  const entries = (s.backlog || []).map((e) => ({ ...e, expired: !(new Date(e.expiry) > now) }));
  return { ok: true, count: entries.length, entries, expired: entries.filter((e) => e.expired).length };
}

// completion 门（Task 8.6）用：审查回执的 scope 与任务 ownedPaths 排序比对。
// 审查范围过期（scope 与任务归属不一致）不算数——审的必须就是这个任务的这些路径。
export function scopeMatches(reviewScope, ownedPaths) {
  return JSON.stringify([...(reviewScope || [])].sort()) === JSON.stringify([...(ownedPaths || [])].sort());
}

// ---------- review-pack ----------
// 审查证据包：Commits/Diffstat/删除审计（走了什么要永远看，不只看来了什么）/Untracked/Diff。
// base 解析顺序：最近 tag → origin/main → 首 commit；diff>800 行溢写 patch 文件只留指针。
function resolveBase() {
  for (const [label, args] of [
    ['tag', ['describe', '--tags', '--abbrev=0']],
    ['origin/main', ['rev-parse', '--verify', '--quiet', 'origin/main']],
    ['first-commit', ['rev-list', '--max-parents=0', 'HEAD']],
  ]) {
    try {
      const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const v = out.trim();
      if (v) return { base: v, via: label };
    } catch { /* 该来源不可用，试下一个 */ }
  }
  return { base: 'HEAD', via: 'fallback-head' };
}

function packGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}

export function reviewPack({ base = null } = {}) {
  if (!isGitRepo()) return { ok: false, degraded: true, reason: 'not-a-git-repository' };
  const resolved = base ? { base, via: 'explicit' } : resolveBase();
  const { base: b } = resolved;
  const commits = packGit(['log', '--oneline', `${b}..HEAD`]).trim();
  const stat = packGit(['diff', '--stat', b]).trim();
  const nameStatus = packGit(['diff', '--name-status', b]).trim();
  const deletions = nameStatus.split('\n').filter((l) => /^D\s/.test(l)).map((l) => l.slice(1).trim());
  const untracked = packGit(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).filter((p) => !p.startsWith('.zcode/state/'));
  const full = packGit(['diff', b]);
  const lines = full.split('\n');
  fs.mkdirSync(REVIEW_DIR(), { recursive: true });
  const stamp = Date.now();
  let diffSection;
  if (lines.length > DIFF_SPILL_LINES) {
    const spill = path.join(REVIEW_DIR(), `diff-${stamp}.patch`);
    fs.writeFileSync(spill, full);
    diffSection = `Diff 共 ${lines.length} 行，已溢写至 ${path.relative(ROOT, spill)}——到该文件读取。`;
  } else {
    diffSection = full;
  }
  const body = [
    '# 审查证据包（review pack）',
    '',
    `Base: ${b}（解析自 ${resolved.via}）`,
    `Head: ${headCommit()}`,
    `Generated: ${nowIso()}`,
    '',
    '## Commits',
    '',
    commits || '(none)',
    '',
    '## Diffstat',
    '',
    stat || '(empty)',
    '',
    '## 删除审计（有删行的文件——永远审查走了什么，不只看来了什么）',
    '',
    deletions.length ? deletions.join('\n') : '(无删除文件)',
    '',
    '## Untracked 新文件',
    '',
    untracked.length ? untracked.join('\n') : '(none)',
    '',
    '## Diff',
    '',
    diffSection,
    '',
  ].join('\n');
  const outPath = path.join(REVIEW_DIR(), `review-pack-${stamp}.md`);
  fs.writeFileSync(outPath, body);
  return {
    ok: true, base: b, baseVia: resolved.via, packPath: path.relative(ROOT, outPath),
    commits: commits ? commits.split('\n').length : 0,
    deletedFiles: deletions, untracked, diffLines: lines.length,
    diffHash: sha256(full),
    note: `证据包已写入 ${path.relative(ROOT, outPath)}；review start --paths 可绑定审查范围`,
  };
}
