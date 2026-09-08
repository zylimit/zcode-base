// golden：行为尺子（批次 6，源 cc 8af3e2c 模式）+ 变异击杀（R9 件3，dsh 形态）。
// 单测测函数；golden 测「CLI 的行为面」——对一组代表性 verb×参数组合记录 stdout/stderr/exit code
// 基线，引擎大改后 check 重跑比对。为下次引擎大改准备一把「无意行为漂移」的尺子。
// mutate 测「测试的击杀力」——对 8 个安全承重点注入突变，逐个验证有测试会红（击杀）。
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

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], business: 'b1 脊柱批冒烟：信封第 7 字段在场任务可建', escalation: '卡住交回' };
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

// ── mutate 变异击杀（R9 件3，dsh 形态）────────────────────────────────────────
// 突变表：每个 = {id, file(仓相对), anchor(唯一锚字符串), replacement, kill(击杀判据测试文件)}。
// 逐突变执行：锚在目标文件出现次数≠1 → 配置错误 exit 1 点名（防漂移锚——锚随代码演化失效要响亮报，
// 不是对着错误位置注入）；读原文内存备份 → 写入突变 → 跑指定测试（node --test）→ 非零退出=击杀
// → **无论成败都还原**（finally；还原后逐字节核对——还原失败比存活更响亮）。
// 未提交编辑的文件照常可测：还原目标 = 注入前读到的状态（注入前状态就是用户编辑态，
// 内存还原不等同丢弃用户编辑）。存活（测试全绿）= 该安全承重点无测试锚 → exit 1 点名。
//
// 取舍——不进 run-all/CI（dsh 留尺 vs cc 删套的综合）：golden 与 mutate 都是「测测试的元测试」；
// cc 的教训是把整个变异套件塞进每次提交门导致门太慢被整条删掉（尺子与门都要活）。mutate 单跑
// 数分钟且会短暂改写引擎源文件，属于人工触发的定期校准（dsh 形态：留下，但不挡日常道）——
// run-all/CI 跑 record/check 不跑 mutate，元测试不进发版链。

export const MUTATIONS = [
  {
    id: 'waiver-forbidden-words',
    file: '.zcode/lib/quality.mjs',
    anchor: 'privacy|pii|secret|credential|destructive',
    replacement: 'privacy|pii|destructive',
    kill: 'tests/batch12.test.mjs',
    note: '豁免禁词表删 secret/credential——带密钥词的豁免理由照过 = 三性红线放水',
  },
  {
    id: 'verify-fail-priority',
    file: '.zcode/lib/quality.mjs',
    anchor: "const hasFail = freshEvs.some((e) => e.status === 'FAIL');",
    replacement: "const hasFail = false && freshEvs.some((e) => e.status === 'FAIL');",
    kill: 'tests/harness.test.mjs',
    note: '聚合铁律 FAIL 优先被反转（新鲜 FAIL 不再覆盖早先 PASS）',
  },
  {
    id: 'range-vacuous-accept',
    file: '.zcode/lib/quality.mjs',
    anchor: '  if (base === head) {',
    replacement: '  if (false) { // mutant',
    kill: 'tests/batch7.test.mjs',
    note: 'core.mjs 无 EMPTY_DIFF 类哨兵常量（已核对）——按批次书 fallback：空 range（base==head vacuous）拒收判定改恒不拒',
  },
  {
    id: 'suppression-stale-always-pass',
    file: '.zcode/lib/scan.mjs',
    anchor: 'return suppressionWindowHash(lines, target) !== mk.hash;',
    replacement: 'return false; // mutant',
    kill: 'tests/batch11.test.mjs',
    note: '豁免窗口失配判定恒过——豁免被静默放宽（编辑后豁免不再失效）',
  },
  {
    id: 'floor-secret-read-removed',
    file: '.zcode/lib/tier.mjs',
    anchor: "'secret-read', 'secret-egress',",
    replacement: "'secret-egress',",
    kill: 'tests/batch10.test.mjs',
    note: 'FLOOR_RULES 删 secret-read——秘密读取变为可被档位静音的软规则',
  },
  {
    id: 'classifier-deny-downgrade',
    file: '.zcode/lib/classifier.mjs',
    anchor: "return deny('git-reset-hard', 'git reset --hard 可丢弃未提交工作');",
    replacement: "return { decision: 'ask', rule: 'git-reset-hard', reason: 'mutant' };",
    kill: 'tests/r6a.test.mjs',
    note: 'deny 档规则降 ask 档——向量契约（classifier lint）必须红',
  },
  {
    id: 'write-preflight-bypass',
    file: '.zcode/lib/hooks.mjs',
    anchor: "if (code === 'OUTSIDE_REPO' && !hasActiveTask) continue; // 无任务：仓外写放行（不进后续 ownedPaths 闸）",
    replacement: 'continue; // mutant: 一切不安全写路径（含 symlink 逃逸/仓外）静默放行',
    kill: 'tests/r3b.test.mjs',
    note: '写预检越界 deny 改放行（return 路径）——symlink 逃逸/仓外写不再拦',
  },
  {
    id: 'spec-business-anchor-loosened',
    file: '.zcode/lib/scan.mjs',
    anchor: 'const SPEC_BUSINESS_CTX_M = /^##\\s*业务上下文\\s*$/m;',
    replacement: 'const SPEC_BUSINESS_CTX_M = /^#{2,3}\\s*业务上下文\\s*$/m;',
    kill: 'tests/batch8.test.mjs',
    note: '锚正则放宽为前缀匹配——### 级子节顶替章节存在性检查',
  },
];

function runKillTest(killFile, root) {
  // 剥 NODE_TEST_CONTEXT：在测试进程内 spawn `node --test` 会继承该变量，被 Node 判为
  // 「递归运行测试」而跳过全部文件并 exit 0（假绿——杀不死的尺子比没有尺子更坏，R9 实测踩中）。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', path.join(root, killFile)], {
    cwd: root, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, windowsHide: true, env,
  });
  const tail = (text) => String(text ?? '').split('\n').filter(Boolean).slice(-6).join('\n').slice(0, 800);
  return { code: r.status, stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr) };
}

// root 参数化：生产走本仓 ROOT；测试注入沙箱仓副本（node --test 默认并行跑多个测试文件——
// 在真仓注入会让并发测试文件读到被突变的引擎，测的是互相污染不是击杀力）。
export function goldenMutate({ mutations = MUTATIONS, root = ROOT } = {}) {
  const results = [];
  let configError = null;
  let restoreError = null;
  for (const m of mutations) {
    const abs = path.join(root, m.file);
    const started = Date.now();
    let original = null;
    try {
      original = fs.readFileSync(abs, 'utf8');
      const occurrences = original.split(m.anchor).length - 1;
      if (occurrences !== 1) {
        // 漂移锚：代码演化让锚不再唯一/消失——对着错误位置注入比不注入更坏，响亮报配置错误
        configError = configError || { code: 'ANCHOR_NOT_UNIQUE', mutation: m.id, file: m.file, occurrences };
        results.push({ id: m.id, status: 'config-error', occurrences, ms: Date.now() - started });
        continue;
      }
      fs.writeFileSync(abs, original.replace(m.anchor, m.replacement));
      const kill = runKillTest(m.kill, root);
      results.push({
        id: m.id,
        status: kill.code !== 0 ? 'killed' : 'survived',
        killExit: kill.code,
        ms: Date.now() - started,
        ...(kill.code === 0 ? { killTail: kill.stdoutTail } : {}),
      });
    } catch (e) {
      results.push({ id: m.id, status: 'error', error: String(e?.message ?? e).slice(0, 200), ms: Date.now() - started });
    } finally {
      if (original !== null) {
        try {
          fs.writeFileSync(abs, original);
          const back = fs.readFileSync(abs, 'utf8');
          if (back !== original) restoreError = { code: 'RESTORE_MISMATCH', mutation: m.id, file: m.file };
        } catch (e) {
          restoreError = restoreError || { code: 'RESTORE_FAILED', mutation: m.id, file: m.file, error: String(e?.message ?? e).slice(0, 200) };
        }
      }
    }
  }
  const killed = results.filter((r) => r.status === 'killed').length;
  const survived = results.filter((r) => r.status === 'survived').map((r) => r.id);
  const errors = results.filter((r) => r.status === 'error');
  const ok = !configError && !restoreError && errors.length === 0 && survived.length === 0;
  return {
    ok,
    code: configError ? 'ANCHOR_NOT_UNIQUE' : restoreError ? restoreError.code : errors.length ? 'MUTATE_ERROR' : survived.length ? 'SURVIVED' : 'ALL_KILLED',
    mutations: results.length,
    killed,
    survived,
    results,
    totalMs: results.reduce((n, r) => n + (r.ms || 0), 0),
    ...(configError ? { configError } : {}),
    ...(restoreError ? { restoreError } : {}),
    ...(ok ? {} : { note: '存活=该安全承重点无击杀测试锚（补测试或确认锚）；config/restore error=先修尺子再谈击杀' }),
  };
}
