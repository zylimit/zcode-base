// quality：证据/计划/审查/任务面——quality（五性覆盖/门）+ receipts（哈希链账本/回执）+ tasks（任务信封/completion 门）
// + waivers（豁免契约）+ plan（verification plan 组队）+ budget（爆炸半径）+ review（结构化分歧审查引擎）+ audit（gate-log/死闸审计）。
// Task 8.10 模块界重组（dsh 界）：receipts/tasks/waivers/plan/budget/review/audit 旧文件现为 re-export shim；
// retention 的 rotateGateLog（gate-log 尺寸轮转）一并并入（audit/logGate 同居，避免 quality→context 反向边）。
// 依赖方向：core/graph/writes；被 scan/context/hooks/doctor 依赖。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ATTRIBUTES, BLOCKING_TIERS, appendLine, boundedHead, boundedTail, canonicalJson, changedPaths, DIRS, fastStatus, FILES, fingerprint, headCommit, isGitRepo, listPaths, loadHarnessConfig, loadState, nowIso, numstat, PROTECTED_ATTRS, readJson, readLines, redactSecrets, rel, ROOT, sha256, statusPaths, TIERS, updateState, whichCommand, withStateLock, writeJsonAtomic } from './core.mjs';
import { analyze, loadCatalog } from './graph.mjs';
import { fileDigest, pathOwned } from './writes.mjs';

// 组内别名（合并前是旧文件里的 `import {x as y}`；x 的定义现已并入本文件）：
const qualityVerify = verify;

// ══════════════════ 原 quality.mjs ═══════════════════

// quality：四态门 + 五性覆盖验证（反证优先）。
// v2.1：PROTECTED 扩三性（security/safety/privacy，唯一事实源 common.mjs）；
//      gate 执行器加 fast 贷款分支（allowFastSkip 预标记 + protected 永不跳 + windowId 留痕）；
//      verify 聚合判定——已执行的 FAIL 永不可被 fast 豁免（反证优先于一切 skip 判定）。
// v2.3（Task 8.3/8.4）：gate 按 verification plan 执法（采纳时：空计划/未组队拒绝；依赖未过/平台不符 BLOCKED；
//      resourceLocks 经 withStateLock 命名空间锁）；check 全量输出（脱敏+预算 200000 保尾）写独立 evidence 文件，
//      回执带 evidencePath/evidenceBytes/evidenceHash 三重句柄 + planHash（哈希链覆盖）。

// loadMatrix 迁至 plan.mjs（组队推导的事实源）；此处 re-export 保住既有导入面（fitness 等）。

// 八属性六档（Task 9.1）：词汇表统一到 core.mjs 单点（原本地五属性副本已删）。
// BLOCKING_TIERS={critical,high} 阻断档；minimal/none 的理由执法在 graph.lint（UNJUSTIFIED_TIER）。
const ATTRS = ATTRIBUTES;
const ENFORCE_LEVELS = [...BLOCKING_TIERS];
const EVIDENCE_CHARS = 200_000; // evidence 文件预算（boundedTail 保尾：错误信息在输出尾部）

// evidence 文件写入（原子）：.zcode/state/evidence/<task>/<check>-<ts>-<pid>.log。
// 文本先脱敏再截断（顺序不可反：截断后的 token 无法再被模式识别）。返回三重句柄（相对 ROOT 的 posix 路径 + 字节长 + sha256）。
function writeEvidenceFile(taskId, checkName, text) {
  const dir = path.join(DIRS.state, 'evidence', taskId || 'no-task');
  const file = path.join(dir, `${checkName}-${Date.now()}-${process.pid}.log`);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`);
  fs.renameSync(tmp, file);
  const buf = fs.readFileSync(file);
  return { path: rel(ROOT, file), bytes: buf.length, hash: sha256(buf) };
}

// resourceLocks → 状态目录命名空间锁（resource-locks/<name>）：并发 gate（hook 进程 + 主 Agent）不互踩。
// withStateLock(file) 实际锁文件为 <file>.lock；名内非法字符归一为 _。
function withResourceLocks(names, fn) {
  const sorted = [...new Set(names)].sort();
  if (!sorted.length) return fn();
  const lockBase = path.join(DIRS.state, 'resource-locks', sorted[0].replace(/[^A-Za-z0-9_.-]/g, '_'));
  return withStateLock(lockBase, () => withResourceLocks(sorted.slice(1), fn));
}

// gate <check>：执行 verification-matrix 中声明的检查命令，四态落账。
// Fast Mode 贷款：检查声明 allowFastSkip:true 且不证明红线三性且 fast 窗口开启 → 不执行，
// 直接落 SKIPPED 回执（reason=fast-mode，带 fastModeWindow）——只有同窗口的 SKIPPED 有效，债务由 task finish/risk scan 收口。
// v2.3：plan 采纳时执法组队（空计划=配置失败不是绿灯；未组队检查拒绝跑）；依赖未过/平台不符 → BLOCKED 落账。
export function runGate(checkName, { note, executor } = {}) {
  const matrix = loadMatrix();
  const check = matrix.checks.find((c) => c.name === checkName);
  if (!check) return { ok: false, reason: `verification-matrix 中无检查：${checkName}` };
  if (!check.command) return { ok: false, reason: `检查 ${checkName} 未声明 command（人工/外部检查，走 receipt write）` };
  const provesProtected = (check.proves || []).some((a) => PROTECTED_ATTRS.includes(a));
  if (provesProtected && check.allowFastSkip) {
    return { ok: false, reason: `红线：${check.proves.filter((a) => PROTECTED_ATTRS.includes(a)).join('/')} 检查不可声明 allowFastSkip（PROTECTED_FAST_SKIP）` };
  }

  // plan 执法（仅采纳时；未采纳 → 传统模式，零迁移成本）
  let plan = null;
  if (loadState().activeTask) {
    const p = verificationPlan();
    if (!p.ok && p.code?.startsWith('MATRIX_')) {
      return { ok: false, reason: `verification plan 无效（${p.code}）：${p.message}——先修 matrix 再跑 gate（fail-visible）` };
    }
    if (p.ok) {
      plan = p;
      if (p.empty) {
        return { ok: false, reason: 'EMPTY_PLAN：当前任务组队出空 verification plan——空计划是配置失败不是绿灯（补 matrix.riskChecks 或 catalog module.verification；node .zcode/zbase.mjs plan 查看）' };
      }
      if (!p.checks.some((c) => c.name === checkName)) {
        return { ok: false, reason: `CHECK_NOT_PLANNED：检查 ${checkName} 不在当前任务的 verification plan 组队内（node .zcode/zbase.mjs plan 查看 reasons）——跑未组队检查不经派单推导` };
      }
    }
  }
  const planHash = plan ? plan.planHash : undefined;
  const taskId = loadState().activeTask?.id || null;
  const fast = fastStatus();

  // 依赖门：依赖的最新新鲜回执非 PASS（fast 窗口内同 windowId 的 SKIPPED 可作满足——债务由 task finish 收口）
  const deps = check.dependencies || [];
  const depNotPassed = (() => {
    if (!deps.length) return [];
    const fresh = latestReceipts({ fresh: true }); // 一次取齐，不在 filter 内重复读账本
    return deps.filter((d) => {
      const r = fresh.get(d);
      if (!r) return true;
      if (r.content.status === 'PASS') return false;
      if (r.content.status === 'SKIPPED' && r.content.fastModeWindow && fast.enabled && r.content.fastModeWindow === fast.windowId) return false;
      return true;
    });
  })();
  const blockedReceipt = (status, text) => {
    const ev = writeEvidenceFile(taskId, checkName, text);
    const receipt = writeReceipt({ check: checkName, status, note: text, planHash, evidenceFile: ev, executor });
    return { ok: false, status, reason: text, receiptSeq: receipt.seq, evidencePath: ev.path };
  };
  if (depNotPassed.length) {
    return blockedReceipt('BLOCKED', `dependency did not pass: ${depNotPassed.join(', ')}（依赖的最新新鲜回执非 PASS——先跑依赖）`);
  }
  // 平台门：声明 platform 且与当前平台不符 → BLOCKED（不是 FAIL：环境不满足≠检查失败）
  if (check.platform && check.platform !== 'any' && check.platform !== process.platform) {
    return blockedReceipt('BLOCKED', `platform ${process.platform} is not supported（检查声明 platform=${check.platform}）`);
  }

  if (fast.enabled && check.allowFastSkip === true && !provesProtected) {
    const ev = writeEvidenceFile(taskId, checkName, 'fast-mode skip（证据贷款：窗口内未执行，task finish 前须补验）');
    const receipt = writeReceipt({ check: checkName, status: 'SKIPPED', note: 'fast-mode', fastModeWindow: fast.windowId, planHash, evidenceFile: ev, executor });
    return {
      ok: true, status: 'SKIPPED', skippedByFast: true, fastModeWindow: fast.windowId,
      until: fast.until, receiptSeq: receipt.seq, note: `Fast Mode 窗口内跳过（windowId ${fast.windowId}，until ${fast.until}）：证据贷款，task finish 前须补验`,
    };
  }
  let status = 'BLOCKED', out = '', code = null;
  try {
    out = withResourceLocks(check.resourceLocks || [], () =>
      execFileSync(check.shell || 'bash', ['-c', check.command], { encoding: 'utf8', timeout: check.timeoutMs || 300_000, maxBuffer: 64 * 1024 * 1024 }));
    status = 'PASS'; code = 0;
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
    // Task 9.1（adapters 契约）：可执行缺失（shell 127 command not found / spawn ENOENT）= BLOCKED 永不 PASS——
    // 「缺工具是 BLOCKED 不是 PASS」（invariants #2）；环境不满足≠检查失败。class:runtime 的结果另按时间窗理解（verify 侧）。
    const missing = code === 127 || e.code === 'ENOENT' || /command not found/i.test(String(e.message || ''));
    status = (e.killed || missing) ? 'BLOCKED' : 'FAIL';
    if (missing) out += `\n[zbase] 可执行缺失（exit ${code}）：检查声明的外部工具不在 PATH——BLOCKED 永不 PASS（adapters install 链接见 .zcode/harness/adapters.json）`;
  }
  // evidence 三重句柄：全量输出（脱敏+200000 保尾）独立落盘；note 仍存摘要（模型可见面）
  const ev = writeEvidenceFile(taskId, checkName, boundedTail(out, EVIDENCE_CHARS) || `exit ${code}`);
  const receipt = writeReceipt({ check: checkName, status, note: note || (out ? boundedTail(out, 2000) : `exit ${code}`), planHash, evidenceFile: ev, executor });
  return { ok: status === 'PASS', status, exitCode: code, outputTail: boundedTail(out, 2000), receiptSeq: receipt.seq, evidencePath: ev.path, planHash: planHash ?? null };
}

// coverage status：每模块八属性档位 → 认领检查 → 最新回执状态（全量视角，不筛新鲜）。
export function coverageStatus() {
  const catalog = loadCatalog();
  const matrix = loadMatrix();
  const receipts = latestReceipts({ fresh: false });
  const rows = [];
  if (!catalog) return rows;
  for (const m of catalog.modules || []) {
    for (const attr of ATTRS) {
      const level = m.attributes?.[attr] || 'none';
      if (level === 'none') continue;
      const claimChecks = matrix.checks.filter((c) => (c.proves || []).includes(attr) && (!c.scope || c.scope.length === 0 || c.scope.includes(m.name)));
      const latest = claimChecks.map((c) => receipts.get(c.name)).filter(Boolean).pop() || null;
      rows.push({ module: m.name, attribute: attr, level, claimedBy: claimChecks.map((c) => c.name), latestStatus: latest ? latest.content.status : null, latestTs: latest ? latest.content.ts : null });
    }
  }
  return rows;
}

function loadAllReceipts() {
  if (!fs.existsSync(FILES.ledger)) return [];
  return readLines(FILES.ledger).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ── runtime 类检查的时间窗绑定（Task 9.1，源 cursor #5）──────────────────────────
// check 声明 runtimeValidityHours（正数，小时；class:'runtime' 未声明时默认 24h）时，
// 回执按「ts 距今 < N 小时」判定有效，binding 标注 time-window-<n>h——
// 负载测试/SLO 探针度量的是部署物，diff hash 描述不了它：时间窗证据永不冒充工作树证据
// （never mistaken for evidence about the code currently in the working tree）。
export function runtimeHoursOf(check) {
  const v = Number(check?.runtimeValidityHours);
  if (Number.isFinite(v) && v > 0) return v;
  return check?.class === 'runtime' ? 24 : null;
}

// 单条回执与本树/时间窗的匹配判定：diff 指纹命中 → binding 'diff'；
// 指纹过期但 runtime 时间窗内 → binding 'time-window-<n>h'；都不中 → 不匹配。
export function receiptBinding(check, content, currentFingerprint) {
  if (content.fingerprint === currentFingerprint) return { matched: true, binding: 'diff' };
  const hours = runtimeHoursOf(check);
  if (hours !== null) {
    const ts = new Date(content.ts || 0).getTime();
    if (Number.isFinite(ts) && ts > 0 && Date.now() - ts < hours * 3600_000) {
      return { matched: true, binding: `time-window-${hours}h` };
    }
  }
  return { matched: false, binding: null };
}

// verify：反证优先。
// 规则：同属性存在新鲜 FAIL = uncovered（FAIL 覆盖早先 PASS 的证明力，也覆盖一切 SKIPPED——
//       已执行出的 FAIL 永不可被 fast 豁免，fast 只允许跳过「未运行」）；
// BLOCKED 不算覆盖；waiver SKIPPED 需有效豁免；fast SKIPPED 需同 windowId 且 check 声明 allowFastSkip；
// critical/high 未覆盖 → 阻断。security/safety/privacy 红线三性无豁免通道且永不可 Fast 跳过。
export function verify() {
  const fast = fastStatus();
  const rows = coverageStatus();
  const ver = verifyLedger();
  if (!ver.ok) {
    return { ok: false, code: 'LEDGER_BROKEN', issues: ver.issues.slice(0, 5), uncovered: [], blocking: [], covered: 0, note: '账本断链：先修复证据体系再谈覆盖' };
  }
  const matrix = loadMatrix();

  // v2.3（Task 8.3）：活跃任务的 verification plan 消费——
  // 空计划是配置失败不是绿灯（critical 阻断）；matrix 结构无效（环/未知引用）fail-visible 拒判。
  const state = loadState();
  const activeTask = state.tasks.find((t) => t.id === state.activeTask?.id) || null;
  let plan = null;
  if (activeTask) {
    const p = verificationPlan({ task: activeTask });
    if (!p.ok && p.code?.startsWith('MATRIX_')) {
      return { ok: false, code: 'PLAN_INVALID', issues: [{ code: p.code, message: p.message }], uncovered: [], blocking: [], covered: 0, plan: null, note: 'verification plan 无效（matrix 配置错误）：先修 matrix 再谈覆盖' };
    }
    plan = p.ok ? p : null;
  }

  const allowFastSkipChecks = new Set(matrix.checks.filter((c) => c.allowFastSkip === true).map((c) => c.name));
  const allReceipts = loadAllReceipts();
  const byCheck = new Map();
  for (const e of allReceipts) {
    if (!byCheck.has(e.content.check)) byCheck.set(e.content.check, []);
    byCheck.get(e.content.check).push(e);
  }

  const uncovered = [], skippedByFast = [];
  const timeWindowCovered = [];
  let covered = 0;
  // 空计划阻断：uncovered 行带 critical 档 → 进 blocking（task finish 消费同一判定）
  if (plan && plan.empty) {
    uncovered.push({
      module: 'verification-plan', attribute: 'reliability', level: 'critical',
      claimedBy: [], latestStatus: null, latestTs: null,
      reason: 'EMPTY_PLAN：任务组队出空 verification plan——空计划是配置失败不是绿灯（补 matrix.riskChecks 或 catalog module.verification）',
    });
  }
  for (const row of rows) {
    const evs = [];
    for (const cn of row.claimedBy) {
      const check = matrix.checks.find((c) => c.name === cn);
      const scope = check?.scope || [];
      for (const e of byCheck.get(cn) || []) {
        if (scope.length && !scope.includes(row.module)) continue;
        // 绑定判定：diff 指纹或 runtime 时间窗（Task 9.1）——time-window 证据度量部署物而非工作树
        const b = receiptBinding(check, e.content, ver.currentFingerprint);
        evs.push({
          status: e.content.status,
          fresh: b.matched,
          binding: b.binding,
          waived: covers(cn, row.attribute),
          fastModeWindow: e.content.fastModeWindow || null,
          allowFastSkip: allowFastSkipChecks.has(cn),
        });
      }
    }
    const freshEvs = evs.filter((e) => e.fresh);
    const hasFail = freshEvs.some((e) => e.status === 'FAIL');
    const hasPass = freshEvs.some((e) => e.status === 'PASS');
    const allBlocked = freshEvs.length > 0 && freshEvs.every((e) => e.status === 'BLOCKED');
    const isProtected = PROTECTED_ATTRS.includes(row.attribute);
    const waivedSkip = !isProtected && evs.some((e) => e.status === 'SKIPPED' && e.waived);
    // fast skip 有效条件：窗口开着 + 回执带同一 windowId + 该 check 声明 allowFastSkip + **仅 medium/low 档**
    // （critical/high 档检查未跑=BLOCKED 语义，即便声明 allowFastSkip 也不跳——对齐 rules/quality-attributes.md「可跳：medium/low 档」）
    const fastSkipValid = !isProtected && !ENFORCE_LEVELS.includes(row.level) && fast.enabled && fast.windowId && evs.some((e) =>
      e.status === 'SKIPPED' && e.fresh && e.fastModeWindow === fast.windowId && e.allowFastSkip);

    if (hasFail) uncovered.push({ ...row, reason: '反证：存在同属性新鲜 FAIL 回执（已执行的 FAIL 不可被 fast/waiver 豁免）' });
    else if (hasPass) {
      covered++;
      const tw = [...new Set(freshEvs.filter((e) => e.binding && e.binding.startsWith('time-window-')).map((e) => e.binding))];
      if (tw.length) {
        timeWindowCovered.push({ module: row.module, attribute: row.attribute, level: row.level, claimedBy: row.claimedBy, binding: tw.join(',') });
      }
    }
    else if (waivedSkip) covered++;
    else if (allBlocked) uncovered.push({ ...row, reason: 'BLOCKED 不算覆盖' });
    else if (ENFORCE_LEVELS.includes(row.level)) {
      // critical/high：fast 窗口的 SKIPPED 不算覆盖（未跑=BLOCKED）——fast 只对 medium/low 放行，且债务由 task finish 收口
      const fastSkipped = freshEvs.some((e) => e.status === 'SKIPPED' && e.fastModeWindow);
      const runtimeClaim = row.claimedBy.some((cn) => runtimeHoursOf(matrix.checks.find((c) => c.name === cn)) !== null);
      uncovered.push({
        ...row,
        reason: isProtected
          ? `${row.attribute} 红线：critical/high 必须有新鲜 PASS 回执（不可豁免、不可 Fast 跳过）`
          : fastSkipped
            ? `${row.attribute}（${row.level} 档）在 fast 窗口被跳过：critical/high 检查未跑=BLOCKED，SKIPPED 不算覆盖——重跑偿贷或降档须走档位变更`
            : runtimeClaim
              ? '无新鲜认领检查回执（认领检查含 runtime 时间窗类：时间窗已过期或从未跑过——重跑，其证据度量部署物不随 diff 失效）'
              : '无新鲜认领检查回执',
      });
    }
    // 低档位（medium/low）无回执：不阻断，建议补齐（也计入 uncovered 供展示）
    else if (fastSkipValid) skippedByFast.push({ ...row, windowId: fast.windowId });
    else if (freshEvs.some((e) => e.status === 'SKIPPED')) {
      uncovered.push({ ...row, reason: 'SKIPPED 回执无效（fast 窗口已关闭或 windowId 不匹配或 check 未声明 allowFastSkip）' });
    } else uncovered.push({ ...row, reason: '低档位无回执（不阻断，建议补齐）' });
  }
  const blocking = uncovered.filter((r) => ENFORCE_LEVELS.includes(r.level));
  return {
    ok: blocking.length === 0,
    blocking,
    uncovered: uncovered.filter((r) => !ENFORCE_LEVELS.includes(r.level)),
    covered,
    skippedByFast,
    // runtime 时间窗覆盖明细（Task 9.1）：binding=time-window-<n>h 的行——度量部署物，
    // never mistaken for working-tree evidence；窗口过后自动回落 uncovered。
    timeWindowCovered,
    staleEvidence: ver.staleCount,
    plan: plan ? { taskId: plan.taskId, empty: plan.empty, planHash: plan.planHash } : null,
    checkedAt: nowIso(),
  };
}

// completionStatus 完成门聚合（Task 8.6，codex 1.11/1.12）：
// 「完成」不是 --force 就能过——四项联合判定（属性覆盖与账本链由 task finish 侧
// qualityVerify/verifyLedger 承担，此处补齐检查面与审查面）：
//   ① required（plan 组队）检查逐项可接受：新鲜 PASS / 同窗口有效 fast SKIPPED / 未过期 waiver；
//      planHash 消费（R4b 留口）：回执 planHash≠当前 plan → 计划已变，旧回执需重验；
//      executor 绑定：risk=high 且无 fast 时 required 回执 executorRole!=='tester' 不可接受
//      （宪法纪律 4：写测者≠被测作者——主 Agent 顺手自测自过被机器拒绝）。
//   ② optional（组队外）检查已执行出 FAIL 同样阻断：「已执行的失败永不可接受」——
//      可选失败与门静默唱反调是已知失败模式（cursor 3.1 吸收）。
//   ③ review 门：catalog.review.requireForFinish 采纳且 risk∈{medium,high} 且无 fast 时
//      要求 review 回执——验证链 + scope 与 task ownedPaths 排序比对（scopeMatches，
//      审查范围过期不算）+ ACCEPT + 无未解 error。采纳开关沿用 R4b PLAN_NOT_ADOPTED
//      兼容哲学：不声明则不启用，既有项目零迁移（宪法 red-blue 路由为条件触发，非全量强制）。
// task finish 消费本函数 blockers；fast DEBT 阻断与属性反证门不变（语义正交叠加）。
export function completionStatus(task) {
  const fast = fastStatus();
  const matrix = loadMatrix();
  const catalog = loadCatalog();

  // plan（采纳时）：MATRIX_* 无效 fail-visible 拒判（与 verify 同一姿态）
  let plan = null;
  const p = verificationPlan({ task });
  if (p.ok) plan = p;
  else if (p.code?.startsWith('MATRIX_')) {
    return { ok: false, blockers: [`PLAN_INVALID（${p.code}）：${p.message}——先修 matrix 再谈完成`], checks: [], review: null, plan: null };
  }

  const fresh = latestReceipts({ fresh: true });
  const planNames = new Set(plan ? plan.checks.map((c) => c.name) : []);
  const byCheckName = new Map(matrix.checks.map((c) => [c.name, c]));
  const checks = [];

  // ① required：plan 组队检查逐项
  if (plan && !plan.empty) {
    for (const c of plan.checks) {
      const r = fresh.get(c.name);
      let acceptable = false;
      let reason = 'missing receipt：无新鲜回执';
      if (r) {
        const content = r.content;
        // planHash 消费：计划选择变化后，旧回执绑的是旧计划（R4b 留口在此闭合）
        if (content.planHash !== plan.planHash) {
          reason = content.planHash ? 'planHash mismatch：计划在回执之后变化——旧回执按旧计划跑，需重验' : '回执无 planHash：plan 采纳后 required 检查须经 gate 落账（手动 receipt write 不携带计划绑定）';
        } else if (content.status === 'PASS') {
          acceptable = true; reason = 'fresh PASS';
        } else if (content.status === 'SKIPPED' && fast.enabled && content.fastModeWindow === fast.windowId && byCheckName.get(c.name)?.allowFastSkip === true) {
          acceptable = true; reason = 'fast 窗口内有效 SKIPPED（证据贷款）';
        } else {
          reason = `最新新鲜回执为 ${content.status}`;
        }
        // executor 绑定：高风险检查须 tester 执行的新鲜回执
        if (acceptable && task.risk === 'high' && !fast.enabled && content.executorRole !== 'tester') {
          acceptable = false;
          reason = `高风险检查需 tester 执行的新鲜回执（宪法纪律 4：写测者≠被测作者）；本回执 executorRole=${content.executorRole || '未声明'}——由 tester 子代理重跑（gate ${c.name} --executor tester）`;
        }
      } else if (covers(c.name)) {
        acceptable = true; reason = '未过期 waiver';
      }
      checks.push({ check: c.name, acceptable, reason });
    }
  }

  // ② optional FAIL 阻断：组队外检查在本任务名下已执行出新鲜 FAIL——执行过的失败没有可接受通道
  const taskReceipts = readLines(FILES.ledger)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter((e) => e.content.task === task.id && e.content.status === 'FAIL');
  const currentFp = fingerprint().fingerprint;
  for (const e of taskReceipts) {
    if (planNames.has(e.content.check)) continue; // required 面：①已按最新回执判定
    if (e.content.fingerprint !== currentFp) continue; // 只看当前指纹（新鲜性）
    checks.push({
      check: e.content.check, acceptable: false,
      reason: 'optional planned check FAIL：已执行的失败永不可接受（可选检查跑失败与门静默唱反调是已知失败模式）',
    });
  }

  // ③ review 门（采纳开关：catalog.review.requireForFinish===true）
  let review = { required: false, acceptable: true, reason: 'not required（未启用 requireForFinish 或风险档/窗口不适用）' };
  if (catalog?.review?.requireForFinish === true && ['medium', 'high'].includes(task.risk) && !fast.enabled) {
    review = { required: true, acceptable: false, reason: 'missing review receipt：无新鲜结构化审查回执（review start → blue → lens → verdict）' };
    const r = fresh.get('review');
    if (r && r.content.reviewVerdict) {
      const ok = r.content.reviewVerdict === 'ACCEPT';
      const scope = scopeMatches(r.content.reviewScope, task.ownedPaths);
      const noErrors = (r.content.reviewErrorCount ?? 0) === 0;
      review = {
        required: true,
        acceptable: ok && scope && noErrors,
        reason: !ok ? `review 回执裁定为 ${r.content.reviewVerdict}（仅 ACCEPT 可关闭任务）`
          : !scope ? 'review scope 与任务 ownedPaths 不匹配：审查范围过期不算——审的必须就是这个任务的这些路径（重开 review start）'
          : !noErrors ? 'review 回执存在未解 error'
          : 'fresh ACCEPT review（scope 匹配任务 ownedPaths，无未解 error）',
        receiptSeq: r.seq,
      };
    }
  }

  const blockers = [
    ...checks.filter((c) => !c.acceptable).map((c) => `${c.check}: ${c.reason}`),
    ...(review.required && !review.acceptable ? [`review: ${review.reason}`] : []),
  ];
  return {
    ok: blockers.length === 0,
    blockers,
    checks,
    review,
    plan: plan ? { taskId: plan.taskId, planHash: plan.planHash, empty: plan.empty } : null,
  };
}


// ══════════════════ 原 receipts.mjs ═══════════════════

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

const ANCHOR_FILE = path.join(DIRS.state, 'ledger.anchor.json');
const EVIDENCE_ROOT = () => path.join(DIRS.state, 'evidence');

// executor 角色绑定（Task 8.6，codex 1.12）：回执记 executorRole（谁执行的检查），
// completion 门校验高风险检查的 executorRole==='tester'——把宪法纪律 4（写测者≠被测作者）
// 从纯 prompt 变成机器拒绝。role 格式：^[a-z][a-z0-9-]{0,31}$。
const EXECUTOR_ROLE_RE = /^[a-z][a-z0-9-]{0,31}$/;

export function writeReceipt({ check, status, task, evidence = [], note, fingerprint: fp, fastModeWindow, planHash, evidenceFile, executor, extra }) {
  if (!['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(status)) throw new Error(`非法状态：${status}`);
  if (executor !== undefined && executor !== null && !EXECUTOR_ROLE_RE.test(String(executor))) {
    throw new Error(`非法 executor 角色：${executor}（须匹配 ^[a-z][a-z0-9-]{0,31}$）`);
  }
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
  // executor 角色（Task 8.6）：谁执行的检查——高风险 required 回执须 tester 执行（completion 门校验）
  if (executor) content.executorRole = String(executor);
  // 扩展字段（Task 8.5）：review 回执的 reviewVerdict/reviewScope/lenses 等——随 content 进哈希链（链无缝）
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(content, extra);
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
  // evidence 钉 supersede（后写覆盖先写）：同一路径只按最新（最高 seq）钉它的回执复验——
  // 与 latestReceipts 的「后到覆盖先到」同哲学：可变源文件被钉后合法演进、由更高 seq 再钉新 sha，
  // 旧钉即免责（否则每次演进都留一颗永久 EVIDENCE_TAMPERED 时间炸弹）。坏行留给主循环报 MALFORMED_LINE，此处安全跳过。
  const latestSeqByPath = new Map();
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    for (const ev of e.content?.evidence || []) {
      if (ev?.sha256 == null) continue;
      latestSeqByPath.set(ev.path, e.seq); // 行序即 seq 序，后 set 覆盖先 set → 每路径留最高 seq
    }
  }
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { issues.push({ seq: expectedSeq, code: 'MALFORMED_LINE' }); break; }
    if (entry.seq !== expectedSeq) issues.push({ seq: entry.seq, code: 'SEQ_GAP', expected: expectedSeq });
    const recomputed = sha256(prev + '\n' + canonicalJson(entry.content));
    if (recomputed !== entry.chainHash) issues.push({ seq: entry.seq, code: 'CHAIN_BROKEN' });
    // 证据文件重哈希（在盘时）——只验最新钉：旧钉已被更高 seq 的再钉 supersede，不再担责
    for (const ev of entry.content.evidence || []) {
      if (ev.sha256 == null) continue;
      if (latestSeqByPath.get(ev.path) !== entry.seq) continue;
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
  // 坏行在上方循环已计 MALFORMED_LINE；此处二次解析必须容错——账本被篡改（含尾截半写）只能 exit 4（TAMPERED），
  // 崩成 exit 1 等于把「校验失败」伪装成「引擎错误」，违反退出码契约（Task 8.10 对抗性用例锁死）。
  const parseSafe = (l) => { try { return JSON.parse(l); } catch { return null; } };
  const receipts = taskId
    ? lines.map(parseSafe).filter((e) => e && e.content.task === taskId)
    : lines.map(parseSafe).filter(Boolean);
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


// ══════════════════ 原 tasks.mjs ═══════════════════

// 任务生命周期：start（envelope+risk+ownedPaths+fingerprint 绑定）/ status / finish（质量门收口）。
// v2.1：状态写入走 updateState（跨进程锁内读-改-写）；finish 加 fast 贷款阻断——证据贷款不能关闭任务。
// v2.2（Task 7.6）：start 对 owned+tracked+dirty 路径逐文件 digest 建 knownHashes 基线（含 preexistingDirty 标记，
// 候选过滤到信封 ownedPaths 内——并发检测只对任务可能写的路径有意义，全仓 digest 在大仓不可行，同 codex baselineHashes）；
// refreshTask 供 PostToolUse 在成功写后更新基线与 touchedPaths（自己写的样子=新基线，他人的改动才叫冲突）。

const ENVELOPE_FIELDS = ['goal', 'scope', 'outOfScope', 'existingPattern', 'verification', 'escalation'];

// 基线候选：ownedPaths ∪ tracked ∪ dirty（staged+unstaged+untracked），过滤到信封内 —— IO 重活，锁外完成。
function baselineHashes(ownedPaths) {
  const dirty = statusPaths();
  const tracked = listPaths();
  const candidates = [...new Set([...ownedPaths, ...tracked, ...dirty.staged, ...dirty.unstaged, ...dirty.untracked])]
    .filter((p) => pathOwned(ownedPaths, p));
  const knownHashes = {};
  for (const rel of candidates) knownHashes[rel] = fileDigest(path.join(ROOT, rel));
  return { knownHashes, preexistingDirty: [...new Set([...dirty.staged, ...dirty.unstaged, ...dirty.untracked])] };
}

export function start({ envelope, risk = 'medium', ownedPaths = [], refs = {}, reviewExclusions = [] }) {
  if (loadState().activeTask) return { ok: false, reason: '已有活跃任务，先 finish 或显式放弃' };
  const missing = ENVELOPE_FIELDS.filter((f) => !envelope[f]);
  if (missing.length) return { ok: false, reason: `派单信封缺字段：${missing.join(', ')}` };
  const fp = fingerprint(); // 重计算在锁外
  const baseline = baselineHashes(ownedPaths); // digest 重活同样锁外
  let conflict = null;
  const res = updateState((state) => {
    if (state.activeTask) { conflict = state.activeTask.id; return state; } // 并发兜底：另一进程已开任务
    const task = {
      id: `t-${Date.now().toString(36)}`,
      startedAt: nowIso(),
      envelope,
      risk,
      ownedPaths,
      refs,
      reviewExclusions,
      baseline: { ...fp, knownHashes: baseline.knownHashes, preexistingDirty: baseline.preexistingDirty },
      touchedPaths: [],
    };
    state.activeTask = { id: task.id, startedAt: task.startedAt };
    state.tasks.push(task);
    return state;
  });
  if (conflict) return { ok: false, reason: `已有活跃任务 ${conflict}，先 finish 或显式放弃` };
  const active = res.tasks.find((t) => t.id === res.activeTask?.id);
  if (!active) return { ok: false, reason: '任务创建失败（状态异常）' };
  return { ok: true, task: active };
}

// 成功写后刷新：把已写路径的当前 digest 并入基线（下次写前比对的是「自己上一次写的样子」）+ 记 touchedPaths。
export function refreshTask(relPaths) {
  const digests = {};
  for (const rel of relPaths) digests[rel] = fileDigest(path.join(ROOT, rel)); // 锁外 IO
  const next = updateState((s) => {
    const t = s.tasks.find((x) => x.id === s.activeTask?.id);
    if (!t) return s;
    t.touchedPaths = [...new Set([...(t.touchedPaths || []), ...relPaths])].sort();
    t.baseline = { ...(t.baseline || {}), knownHashes: { ...(t.baseline?.knownHashes || {}), ...digests } };
    return s;
  });
  return { ok: true, refreshed: relPaths };
}

export function status() {
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id) || null;
  const fp = fingerprint();
  return {
    active: active ? { ...active, baselineDrift: active.baseline.fingerprint !== fp.fingerprint } : null,
    total: state.tasks.length,
    fast: fastStatus(state),
    stopStrikes: state.stopStrikes || null,
    degraded: state.degraded || [],
  };
}

export function finish({ force = false } = {}) {
  const state = loadState();
  const active = state.tasks.find((t) => t.id === state.activeTask?.id);
  if (!active) return { ok: false, reason: '无活跃任务' };
  const qv = qualityVerify();
  const lv = verifyLedger({ task: active.id });
  const blockers = [];
  if (!qv.ok) blockers.push(...qv.blocking.map((b) => `${b.module}.${b.attribute}: ${b.reason}`));
  if (!lv.ok) blockers.push(`账本断链：${lv.issues.slice(0, 3).map((i) => i.code).join(',')}`);
  // fast 贷款债务：本任务名下存在新鲜 fast-SKIPPED 回执 → 证据贷款不能关闭任务
  const debt = fastDebtReceipts({ task: active.id });
  const debtChecks = [...new Set(debt.map((e) => e.content.check))];
  if (debtChecks.length) {
    blockers.push(`证据贷款不能关闭任务：fast 窗口跳过了 ${debtChecks.join(', ')}——补跑偿贷，或 --force 强收（留痕为 forced）`);
  }
  // completion 完成门聚合（Task 8.6）：required 检查可接受性（planHash/executor 绑定）+
  // optional 已执行 FAIL 阻断 + review 门（requireForFinish 采纳且 risk∈{medium,high} 无 fast）
  const completion = completionStatus(active);
  if (!completion.ok) blockers.push(...completion.blockers);
  if (blockers.length && !force) {
    return { ok: false, blockers, completion, note: '用 --force 显式强收（留痕为 forced）' };
  }
  const finished = nowIso();
  updateState((s) => {
    const t = s.tasks.find((x) => x.id === active.id);
    if (!t) return s;
    t.finishedAt = finished;
    t.forced = force && blockers.length > 0;
    t.finishBlockers = blockers;
    s.activeTask = null;
    return s;
  });
  return { ok: true, task: active.id, forced: force && blockers.length > 0, skippedBlockers: blockers };
}


// ══════════════════ 原 waivers.mjs ═══════════════════

// 豁免管理：五要素强制 + security/safety/privacy 红线三性 + FAIL 永不可豁免 + 到期自动失效。

const REQUIRED = ['approver', 'expiry', 'compensation', 'followUp', 'binding'];
// 红线词汇表：reason 命中即拒——豁免文本里出现这些词说明豁免的对象本身就是不可豁免的。
// （zcode waiver 无独立 scope 字段，check 名与 reason 一并校验。）
const WAIVER_FORBIDDEN_WORDS = /(safety|security|privacy|pii|secret|credential|destructive|deploy|production|push|隐私|安全|密钥|凭据|生产|部署)/i;

function load() {
  if (!fs.existsSync(FILES.waivers)) return [];
  return readJson(FILES.waivers);
}

export function addWaiver({ check, attribute, reason, approver, expiry, compensation, followUp, approval }) {
  const waivers = load().filter(isActive);
  const missing = REQUIRED.filter((k) => !({ approver, expiry, compensation, followUp, binding: true }[k]));
  if (missing.length) throw new Error(`豁免缺五要素：${missing.join(', ')}`);
  if (attribute && PROTECTED_ATTRS.includes(attribute)) {
    throw new Error(`红线：${attribute} 永不可豁免`);
  }
  const text = `${reason || ''} ${check || ''}`;
  if (WAIVER_FORBIDDEN_WORDS.test(text)) {
    throw new Error(`红线：豁免理由/check 命中不可豁免词汇（privacy/security/safety/secret 等）——三性豁免在结构上无可表达之例外`);
  }
  const entry = {
    id: `w-${Date.now().toString(36)}`,
    check, attribute: attribute || null, reason,
    approver, expiry, compensation, followUp,
    // Approval（Task 8.6，cursor 13）：审批发生处（message/review/ticket 引用）——
    // 审计记录而非身份证明；让豁免从「带过期的借条」变成「带审计链的借条」。可选字段。
    approval: approval ? String(approval) : null,
    binding: { check, createdAt: nowIso() },
    createdAt: nowIso(),
  };
  waivers.push(entry);
  fs.mkdirSync(DIRS.state, { recursive: true });
  writeJsonAtomic(FILES.waivers, waivers);
  return entry;
}

function isActive(w) {
  return !w.expiry || new Date(w.expiry).getTime() > Date.now();
}

export function listWaivers({ all = false } = {}) {
  const waivers = load();
  return all ? waivers : waivers.filter(isActive).map((w) => ({ ...w, expired: !isActive(w) }));
}

// 某检查是否被有效豁免覆盖（只豁免「暂时不做」，FAIL 状态由 quality verify 拦截，不在此处理）。
export function covers(check, attribute) {
  return load().some((w) => isActive(w) && w.check === check && (!attribute || w.attribute === attribute));
}

export function expiredCount() {
  return load().filter((w) => !isActive(w)).length;
}


// ══════════════════ 原 plan.mjs ═══════════════════

// verification plan（Task 8.3，codex 1.8/1.9 移植）：
// 「这次变更该跑哪些检查」= task 风险档 × 受影响模块声明 × 保守扩散 × 依赖闭包 的确定性函数，
// 不再靠派单自觉。planHash 绑定计划身份进回执——计划选择变化 → 旧回执与当前计划不匹配（stale）。
//
// 数据流：matrix.riskChecks[task.risk] 起始组（reasons=['risk:<档>']）
//   → 受影响模块（impact 反向闭包）的 module.verification 声明并集（reasons+=['module:<id>']）
//   → impact 保守扩散（unmapped/global/catchall/overlap → degraded）时并入 conservativeChecks（reasons+=['conservative-impact']）
//   → 依赖传递闭包（reasons=['dependency-of:<id>']）→ 拓扑序输出（环检测 MATRIX_CYCLE）。
//
// 兼容开关：matrix 未声明 riskChecks/conservativeChecks 且 catalog 无任何 module.verification
//   = 未采纳 plan 机制 → PLAN_NOT_ADOPTED，gate 按传统模式执行（不执法组队），既有项目零迁移成本。
// 空计划显式标记 empty：空计划是配置失败不是绿灯——gate/verify 消费时 BLOCKED。

export function loadMatrix() {
  if (!fs.existsSync(FILES.matrix)) return { checks: [] };
  return readJson(FILES.matrix);
}

// ---------- matrix 校验（新字段：dependencies/resourceLocks/platform + riskChecks/conservativeChecks） ----------

export function validateMatrix(matrix) {
  const err = (code, message) => ({ ok: false, code, message });
  if (!matrix || typeof matrix !== 'object') return err('MATRIX_INVALID', 'verification-matrix 不是对象');
  const checks = Array.isArray(matrix.checks) ? matrix.checks : [];
  const names = new Set();
  for (const c of checks) {
    if (!c || typeof c.name !== 'string' || !c.name) return err('MATRIX_INVALID', `检查缺 name：${JSON.stringify(c).slice(0, 80)}`);
    if (names.has(c.name)) return err('MATRIX_INVALID', `检查重名：${c.name}`);
    names.add(c.name);
    for (const f of ['dependencies', 'resourceLocks']) {
      if (c[f] === undefined) continue;
      if (!Array.isArray(c[f]) || c[f].some((x) => typeof x !== 'string' || !x)) {
        return err('MATRIX_INVALID', `${c.name}.${f} 必须是字符串数组`);
      }
    }
    if (c.platform !== undefined && !['linux', 'win32', 'any'].includes(c.platform)) {
      return err('MATRIX_INVALID', `${c.name}.platform 非法：${c.platform}（linux|win32|any）`);
    }
    // Task 9.1（八属性 + runtime 时间窗）：proves 必须是八属性词汇（UNKNOWN_ATTRIBUTE 同源执法）；
    // runtimeValidityHours 正数小时（class:'runtime' 未声明时 verify 按 24h 默认理解）。
    for (const a of c.proves || []) {
      if (!ATTRIBUTES.includes(a)) {
        return err('MATRIX_INVALID', `${c.name}.proves 含未知属性：${a}（八属性：${ATTRIBUTES.join('|')}）`);
      }
    }
    if (c.class !== undefined && (typeof c.class !== 'string' || !/^[a-z][a-z0-9-]*$/.test(c.class))) {
      return err('MATRIX_INVALID', `${c.name}.class 非法：${c.class}（如 security|privacy|test|integration|runtime|static|integrity）`);
    }
    if (c.runtimeValidityHours !== undefined) {
      const v = Number(c.runtimeValidityHours);
      if (!Number.isFinite(v) || v <= 0) {
        return err('MATRIX_INVALID', `${c.name}.runtimeValidityHours 非法：${c.runtimeValidityHours}（须为正数小时）`);
      }
    }
  }
  for (const c of checks) {
    for (const d of c.dependencies || []) {
      if (!names.has(d)) return err('MATRIX_UNKNOWN_CHECK', `检查 ${c.name} 依赖不存在的检查：${d}`);
    }
  }
  if (matrix.riskChecks !== undefined) {
    if (typeof matrix.riskChecks !== 'object' || Array.isArray(matrix.riskChecks)) {
      return err('MATRIX_INVALID', 'riskChecks 必须是对象 { low, medium, high }');
    }
    for (const [k, v] of Object.entries(matrix.riskChecks)) {
      if (!['low', 'medium', 'high'].includes(k)) return err('MATRIX_INVALID', `riskChecks 键非法：${k}（low|medium|high）`);
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) return err('MATRIX_INVALID', `riskChecks.${k} 必须是字符串数组`);
    }
  }
  if (matrix.conservativeChecks !== undefined
    && (!Array.isArray(matrix.conservativeChecks) || matrix.conservativeChecks.some((x) => typeof x !== 'string' || !x))) {
    return err('MATRIX_INVALID', 'conservativeChecks 必须是字符串数组');
  }
  for (const id of [...Object.values(matrix.riskChecks || {}).flat(), ...(matrix.conservativeChecks || [])]) {
    if (!names.has(id)) return err('MATRIX_UNKNOWN_CHECK', `组队引用不存在的检查：${id}`);
  }
  const cycle = detectCycle(checks);
  if (cycle) return err('MATRIX_CYCLE', `检查依赖成环：${cycle.join(' → ')}`);
  return { ok: true };
}

// 环检测（DFS 三色）：返回成环节点路径（首尾同名）或 null。
export function detectCycle(checks) {
  const byId = new Map(checks.map((c) => [c.name, c]));
  const color = new Map(); // 0/缺省=未访 1=在栈 2=完成
  const stack = [];
  const dfs = (n) => {
    color.set(n, 1); stack.push(n);
    for (const d of byId.get(n)?.dependencies || []) {
      if (!byId.has(d)) continue; // 未知引用由 validateMatrix 报
      const c = color.get(d) || 0;
      if (c === 1) return [...stack.slice(stack.indexOf(d)), n];
      if (c === 0) { const found = dfs(d); if (found) return found; }
    }
    stack.pop(); color.set(n, 2);
    return null;
  };
  for (const n of byId.keys()) {
    if ((color.get(n) || 0) === 0) { const found = dfs(n); if (found) return found; }
  }
  return null;
}

// 拓扑序（依赖在前）。调用前须通过 validateMatrix（含环检测）。
export function topologicalOrder(checks) {
  const byId = new Map(checks.map((c) => [c.name, c]));
  const done = new Set();
  const out = [];
  const visit = (name) => {
    if (done.has(name)) return;
    done.add(name);
    for (const d of byId.get(name)?.dependencies || []) if (byId.has(d)) visit(d);
    const c = byId.get(name);
    if (c) out.push(c);
  };
  for (const n of byId.keys()) visit(n);
  return out;
}

// plan 机制是否被采纳：matrix 声明 riskChecks/conservativeChecks 或 catalog 任一模块声明 verification。
// 未采纳 → gate 传统模式（不执法组队），既有项目零迁移成本（69/69 基线不回归的兼容面）。
export function planAdopted(matrix, catalog) {
  if (matrix?.riskChecks !== undefined || matrix?.conservativeChecks !== undefined) return true;
  return (catalog?.modules || []).some((m) => Array.isArray(m.verification) && m.verification.length > 0);
}

// ---------- verification plan 推导 ----------

// 返回：
//   { ok:true, taskId, risk, affectedModules, expandedToAll, degraded, empty, checks[], planHash, note }
//   { ok:false, code:'TASK_NOT_FOUND' | 'PLAN_NOT_ADOPTED' | 'MATRIX_*', message/note }
// 每 check 携带 reasons（来源可追溯：risk:<档> / module:<id> / conservative-impact / dependency-of:<id>）。
export function verificationPlan({ task } = {}) {
  const state = loadState();
  const t = task || state.tasks.find((x) => x.id === state.activeTask?.id) || null;
  if (!t) {
    return { ok: false, code: 'TASK_NOT_FOUND', note: '无活跃任务：plan 组队以任务风险档与受影响模块为输入——先 node .zcode/zbase.mjs task start --input <envelope>' };
  }
  const matrix = loadMatrix();
  const catalog = loadCatalog();
  if (!planAdopted(matrix, catalog)) {
    return { ok: false, code: 'PLAN_NOT_ADOPTED', note: 'verification plan 未采纳：matrix 未声明 riskChecks/conservativeChecks 且 catalog 无 module.verification——gate 按传统模式执行。采纳：在 matrix 增 riskChecks{low,medium,high} 与（可选）conservativeChecks，或在 catalog 模块补 verification 字段' };
  }
  const val = validateMatrix(matrix);
  if (!val.ok) return { ok: false, code: val.code, message: val.message };

  // ① risk 起始组
  const checkIds = new Set(matrix.riskChecks?.[t.risk] || []);
  const reasons = {};
  for (const id of checkIds) reasons[id] = [`risk:${t.risk}`];

  // ② 受影响模块（反向依赖闭包 ⊇ 直接受影响）的 verification 声明并集
  const impact = analyze({ changed: changedPaths() });
  let affectedModules = [];
  let expandedToAll = false;
  let degraded = null;
  if (impact.ok) {
    affectedModules = impact.fanout;
    expandedToAll = impact.degraded === true; // unmapped/global/catchall/overlap → 保守扩散
    if (impact.degraded) degraded = impact.reasons;
    const byName = new Map((catalog?.modules || []).map((m) => [m.name, m]));
    for (const name of affectedModules) {
      for (const id of byName.get(name)?.verification || []) {
        checkIds.add(id);
        (reasons[id] ??= []).push(`module:${name}`);
      }
    }
  } else degraded = impact.reason; // 小仓模式（无 catalog）：仅 riskChecks 组队

  // ③ 保守扩散：并入 conservativeChecks
  if (expandedToAll) {
    for (const id of matrix.conservativeChecks || []) {
      checkIds.add(id);
      (reasons[id] ??= []).push('conservative-impact');
    }
  }

  // ④ 依赖传递闭包（dependency-of:<引用者>）
  const byCheck = new Map(matrix.checks.map((c) => [c.name, c]));
  const addDeps = (id, seen = new Set()) => {
    for (const dep of byCheck.get(id)?.dependencies || []) {
      if (!checkIds.has(dep)) {
        checkIds.add(dep);
        reasons[dep] = [`dependency-of:${id}`];
      }
      if (!seen.has(dep)) { seen.add(dep); addDeps(dep, seen); }
    }
  };
  for (const id of [...checkIds]) addDeps(id);

  // ⑤ 拓扑序输出
  const checks = topologicalOrder(matrix.checks)
    .filter((c) => checkIds.has(c.name))
    .map((c) => ({
      name: c.name,
      tier: c.tier ?? null,
      dependencies: c.dependencies || [],
      resourceLocks: c.resourceLocks || [],
      platform: c.platform || 'any',
      reasons: reasons[c.name] || [],
    }));

  // planHash = 计划身份（选中集+reasons+推导上下文；**不含 fingerprint**——新鲜性由回执 fingerprint 字段独立执法）
  const base = {
    version: 1,
    taskId: t.id,
    risk: t.risk,
    affectedModules: [...affectedModules].sort(),
    expandedToAll,
    empty: checks.length === 0,
    checks,
  };
  return {
    ok: true,
    ...base,
    planHash: sha256(canonicalJson(base)),
    degraded,
    note: checks.length === 0
      ? 'EMPTY_PLAN：空计划是配置失败不是绿灯——riskChecks 与受影响模块 module.verification 均未组队任何检查'
      : null,
  };
}


// ══════════════════ adapters（Task 9.1，源 cursor #4 / cc §B）═══════════════════

// 外部工具目录与一键接线：八属性里 availability/performance（及深度 security/privacy）没有
// 外部工具就没有证据源——「哪些工具值得接、怎么接、装没装」需要一份可执行清单而不是文档。
// adapters.json 是数据（.zcode/harness/adapters.json，随项目分发可定制）；
// 本段是引擎：list（PATH 探测 + wired 状态）与 add（写入 verification-matrix + nextStep 提示）。
// 契约：本 harness 不捆绑/安装任何工具；可执行缺失的检查 BLOCKED 永不 PASS（runGate 127→BLOCKED）；
// class:'runtime' 的结果按时间窗理解（verify 侧 time-window-<n>h 绑定），不算工作树证据。

const ADAPTERS_FILE = path.join(DIRS.harness, 'adapters.json');

export function loadAdapters() {
  if (!fs.existsSync(ADAPTERS_FILE)) return [];
  const value = readJson(ADAPTERS_FILE);
  return Array.isArray(value?.adapters) ? value.adapters : [];
}

export function adaptersList({ attribute = null } = {}) {
  const catalogue = loadAdapters();
  const wanted = attribute ? String(attribute) : null;
  const filtered = wanted ? catalogue.filter((a) => (a.attributes || []).includes(wanted)) : catalogue;
  const matrix = loadMatrix();
  const wired = new Set(matrix.checks.map((c) => c.name));
  return {
    command: 'adapters list',
    attribute: wanted,
    adaptersFound: catalogue.length,
    adapters: filtered.map((a) => ({
      id: a.id,
      attributes: a.attributes,
      class: a.class,
      executable: a.executable,
      available: whichCommand(a.executable) !== null,
      wired: wired.has(a.id),
      install: a.install,
      rationale: a.rationale,
    })),
    note: 'available 探测 PATH（Windows 含 PATHEXT）；wired=verification-matrix 已有同名检查。接线只是一半：模块 verification 认领才生效。',
  };
}

export function adaptersAdd(id, { dryRun = false } = {}) {
  const adapter = loadAdapters().find((a) => a.id === id);
  if (!adapter) {
    return { ok: false, reason: `未知 adapter：${id || '<missing>'}` };
  }
  const matrix = loadMatrix();
  const already = matrix.checks.some((c) => c.name === adapter.id);
  // 接线形态对齐本仓 matrix 词汇：proves（attributes）+ class + runtimeValidityHours（class:runtime）。
  const check = {
    name: adapter.id,
    command: adapter.command,
    proves: adapter.attributes,
    class: adapter.class,
    tier: 'high',
    description: `adapters 接线：${adapter.rationale}`,
    ...(Number.isFinite(Number(adapter.timeoutMs)) ? { timeoutMs: Number(adapter.timeoutMs) } : {}),
    ...(adapter.class === 'runtime' ? { runtimeValidityHours: Number.isFinite(Number(adapter.runtimeValidityHours)) ? Number(adapter.runtimeValidityHours) : 24 } : {}),
  };
  const next = { ...matrix, checks: [...matrix.checks.filter((c) => c.name !== adapter.id), check] };
  const val = validateMatrix(next);
  if (!val.ok) {
    return { ok: false, reason: `接线后 matrix 无效（${val.code}）：${val.message}——拒绝写入（fail-visible）` };
  }
  if (!dryRun) writeJsonAtomic(FILES.matrix, next);
  return {
    command: 'adapters add',
    ok: true,
    id: adapter.id,
    changed: !already,
    dryRun,
    executableAvailable: whichCommand(adapter.executable) !== null,
    install: adapter.install,
    check,
    nextStep: `接线只是一半：把 "${adapter.id}" 加进每个需要 ${adapter.attributes.join(' 和 ')} 证据的模块的 verification 列表（module-catalog modules[].verification），plan 组队才会选中它`,
  };
}

// ══════════════════ 原 budget.mjs ═══════════════════

// 变更爆炸半径预算（Task 7.9，源 dsh assessBudget）：超预算不禁止，但必须拆分变更或记 ADR 显式升级。
// 四指标：changedFiles ≤40 / changedLines（numstat 累加）≤1500 / modulesTouched（impact 直接受影响模块）≤3 / newFiles（untracked）≤25。
// 限额可由 harness.json budget 段覆盖（默认值见 config.mjs DEFAULTS）。

export function assessBudget({ staged = false } = {}) {
  const limits = loadHarnessConfig().budget || {};
  const limit = {
    maxChangedFiles: 40,
    maxChangedLines: 1500,
    maxModulesTouched: 3,
    maxNewFiles: 25,
    ...limits,
  };
  const s = statusPaths();
  // 运行态路径不算变更面（与 fingerprint 口径一致）
  const strip = (ps) => ps.filter((p) => !p.startsWith('.zcode/state/') && !p.startsWith('.zbase/'));
  const changed = strip(staged ? s.staged : [...s.staged, ...s.unstaged, ...s.untracked]);
  const newFiles = strip(s.untracked);

  const stat = numstat({ staged });
  const changedLines = stat.reduce((n, r) => n + r.added + r.removed, 0);

  // modulesTouched：impact 直接受影响模块（反向闭包的种子集）。无 catalog → 该指标 degraded 跳过（不伪造 0）。
  const imp = analyze({ changed });
  const modulesTouched = imp.ok ? imp.affected.length : null;

  const metrics = {
    changedFiles: changed.length,
    changedLines,
    modulesTouched,
    newFiles: newFiles.length,
  };
  const findings = [];
  const check = (key, limitKey) => {
    if (metrics[key] === null) return; // degraded 指标不判
    if (metrics[key] > limit[limitKey]) {
      findings.push({ metric: key, actual: metrics[key], limit: limit[limitKey] });
    }
  };
  check('changedFiles', 'maxChangedFiles');
  check('changedLines', 'maxChangedLines');
  check('modulesTouched', 'maxModulesTouched');
  check('newFiles', 'maxNewFiles');

  return {
    ok: findings.length === 0,
    staged,
    metrics,
    limits: limit,
    degraded: !imp.ok ? ['modulesTouched（module-catalog 不存在）'] : [],
    findings,
    advice: findings.length
      ? '变更爆炸半径超预算：拆分变更，或记 ADR 显式升级（超预算本身是决策，不是事故）'
      : '预算内',
  };
}


// ══════════════════ 原 review.mjs ═══════════════════

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

// zcode catalog 属性六档（none/minimal/low/medium/high/critical， weakest-first 由 TIERS 反转）；
// 阈值 low：low 以上（含 minimal 之上）才算「声明了」。Task 9.1 起源自 core.TIERS 单点。
const TIER_RANK = [...TIERS].reverse();

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

// 会话封禁（R4-F1）：verdict 最终落定（ACCEPT+isFinal，或 FIX_REQUIRED escalate）后，会话成为只读事实——
// 续写 blue/lens/verdict 可以改写已裁定的事实（历史 error 被空 findings 无痕撤销）。
// backlog 不封：escalate advice 的出路就是把 finding 记成有书面理由的债。
function writable(s) {
  if (!s.final) return { ok: true };
  return { ok: false, sealed: true, reason: '会话已封（verdict 已最终落定）——blue/lens/verdict 写操作拒绝；修正后重开 review start（backlog 记债仍可用）' };
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
  const w = writable(s);
  if (!w.ok) return { ok: false, ...w };
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
// R4-F1：lens 已报不得重报——覆写等于让已记录的 findings（含 error）无痕消失；修正走重开 review start。
export function recordLens(name, payload) {
  const s = readReview();
  const f = freshness(s);
  if (!f.ok) return { ok: false, ...f };
  const w = writable(s);
  if (!w.ok) return { ok: false, ...w };
  if (!(s.requiredLenses || []).includes(name)) {
    return { ok: false, reason: `未知 lens "${name}"；本次审查要求：${s.requiredLenses.join(', ')}` };
  }
  if (s.lenses[name]) {
    return { ok: false, reason: `lens ${name} 已报告——重报会覆写已记录的 findings（历史 error 不得无痕消失）；修正后重开 review start` };
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
  const w = writable(s);
  if (!w.ok) return { ok: false, ...w };

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
  // R4-F1 会话封禁：最终 ACCEPT（回执已落账）或 escalate（人工升级）后，续写可改写已裁定的事实 → 只读。
  if ((verdict === 'ACCEPT' && isFinal) || escalate) s.final = true;
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
    final: s.final === true,
    backlog: { count: (s.backlog || []).length, expired: (s.backlog || []).filter((e) => !(new Date(e.expiry) > new Date())).length },
  };
}

// ---------- backlog ----------
// 审查必须能结束。无休止的轮次是好标准被抛弃的方式，但 finding 不能就此蒸发：
// 人决定背负的 finding 变成积压条目（owner/expiry/理由）。三性 finding 永不可入积压——
// 积压会变成设计拒绝给它的那种豁免（backlog 即 waiver 的缺口）。
// R4-F2：三性禁令不只在 summary 文本——lens 名认领红线属性（security/privacy lens 的
// attribute ∈ PROTECTED_ATTRS）即拒（summary 干净也算结构化绕过）；location 文本同受禁令正则。
export function backlogAdd(payload) {
  const s = readReview();
  const f = freshness(s);
  if (!f.ok) return { ok: false, ...f };
  const required = ['owner', 'expiry', 'summary', 'lens'];
  const missing = required.filter((k) => !(payload && payload[k] && String(payload[k]).trim()));
  if (missing.length) return { ok: false, reason: `积压条目需要：${missing.join(', ')}（owner/expiry 未来 ISO/summary/lens）` };
  if (!(new Date(payload.expiry) > new Date())) return { ok: false, reason: 'expiry 必须是未来时间；无日期的债永远无人偿还' };
  const lensDef = LENS_LIBRARY[String(payload.lens)];
  if (lensDef?.attribute && PROTECTED_ATTRS.includes(lensDef.attribute)) {
    return { ok: false, reason: `三性（security/safety/privacy/pii/secret/credential）相关 finding 不可入积压——lens "${payload.lens}" 认领的 ${lensDef.attribute} 是红线属性，积压会变成它恰好要充当的豁免` };
  }
  const summary = String(payload.summary);
  const textFields = `${summary} ${payload.location ? String(payload.location) : ''}`;
  if (BACKLOG_FORBIDDEN.test(textFields)) {
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


// ══════════════════ 原 audit.mjs ═══════════════════

// 门禁日志 + 死闸审计：所有 hook 拦截/观察留痕；「从未拦过的门要么给证据要么撤」。
// v2.1：gate-log 出口统一脱敏（命令/理由里的 token 不入留痕），preview/reason 截头保审计信息。
// v2.3（Task 8.4）：写入前尺寸轮转（默认 4MB → .1 保一代）——append-only 日志无界增长会吃掉磁盘并拖慢审计。

export function logGate(entry) {
  const safe = {};
  for (const [k, v] of Object.entries(entry)) {
    safe[k] = typeof v === 'string' ? boundedHead(v, 300) : v;
  }
  rotateGateLog(); // 超限先滚再写（保一代归档）
  appendLine(FILES.gateLog, { ts: nowIso(), ...safe });
}

export function readGateLog() {
  return readLines(FILES.gateLog).map((l) => {
    try { return JSON.parse(l); } catch { return { ts: null, event: 'malformed', rule: null, action: 'malformed' }; }
  });
}

// 死闸审计：统计每条规则的拦截/观察次数。denied=0 且 observed=0 的规则 = 疑似死闸。
export function audit() {
  const entries = readGateLog();
  const rules = new Map();
  for (const e of entries) {
    const key = `${e.event}:${e.rule || e.tool || 'unspecified'}`;
    if (!rules.has(key)) rules.set(key, { key, denied: 0, observed: 0, lastSeen: null });
    const r = rules.get(key);
    if (e.action === 'deny') r.denied++;
    else r.observed++;
    r.lastSeen = e.ts;
  }
  const list = [...rules.values()];
  return {
    totalEvents: entries.length,
    rules: list,
    dead: list.filter((r) => r.denied === 0),
    neverFired: list.filter((r) => r.denied === 0 && r.observed === 0),
  };
}

export function gateLogPath() {
  return rel(process.cwd(), FILES.gateLog);
}

// ---------- effectiveness（Task 10.2，REQ-34 自我插桩；源 cc N7「闸要能说出它挡住过什么」） ----------
// 死闸审计（上方 audit）的升级：不只数「拦过几次」，还给出每规则的 deny/observe/allow 三态
// 分布 + 最后触发时间，供「长期全绿零拦截的闸应简化或删」的裁剪决策用数据而非感觉。
// 派生口径（fail-visible，不假装全知）：
//   - 数据源仅 gate-log（留痕面）：从未触发过的规则根本不在账上——blindSpot 字段显式标注该盲区，
//     注册闸清单的接线依赖 OQ-4（子代理触发域）实测后再补。
//   - unexercised = 阻断类事件（PreToolUse/PermissionRequest/Stop——hook exit 2 契约上的事件）上
//     deny===0 且非 pass-through 的规则：要么没挡住过任何东西，要么只是观察哨——留给裁剪裁决。
//   - pass-through 规则（如 'ok'：hooks observe() 的放行留痕）deny===0 是设计而非死闸，不计入；
//     清单可经 harness.json effectiveness.passThroughRules 扩展（分类器规则改名时不锁死本报告）。
//   - 出口统一 redactSecrets：留痕卫生与 logGate 入口对称——报告里的规则名/事件名不携带秘密。
//   - allow 计数独立于 observe：R6a 分类器三档决策（禁/确认/放行）落账后 allow 是显式动作。
const BLOCK_CAPABLE_EVENTS = new Set(['PreToolUse', 'PermissionRequest', 'Stop']);
const DEFAULT_PASS_THROUGH_RULES = ['ok'];

export function effectiveness({ entries = null } = {}) {
  const log = entries || readGateLog();
  const extra = loadHarnessConfig()?.effectiveness?.passThroughRules;
  const passThrough = new Set(Array.isArray(extra) ? [...DEFAULT_PASS_THROUGH_RULES, ...extra.map(String)] : DEFAULT_PASS_THROUGH_RULES);
  const rules = new Map();
  const actionsSeen = new Set();
  for (const e of log) {
    const rule = String(e.rule || e.tool || 'unspecified');
    const key = `${e.event}:${rule}`;
    if (!rules.has(key)) rules.set(key, { key, event: String(e.event), rule, deny: 0, observe: 0, allow: 0, other: 0, total: 0, lastTriggered: null });
    const r = rules.get(key);
    const action = String(e.action || 'unknown');
    actionsSeen.add(action);
    if (action === 'deny') r.deny++;
    else if (action === 'observe') r.observe++;
    else if (action === 'allow') r.allow++;
    else r.other++; // exhausted/guardrail-write 等非三态动作：计数不丢弃（fail-visible）
    r.total++;
    if (e.ts) r.lastTriggered = e.ts; // gate-log append-only：后到即最新
  }
  const list = [...rules.values()]
    .map((r) => ({ ...r, key: redactSecrets(r.key), event: redactSecrets(r.event), rule: redactSecrets(r.rule) }))
    .sort((a, b) => (b.deny - a.deny) || a.key.localeCompare(b.key));
  const unexercised = list.filter((r) => r.deny === 0 && BLOCK_CAPABLE_EVENTS.has(r.event) && !passThrough.has(r.rule));
  const totalDeny = list.reduce((n, r) => n + r.deny, 0);
  return {
    command: 'effectiveness',
    totalEvents: log.length,
    rules: list,
    unexercised,
    actionsSeen: [...actionsSeen].sort(),
    blindSpot: '仅 gate-log 派生：从未触发的规则零留痕零计数，不在本账上；unexercised 只覆盖「触发过但从未拦」的规则',
    summary: `闸要能说出它挡住过什么：${list.length} 条规则留痕，累计 deny ${totalDeny} 次；${unexercised.length} 条阻断类规则从未拦过（unexercised——要么补证据，要么简化/裁撤）`,
  };
}


// ══════════════════ 原 retention.mjs#rotateGateLog（Task 8.10 自 retention 并入） ═══════════════════

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
