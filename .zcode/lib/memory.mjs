// 项目记忆（Task 7.9 + 7.12，源 dsh context.mjs memory law）：
//   - recap：预算化派生摘要（6000 字符）——恢复成本是「当前状态」的函数，不是「项目年龄」的函数；
//   - invariants：不可谈判集（1200 字符）——compaction 不修正漂移（ContextEcho 23 模型实测），
//     最小法则集 + 活状态在每次阶段边界/压缩后重注入；
//   - ledgerHealth / archiveLedger：活账本保持小而有界；历史只移动、永不删除、永不改写（append-only）；
//     M3 阈值（Done>m3Threshold=100）提示自动归档。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS, FILES, loadHarnessConfig } from './config.mjs';
import { rel, nowIso, readLines } from './common.mjs';
import { loadState, fastStatus } from './state.mjs';
import { branchName, headCommit, changedPaths } from './git.mjs';
import { verifyLedger, fastDebtReceipts } from './receipts.mjs';
import { scan as riskScan } from './risk.mjs';

function memoryConfig() {
  const cfg = loadHarnessConfig().memory || {};
  return {
    ledger: 'progress.md',
    archive: 'progress.archive.md',
    keepDone: 40,
    keepNotes: 30,
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
  return {
    ledger: cfg.ledger, bytes, maxLedgerBytes: cfg.maxLedgerBytes,
    doneEntries: done, keepDone: cfg.keepDone, noteEntries: notes,
    archive: cfg.archive, archiveBytes: Buffer.byteLength(readText(archivePath(cfg)), 'utf8'),
    autoArchiveSuggested: m3,
    ok: !over,
    advice: m3
      ? `Done ${done} 条已超 M3 阈值 ${cfg.m3Threshold}——建议立即自动归档：node .zcode/zbase.mjs archive --apply（历史只移动不删除）`
      : over
        ? `账本超预算（${bytes}B / Done ${done} 条）：跑 node .zcode/zbase.mjs archive --apply 把最旧条目移入 ${cfg.archive}，recap 保持恒定成本`
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

  const plan = [];
  const moved = { Done: [], Notes: [] };
  for (const [name, keep] of [['Done', cfg.keepDone], ['Notes', cfg.keepNotes]]) {
    const s = sectionNamed(sections, name);
    if (!s) continue; // 无段跳过
    const items = entriesOf(s);
    if (items.length <= keep) continue;
    // append 契约=最新在尾部 → 头部即最旧，搬头留尾；prepend 反之
    const tail = cfg.order === 'append' ? items.slice(0, items.length - keep) : items.slice(keep);
    moved[name] = tail;
    plan.push({ section: name, total: items.length, keep, moving: tail.length });
  }

  const total = plan.reduce((n, p) => n + p.moving, 0);
  if (total === 0) {
    return { ok: true, applied: false, moved: 0, plan: [], reason: '无可归档条目', health: ledgerHealth() };
  }
  if (!apply) {
    return { ok: true, applied: false, moved: total, plan, health: ledgerHealth() };
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
  const movedSet = new Set([...moved.Done, ...moved.Notes]);
  const pointer = `- Older entries are in [${cfg.archive}](${cfg.archive}).`;
  const out = [];
  let placed = false;
  for (const line of text.split('\n')) {
    if (movedSet.has(line)) {
      if (!placed) { out.push(pointer); placed = true; }
      continue;
    }
    if (POINTER_RE.test(line.trim())) continue; // 旧指针让位给新指针
    out.push(line);
  }
  fs.writeFileSync(ledgerPath(cfg), out.join('\n'));
  return { ok: true, applied: true, moved: total, plan, archive: cfg.archive, health: ledgerHealth() };
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

export function invariants({ budget } = {}) {
  const cfg = memoryConfig();
  const cap = budget || cfg.invariantsBudget;
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id) || null;
  const fast = fastStatus(state);
  const ver = verifyLedger();
  const lastLine = readLines(FILES.ledger).at(-1);
  const lastReceipt = lastLine ? (() => { try { return JSON.parse(lastLine).content; } catch { return null; } })() : null;

  const laws = [
    '# Invariants — 每次阶段边界与任何压缩后重读',
    '',
    '1. EVIDENCE 证据五步：想清证明命令→跑全新命令→读完整输出与 exit code→确认输出支持本结论→才下结论。禁用「应该/大概/看起来」。',
    '2. STATES 四态退出码：0 通过 / 1 错误 / 2 阻断 / 3 检查发现 / 4 账本校验失败。exit 3 不是通过，是 gap；缺工具是 BLOCKED 不是 PASS。',
    '3. FLOOR 三性红线：security / safety / privacy 永不可豁免、永不可 Fast 跳过、永不可降级——结构上无可表达之例外。',
    '4. SCOPE 只改派单 Scope 内文件；活跃任务的 ownedPaths 之外禁止写（写路径预检机器闸）；缺信息不是许可。',
    '5. TIERS HIGH 档停下等明确人工审批：push/发版/部署/密钥/迁移/新依赖/豁免/不可逆操作。',
  ];

  const live = [`- 任务: ${active ? `${active.id}——scope: ${Array.isArray(active.envelope.scope) ? active.envelope.scope.join(', ') : active.envelope.scope}` : '无活跃任务'}`];
  if (fast.enabled) {
    const debt = [...new Set(fastDebtReceipts({ windowId: fast.windowId }).map((e) => e.content.check))];
    live.push(`- FAST MODE 贷款生效至 ${fast.until}（${fast.reason}）：${debt.length ? `DEBT 未偿——SKIPPED 了 ${debt.join(', ')}，task finish 被阻断` : '暂无未偿 SKIPPED'}`);
  }
  live.push(`- 最新回执: ${lastReceipt ? `${lastReceipt.check}/${lastReceipt.status} @ ${lastReceipt.ts}` : '从未落账'}`);
  if (!ver.ok) live.push('- 账本断链：此前一切验证在重跑前均不可信');

  let body = `${laws.join('\n')}\n\n## Live state\n${live.join('\n')}\n`;
  let truncated = false;
  if (body.length > cap) {
    body = `${body.slice(0, cap)}\n...[truncated]\n`;
    truncated = true;
  }
  return { ok: true, chars: body.length, budget: cap, truncated, text: body };
}
