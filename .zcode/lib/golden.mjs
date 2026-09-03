// golden：行为尺子（批次 6，源 cc 8af3e2c 模式）。
// 单测测函数；golden 测「CLI 的行为面」——对一组代表性 verb×参数组合记录 stdout/stderr/exit code
// 基线，引擎大改后 check 重跑比对。为下次引擎大改准备一把「无意行为漂移」的尺子。
//
// 场景表两类（实现从简）：
//   - repo：本仓只读命令（status/recap/invariants/quality status/trace/impact/cochange/
//     spec view --all/rules-audit 等）——零副作用。
//   - sandbox：写面命令在一次性沙箱仓跑（tempdir + 最小 catalog + git init + dirty 文件，
//     mkproj 风格；每场景独立沙箱，销毁即复现）。
//
// 规范化遮罩（比对前统一施加；diffHash/fingerprint 类刻意不遮——遮了测不出 canonicalDiff 被改坏）：
//   ISO 时间戳→<TS>；UUID→<UUID>；毫秒 epoch 与 ms 耗时→<MS>；任务/waiver id→<ID>；
//   账本 seq→<SEQ>；其余 64hex→<HASH>；tempdir 路径→<TMP>。
//
// 基线落 .zcode/state/golden/baseline.json——state 是运行态不入 git：基线是机器本地物，
// 与 CI 判决分离（CI 不消费 golden；本地漂移由开发者 re-record）。
//
// 诚实边界：recap/invariants/task status 等场景读运行态（progress/state 内容），项目状态演化
// 会让 check 红——那是预期演化不是引擎回归，re-record 即可；判断漂移性质是人做的事，尺子只负责红。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const ZBASE = path.join(ROOT, '.zcode', 'zbase.mjs');
const BASELINE_FILE = () => path.join(ROOT, '.zcode', 'state', 'golden', 'baseline.json');
const STEP_TIMEOUT_MS = 90_000;

// 沙箱最小 catalog：production 组队按属性裁剪 → requiredLenses = correctness/reliability/resilience。
const SANDBOX_CATALOG = {
  version: 1,
  modules: [
    { name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low', resilience: 'low' }, riskTier: 'low' },
  ],
};

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回' };
const BLUE_OK = JSON.stringify({ claims: [{ claim: '边界路径已验证', evidence: 'node -e 0 → exit 0' }] });

// ── 场景表 ────────────────────────────────────────────────────────────────────
// setup = 沙箱建好后、主命令前的准备命令序列（输出不进基线；只有主命令的 stdout/stderr/exit 进基线）。
export const SCENARIOS = [
  // 本仓只读面
  { id: 'repo-task-status', kind: 'repo', args: ['task', 'status'] },
  { id: 'repo-fast-status', kind: 'repo', args: ['fast', 'status'] },
  { id: 'repo-plan', kind: 'repo', args: ['plan'] },
  { id: 'repo-recap', kind: 'repo', args: ['recap', '--budget', '3000'] },
  { id: 'repo-invariants', kind: 'repo', args: ['invariants', '--budget', '3000'] },
  { id: 'repo-quality-status', kind: 'repo', args: ['quality', 'status'] },
  { id: 'repo-trace', kind: 'repo', args: ['trace'] },
  { id: 'repo-impact', kind: 'repo', args: ['impact', '--paths', '.zcode/lib/quality.mjs'] },
  { id: 'repo-cochange', kind: 'repo', args: ['cochange', '--max-commits', '50', '--pair-threshold', '3', '--min-files', '2'] },
  { id: 'repo-rules-audit', kind: 'repo', args: ['rules-audit', '--max', '3'] },
  { id: 'repo-spec-view-all', kind: 'repo', args: ['spec', 'view', '--all', '--budget', '600'] },
  { id: 'repo-skills-lint', kind: 'repo', args: ['skills-lint'] },
  // 沙箱仓（写面 + 协议面）
  { id: 'sandbox-review-start', kind: 'sandbox', args: ['review', 'start', '--json'] },
  { id: 'sandbox-review-blue-empty-claims', kind: 'sandbox', args: ['review', 'blue'], stdin: '{"claims":[]}', setup: [['review', 'start']] },
  { id: 'sandbox-review-verdict-no-session', kind: 'sandbox', args: ['review', 'verdict'] },
  {
    id: 'sandbox-review-accept-authorship-false',
    kind: 'sandbox',
    args: ['review', 'verdict', '--json'],
    setup: [['review', 'start'], ['review', 'blue', null, BLUE_OK],
      ['review', 'lens', 'correctness', '{"findings":[]}'], ['review', 'lens', 'reliability', '{"findings":[]}'], ['review', 'lens', 'resilience', '{"findings":[]}']],
  },
  { id: 'sandbox-task-start', kind: 'sandbox', args: ['task', 'start', '--input', '-', '--risk', 'medium', '--owned', 'src/**'], stdin: JSON.stringify(ENVELOPE) },
  { id: 'sandbox-fast-status-window', kind: 'sandbox', args: ['fast', 'status', '--json'], setup: [['fast', 'on', '--minutes', '15', '--reason', 'golden-baseline']] },
  { id: 'sandbox-budget-dirty', kind: 'sandbox', args: ['budget', '--json'] },
  { id: 'sandbox-receipt-verify', kind: 'sandbox', args: ['receipt', 'verify', '--json'], setup: [['receipt', 'write', '--check', 'smoke', '--status', 'PASS', '--executor', 'implementer']] },
  { id: 'sandbox-sync-check', kind: 'sandbox', args: ['sync-check'] },
];

// ── 规范化遮罩 ────────────────────────────────────────────────────────────────
export function maskOutput(text, { tmp = null } = {}) {
  let out = String(text ?? '');
  if (tmp) out = out.split(tmp).join('<TMP>'); // tempdir 每次不同
  out = out
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, '<TS>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\b\d{10,13}\b/g, '<MS>')
    .replace(/\b\d+(?:\.\d+)?ms\b/gi, '<MS>')
    .replace(/\b[tw]-[0-9a-z]{6,12}\b/g, '<ID>')
    .replace(/\b(seq|throughSeq|receiptSeq)\b(\s*["']?\s*[:=]\s*["']?\s*)\d+/gi, '$1$2<SEQ>');
  // 64hex：键锚定的 diffHash/fingerprint 类刻意保留（先哨兵保护再通用遮罩，最后还原）。
  // evidenceHash/chainHash 不在保留名单——它们随运行内容变化，必须遮。
  const kept = [];
  out = out.replace(/((?:diffHash|fingerprint|canonicalDiff|reviewDiffHash)["']?\s*[:=]?\s*["']?)([0-9a-f]{64})/gi, (m, p1, hex) => {
    kept.push(hex);
    return `${p1}\u0000KEEP${kept.length - 1}\u0000`;
  });
  out = out.replace(/\b[0-9a-f]{64}\b/g, '<HASH>');
  out = out.replace(/\u0000KEEP(\d+)\u0000/g, (m, i) => kept[Number(i)]);
  return out;
}

// ── 沙箱与场景执行 ────────────────────────────────────────────────────────────
function mkSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-golden-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# golden sandbox\n');
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), `${JSON.stringify(SANDBOX_CATALOG, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  try { spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* git 缺失时 degraded 行为同样被记录 */ }
  return dir;
}

function zbaseRun(cwd, args, stdin = '') {
  const r = spawnSync(process.execPath, [ZBASE, ...args], { cwd, input: stdin || undefined, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, windowsHide: true });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// setup 条目：args 数组，末位若为以 { 开头的字符串则视为 stdin JSON（如 ['review','lens','correctness','{"findings":[]}']）
function splitStep(step) {
  const args = [...step];
  let stdin = '';
  const last = args[args.length - 1];
  if (typeof last === 'string' && last.startsWith('{')) stdin = args.pop();
  return { args: args.filter((a) => a !== null), stdin };
}

function runScenario(sc) {
  if (sc.kind !== 'sandbox') {
    const r = zbaseRun(ROOT, sc.args, sc.stdin);
    return { ...r, ctx: {} };
  }
  const dir = mkSandbox();
  try {
    for (const step of sc.setup || []) {
      const { args, stdin } = splitStep(step);
      const r = zbaseRun(dir, args, stdin);
      if (r.code !== 0) return { code: -1, stdout: '', stderr: `[golden] setup 失败（${args.join(' ')} exit ${r.code}）：${r.stderr.slice(0, 400)}`, ctx: { tmp: dir }, setupError: true };
    }
    const r = zbaseRun(dir, sc.args, sc.stdin);
    return { ...r, ctx: { tmp: dir } };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the OS reclaims */ }
  }
}

// ── record / check ───────────────────────────────────────────────────────────
// scenarios/baselineFile 参数化：生产路径走默认值（本仓场景表 + state 基线）；测试注入
// 小场景表与临时基线路径做隔离闭环（record→check→篡改→红→删条目→strict 报 missing）。
export function goldenRecord({ scenarios = SCENARIOS, baselineFile = BASELINE_FILE() } = {}) {
  const scenarios_out = {};
  const bad = [];
  for (const sc of scenarios) {
    const r = runScenario(sc);
    if (r.setupError) bad.push(`${sc.id}: ${r.stderr}`);
    scenarios_out[sc.id] = {
      kind: sc.kind,
      exitCode: r.code,
      stdout: maskOutput(r.stdout, r.ctx),
      stderr: maskOutput(r.stderr, r.ctx),
    };
  }
  if (bad.length) {
    // 场景表跑不通不许落假基线（record 是尺子的定标时刻——定标时就知道坏的尺子不如没有）
    return { ok: false, reason: '场景表存在 setup 失败，拒绝落基线（fail-visible）', failures: bad };
  }
  const baseline = { version: 1, recordedAt: new Date().toISOString(), scenarioCount: scenarios.length, scenarios: scenarios_out };
  const file = baselineFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(baseline, null, 2)}\n`);
  fs.renameSync(tmp, file);
  const bytes = fs.statSync(file).size;
  return {
    ok: true, recorded: scenarios.length, path: path.relative(ROOT, file), bytes,
    exitCodes: Object.fromEntries(Object.entries(scenarios_out).map(([id, v]) => [id, v.exitCode])),
  };
}

// 行级 diff（两侧行数组对齐比较；截 DIFF_LINE_CAP 行防输出爆炸）
const DIFF_LINE_CAP = 40;
function lineDiff(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  if (a.join('\n') === b.join('\n')) return [];
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < DIFF_LINE_CAP; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) out.push(`- ${a[i]}`);
      if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    }
  }
  return out;
}

export function goldenCheck({ strict = false, scenarios = SCENARIOS, baselineFile = BASELINE_FILE() } = {}) {
  const file = baselineFile;
  if (!fs.existsSync(file)) {
    return { ok: false, degraded: true, reason: '基线不存在：先 node .zcode/zbase.mjs golden record（基线是机器本地物，state 运行态不随 git——与 CI 判决分离）' };
  }
  let base;
  try { base = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    return { ok: false, degraded: true, reason: `基线损坏（${e.message}）——re-record 重建` };
  }
  const baseScenarios = base.scenarios || {};
  const baseIds = new Set(Object.keys(baseScenarios));
  const tableIds = new Set(scenarios.map((s) => s.id));
  // strict 双向校验（cc 修过尺子自身假绿：场景被删/新增都照报，交集比对会静默漏掉单侧漂移）
  const missingInBaseline = [...tableIds].filter((id) => !baseIds.has(id));
  const missingInTable = [...baseIds].filter((id) => !tableIds.has(id));

  const diffs = [];
  let compared = 0;
  for (const sc of scenarios) {
    const b = baseScenarios[sc.id];
    if (!b) continue;
    compared++;
    const r = runScenario(sc);
    const cur = { exitCode: r.code, stdout: maskOutput(r.stdout, r.ctx), stderr: maskOutput(r.stderr, r.ctx) };
    if (cur.exitCode !== b.exitCode || cur.stdout !== b.stdout || cur.stderr !== b.stderr) {
      diffs.push({
        id: sc.id,
        exitCode: { baseline: b.exitCode, current: cur.exitCode },
        stdoutDiff: lineDiff(b.stdout, cur.stdout),
        stderrDiff: lineDiff(b.stderr, cur.stderr),
        ...(r.setupError ? { setupError: true } : {}),
      });
    }
  }
  const strictFail = strict && (missingInBaseline.length > 0 || missingInTable.length > 0);
  const ok = diffs.length === 0 && !strictFail;
  return {
    ok, degraded: false, compared,
    diffCount: diffs.length,
    diffs: diffs.slice(0, 5),
    ...(strict ? { strict: true, missingInBaseline, missingInTable } : {}),
    ...(ok ? {} : { note: '行为漂移：先判断是预期演化（re-record）还是引擎回归（修）；recap/invariants 类场景对运行态敏感，progress/state 变化也会红——那是尺子的诚实不是误报' }),
  };
}
