// quality：四态门 + 五性覆盖验证（反证优先）。
// v2.1：PROTECTED 扩三性（security/safety/privacy，唯一事实源 common.mjs）；
//      gate 执行器加 fast 贷款分支（allowFastSkip 预标记 + protected 永不跳 + windowId 留痕）；
//      verify 聚合判定——已执行的 FAIL 永不可被 fast 豁免（反证优先于一切 skip 判定）。
// v2.3（Task 8.3/8.4）：gate 按 verification plan 执法（采纳时：空计划/未组队拒绝；依赖未过/平台不符 BLOCKED；
//      resourceLocks 经 withStateLock 命名空间锁）；check 全量输出（脱敏+预算 200000 保尾）写独立 evidence 文件，
//      回执带 evidencePath/evidenceBytes/evidenceHash 三重句柄 + planHash（哈希链覆盖）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { nowIso, readLines, boundedTail, sha256, rel, PROTECTED_ATTRS } from './common.mjs';
import { FILES, DIRS, ROOT } from './config.mjs';
import { loadCatalog } from './catalog.mjs';
import { latestReceipts, verifyLedger, writeReceipt } from './receipts.mjs';
import { covers } from './waivers.mjs';
import { fastStatus, loadState, withStateLock } from './state.mjs';
import { loadMatrix, verificationPlan } from './plan.mjs';
import { scopeMatches } from './review.mjs';
import { fingerprint } from './git.mjs';

// loadMatrix 迁至 plan.mjs（组队推导的事实源）；此处 re-export 保住既有导入面（fitness 等）。
export { loadMatrix } from './plan.mjs';

const ATTRS = ['resilience', 'security', 'safety', 'privacy', 'reliability'];
const ENFORCE_LEVELS = ['critical', 'high'];
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
    status = e.killed ? 'BLOCKED' : 'FAIL';
  }
  // evidence 三重句柄：全量输出（脱敏+200000 保尾）独立落盘；note 仍存摘要（模型可见面）
  const ev = writeEvidenceFile(taskId, checkName, boundedTail(out, EVIDENCE_CHARS) || `exit ${code}`);
  const receipt = writeReceipt({ check: checkName, status, note: note || (out ? boundedTail(out, 2000) : `exit ${code}`), planHash, evidenceFile: ev, executor });
  return { ok: status === 'PASS', status, exitCode: code, outputTail: boundedTail(out, 2000), receiptSeq: receipt.seq, evidencePath: ev.path, planHash: planHash ?? null };
}

// coverage status：每模块五性档位 → 认领检查 → 最新回执状态（全量视角，不筛新鲜）。
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
      const scope = matrix.checks.find((c) => c.name === cn)?.scope || [];
      for (const e of byCheck.get(cn) || []) {
        if (scope.length && !scope.includes(row.module)) continue;
        evs.push({
          status: e.content.status,
          fresh: e.content.fingerprint === ver.currentFingerprint,
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
    else if (hasPass) covered++;
    else if (waivedSkip) covered++;
    else if (allBlocked) uncovered.push({ ...row, reason: 'BLOCKED 不算覆盖' });
    else if (ENFORCE_LEVELS.includes(row.level)) {
      // critical/high：fast 窗口的 SKIPPED 不算覆盖（未跑=BLOCKED）——fast 只对 medium/low 放行，且债务由 task finish 收口
      const fastSkipped = freshEvs.some((e) => e.status === 'SKIPPED' && e.fastModeWindow);
      uncovered.push({
        ...row,
        reason: isProtected
          ? `${row.attribute} 红线：critical/high 必须有新鲜 PASS 回执（不可豁免、不可 Fast 跳过）`
          : fastSkipped
            ? `${row.attribute}（${row.level} 档）在 fast 窗口被跳过：critical/high 检查未跑=BLOCKED，SKIPPED 不算覆盖——重跑偿贷或降档须走档位变更`
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
