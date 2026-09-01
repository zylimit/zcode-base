// release + dod（Task 8.7，源 dsh releaseReadiness/dod + cc make-release 的证据侧）。
// release 汇齐人类签字所需的九条件证据，但 tagging/pushing/deploying 是 HIGH 档人类行为，
// 本命令永不执行——它只装配证据，决定权在人类（宪法：关键闸口以人工审批为准）。
// dod 是静态 DoD 聚合闸：12 步静态检查聚合，每步 try-catch（引擎错误→DEGRADED 标注，
// degraded 绝不假装绿）；blocking 步失败 → exit 2（gate 阻断）。dod 只做静态治理，
// 行为证明仍需 gate（四态落账 + fingerprint 新鲜性）。
import { loadCatalog, lint } from './catalog.mjs';
import { listPaths } from './git.mjs';
import { skillsLint } from './skillslint.mjs';
import { agentsLint } from './agentslint.mjs';
import { rulesAudit } from './rulesaudit.mjs';
import { check as archCheckFn, adrCheck } from './arch.mjs';
import { verify as qualityVerify } from './quality.mjs';
import { audit as fitnessAudit } from './fitness.mjs';
import { verifyLedger, latestReceipts, fastDebtReceipts } from './receipts.mjs';
import { fastStatus } from './state.mjs';
import { scan as riskScan } from './risk.mjs';
import { backlogList } from './review.mjs';
import { syncCheck } from './sync.mjs';
import { assessBudget } from './budget.mjs';
import { nowIso } from './common.mjs';

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
    ['spec', () => ({ ok: true, degraded: true, detail: 'legacy：spec-lint 属 R5（spec-id 体系），引入前放行' })],
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

// dod：12 步静态聚合（10 阻断 + rules-audit/risk/budget 非阻断；trace legacy degraded 放行）。
export function dod({ textBudget = 3000 } = {}) {
  const core = dodStaticCore();
  const step = (id, blocking, r) => ({ id, blocking, ok: r.ok !== false, degraded: Boolean(r.degraded), detail: r.detail || null });
  const steps = [
    step('catalog-lint', true, core.details.catalog),
    step('skills-lint', true, core.details.skills),
    step('agents-lint', true, core.details.agents),
    // rules-audit 默认 advisory（zbase rules-audit 不带 --max 不阻断）——dod 同步降级为非阻断
    step('rules-audit', false, run(() => {
      const r = rulesAudit({ max: Infinity });
      return { ok: true, detail: `advisory：enforced ${r.counts.enforced}/${r.counts.total}（ratio ${r.enforcementRatio}），未执法 ${r.counts.unenforced} 条不阻断` };
    })),
    step('adr-check', true, core.details.adr),
    step('attributes', true, core.details.attributes),
    step('arch-check', true, core.details.arch),
    step('fitness', true, core.details.fitness),
    step('trace', true, { ok: true, degraded: true, detail: 'legacy degraded 放行：spec-id 体系 R5 引入后接真值' }),
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

// releaseReadiness：九条件聚合（7 阻断 + 2 非阻断）。blockers 空 → READY（exit 0），否则 NOT READY（exit 2）。
export function releaseReadiness({ budget = 3000 } = {}) {
  const cond = (id, blocking, r) => ({ id, blocking, ok: r.ok !== false, degraded: Boolean(r.degraded), detail: r.detail || null });

  const items = [
    cond('dod-static', true, run(() => {
      const c = dodStaticCore();
      return { ok: c.ok, detail: c.ok ? '八项静态检查通过' : `failing: ${c.failures.join(', ')}` };
    })),
    cond('trace-coverage', true, run(() => ({ ok: true, degraded: true, detail: 'degraded 放行（legacy）：spec-id 体系 R5 引入后接真值' }))),
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
  return { ok: ready, ready, blockers: blockers.map((b) => b.id), warnings: warnings.map((w) => w.id), items, chars: text.length, budget, truncated, text };
}
