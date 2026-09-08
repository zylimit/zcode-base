// tier 三档强度盘（R8a，三仓精读裁决 A1：cc tier.mjs 唯一解析器 + codex assurance floor 的轻量合成）。
// 设计事实源：.zcode/docs/research/dsh-cc-codex-full-sweep-20260907.md 第五节；宪法 Fast Mode 节执法指认。
//   - 三内置档 fast / standard / strict（默认 standard）；每 hook 闸规则每档一模式 block / advise / off。
//   - **未列出的规则默认 block**——standard=全 block=现状零回归（硬保证，不靠配置缺席实现）。
//   - 表文件 .zcode/harness/profile.json（{version, tiers:{fast:{rules:{"<rule-id>":"advise"|"off"}}, ...}}）；
//     block 是默认态不进表；strict 档 v1 不加增量规则（语义=治理面自动升档的落点，不虚增机制）。
//   - 结构性地板 FLOOR_RULES（写死）：三性红线与不可逆保护任何档恒 block——可调静音的底线不叫底线；
//     地板入表 → tier validate 报错。
//   - 治理面脏树 raise：AGENTS.md / .zcode/{rules,skills,lib,commands,harness,githooks}/** / .github/** /
//     .zcode/zbase.mjs 脏 → effective=strict 并点名文件——**现算无状态**（每次从 git status 算，提交后自然回落）。
//   - fast 档=现有贷款状态机（lib/core.mjs fastSet/fastStatus）：tier set fast 等价 fast on 全套
//     （reason 必填、hours clamp 1..8 折算 minutes 1..480、windowId、DEBT 语义不变）。
//     档位与贷款正交：窗口管债务、档位管出口强度；tier set standard/strict 不清窗口，显式 fast off 或到期才清。
//   - 优先级：治理面 raise（strict）> 显式 strict > fast 窗口 > 会话档（fast 无活跃窗口回落 standard）。
// 唯一解析器纪律（cc #38 教训：一个开关三处解析一边开一边关）：hook 侧（hooks.mjs）与 CLI 侧（zbase.mjs tier）
// 只消费本模块，禁止各自读表。依赖方向：只依赖 core（fast 状态机/changedPaths/matchAny）——
// 可被 core 之后的任何模块 import（hooks/context/zbase.mjs 消费；catalog 归入 lib-core 界）。
import fs from 'node:fs';
import path from 'node:path';
import { changedPaths, DIRS, fastSet, fastStatus, matchAny, nowIso, quarantineState, readJson, rel, ROOT, writeJsonAtomic } from './core.mjs';

// 弱→强序（单调校验按此索引：rank[fast] ≤ rank[standard] ≤ rank[strict]）
export const BUILTIN_TIERS = Object.freeze(['fast', 'standard', 'strict']);

// 会话档位文件（唯一写方 = tier set；损坏 → standard + 出声，fail-visible 但不砖会话）
const tierFile = () => path.join(DIRS.state, 'tier.json');
// 档位表文件（harness 契约面）
export const profileFile = () => path.join(DIRS.harness, 'profile.json');

// ---------- 结构性地板（三性红线与不可逆保护） ----------
// 从 hooks.mjs 实际注册的规则中划出受保护集：秘密读取/外传/复制/写入类、classifier deny 档危险命令类、
// 写路径预检越界类（含 writes.mjs 的 TASK_*/路径安全码）、账本防篡改（protected-write）。
// 任何档解析结果恒 block；出现在 profile.json 表内 → tier validate FLOOR_IN_TABLE error。
export const FLOOR_RULES = Object.freeze(new Set([
  // 秘密类（隐私红线：密钥不入上下文/不出网/不落新位置）
  'secret-read', 'secret-egress', 'secret-copy', 'secret-write',
  // classifier deny 档危险命令类（不可逆保护：rm/git reset·clean·force-push/磁盘/关机/fork bomb/管道进解释器）
  'rm-rf-root', 'recursive-forced-deletion', 'git-reset-hard', 'git-clean', 'git-force-push',
  'broad-kill', 'chmod-777', 'recursive-system-chmod', 'mkfs-dd-disk', 'machine-shutdown',
  'fork-bomb', 'curl-pipe-shell',
  // 写路径预检越界类（最小副作用/保护现有改动的机器闸）
  'write-preflight', 'TASK_SCOPE', 'TASK_NEW_FILE_CONFLICT', 'TASK_CONCURRENT_CHANGE',
  'SYMLINK_ESCAPE', 'OUTSIDE_REPO', 'UNSAFE_PATH',
  // 账本/门禁注册/安装清单防篡改（证据完整性）
  'protected-write',
]));

// ---------- 治理面 raise.paths（自动升档面） ----------
// 「改判官的人自动挨最严审查」：工作树触碰治理面 → effective=strict 并点名文件；提交后自然回落（现算无状态）。
export const RAISE_PATHS = Object.freeze([
  'AGENTS.md',
  '.zcode/rules/**',
  '.zcode/skills/**',
  '.zcode/lib/**',
  '.zcode/commands/**',
  '.zcode/harness/**',
  '.zcode/githooks/**',
  '.github/**',
  '.zcode/zbase.mjs',
]);

// ---------- 表装载 ----------
// 损坏 → 空表 + warning（fail-closed：ruleMode 一律按 block；validate 报 PROFILE_CORRUPT）。
export function loadProfile() {
  const file = profileFile();
  if (!fs.existsSync(file)) return { exists: false };
  try {
    return { exists: true, doc: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { exists: true, corrupt: true, warning: String(e?.message ?? e) };
  }
}

function tableFor(tier, table) {
  if (table !== undefined) return table || {}; // 注入表（单测用；hooks/CLI 走盘上表）
  const p = loadProfile();
  if (!p.exists || p.corrupt) return {};
  return p.doc?.tiers?.[tier]?.rules || {};
}

// ---------- 唯一模式解析 ----------
// 地板→block；表内→表值（advise|off）；未列出/值非法→block。任何读表失败路径都落 block（宁严勿漏）。
export function ruleMode(ruleId, tier, table) {
  if (FLOOR_RULES.has(ruleId)) return 'block';
  const mode = tableFor(tier, table)?.[ruleId];
  return mode === 'advise' || mode === 'off' ? mode : 'block';
}

// ---------- 会话档位读取（损坏隔离，不砖会话） ----------
function readSessionTier() {
  const file = tierFile();
  if (!fs.existsSync(file)) return { tier: 'standard' };
  let doc;
  try {
    doc = readJson(file);
  } catch (e) {
    if (e instanceof SyntaxError) {
      try { quarantineState(file, e); } catch { /* 取证 best-effort：rename 失败时仍按默认继续 */ }
      return { tier: 'standard', warning: 'tier.json JSON 损坏已隔离（quarantine.jsonl 留痕）——按 standard 继续，不砖会话' };
    }
    throw e; // EACCES 等环境错误可见上抛——完好但暂不可读的状态不得静默降档
  }
  if (!BUILTIN_TIERS.includes(doc?.tier)) {
    return { tier: 'standard', warning: `tier.json 档位值非法（${JSON.stringify(doc?.tier)}）——按 standard 继续` };
  }
  return { tier: doc.tier };
}

function writeSessionTier(tier, extra) {
  fs.mkdirSync(DIRS.state, { recursive: true });
  writeJsonAtomic(tierFile(), { version: 1, tier, setAt: nowIso(), ...extra });
}

// ---------- effective 解析（现算无状态） ----------
// 优先级：治理面 raise > 显式 strict > fast 窗口 > 会话档。fast 档无活跃窗口 → 回落 standard
// （贷款到期档位自然失效——fast 的物质基础就是窗口本身）。
export function resolveTier({ sessionTier, dirtyPaths } = {}) {
  const warnings = [];
  let tier;
  if (sessionTier !== undefined) {
    tier = sessionTier;
    if (!BUILTIN_TIERS.includes(tier)) {
      warnings.push(`sessionTier 非法（${JSON.stringify(sessionTier)}）——按 standard`);
      tier = 'standard';
    }
  } else {
    const read = readSessionTier();
    tier = read.tier;
    if (read.warning) warnings.push(read.warning);
  }
  const fast = fastStatus();
  const dirty = dirtyPaths !== undefined ? (dirtyPaths || []) : changedPaths();
  const raisedBy = dirty.filter((p) => matchAny(p, [...RAISE_PATHS]));
  if (raisedBy.length > 0) {
    return { tier, effective: 'strict', raisedBy, fastWindow: fast.enabled, warnings };
  }
  if (tier === 'strict') return { tier, effective: 'strict', raisedBy: [], fastWindow: fast.enabled, warnings };
  if (fast.enabled) return { tier, effective: 'fast', raisedBy: [], fastWindow: true, warnings };
  if (tier === 'fast') {
    warnings.push('fast 档无活跃贷款窗口（从未开或已到期）——effective 回落 standard；重开用 tier set fast --reason <r> --hours <h>');
    return { tier, effective: 'standard', raisedBy: [], fastWindow: false, warnings };
  }
  return { tier, effective: 'standard', raisedBy: [], fastWindow: false, warnings };
}

// 一行播报（SessionStart / invariants State 块共用；无 ISO 时钟值——缓存比对按相对值走，cc 教训）
export function tierLine(res) {
  const parts = [`TIER 档位 ${res.tier} → effective ${res.effective}`];
  if ((res.raisedBy || []).length) parts.push(`治理面脏树 ${res.raisedBy.length} 文件 raise→strict`);
  if (res.fastWindow) parts.push('fast 窗口开');
  const line = `- ${parts.join('，')}`;
  return (res.warnings || []).length ? `${line}（${res.warnings[0]}）` : line;
}

// ---------- 规则注册面（现算枚举——不养第二份名单） ----------
// hooks.mjs 消费的规则 id 三源现算：①hooks.mjs 源码字面量（deny('id' / stopBlock 尾参 / rule: 'id'）
// ②writes.mjs 预检码（code: 'XXX'）③classifier-rules.json 全量（deny+ask）。
// tier validate 用它拒幽灵规则（表里躺着不存在的规则）；tier explain 用它列全量。
// 注意：`rule: 'id'` 字面量源会把 observe-only id（feedback-signal/guardrail-asset-write）也收进注册面——
// 刻意保留：explain 多列无害（如实展示「这个 id 存在但只是观察哨」）；入表是 no-op（ruleMode 仅在
// deny/stop 判定路径被消费，observe-only id 没有阻断出口可降级——写了 advise/off 也不改变任何行为）。
export function registeredRuleIds() {
  const ids = new Set();
  const readSrc = (file) => {
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; } // 源不可读：该源跳过（其余源继续）
  };
  const hooksSrc = readSrc(path.join(DIRS.runtime, 'hooks.mjs'));
  if (hooksSrc) {
    for (const m of hooksSrc.matchAll(/\bdeny\(\s*'([A-Za-z][A-Za-z0-9_-]*)'/g)) ids.add(m[1]);
    // stopBlock(…, 'rule-id') 尾参字面量（非贪心窗口内找最近的 引号id+收尾 形态）
    for (const m of hooksSrc.matchAll(/\bstopBlock\([\s\S]{0,1200}?'([A-Za-z][A-Za-z0-9_-]*)'\s*,?\s*\)/g)) ids.add(m[1]);
    for (const m of hooksSrc.matchAll(/\brule:\s*'([A-Za-z][A-Za-z0-9_-]*)'/g)) ids.add(m[1]);
  }
  const writesSrc = readSrc(path.join(DIRS.runtime, 'writes.mjs'));
  if (writesSrc) {
    for (const m of writesSrc.matchAll(/\bcode:\s*'([A-Za-z][A-Za-z0-9_-]*)'/g)) ids.add(m[1]);
  }
  try {
    const rules = readJson(path.join(DIRS.harness, 'classifier-rules.json'))?.rules || [];
    for (const r of rules) if (r?.id) ids.add(r.id);
  } catch { /* 无向量文件：分类器规则源空缺，其余源继续 */ }
  return ids;
}

// ---------- validate ----------
const MODE_RANK = { off: 0, advise: 1, block: 2 };

export function tierValidate() {
  const errors = [];
  const registered = registeredRuleIds();

  // ① 地板完整性：地板 id 必须都在现算注册面（地板划定了不存在的规则 = 契约自破坏）
  for (const f of FLOOR_RULES) {
    if (!registered.has(f)) errors.push({ code: 'FLOOR_GHOST', rule: f, message: `地板规则 ${f} 不在 hooks.mjs/classifier-rules 现算注册面——地板划定了不存在的规则` });
  }

  const p = loadProfile();
  if (!p.exists) {
    return {
      ok: errors.length === 0, errors,
      profile: { exists: false, note: 'profile.json 不存在——空表=三档全默认：standard/strict 全 block，fast 表内才可降' },
      counts: { registeredRules: registered.size, rulesInTable: 0 },
    };
  }
  if (p.corrupt) {
    errors.push({ code: 'PROFILE_CORRUPT', message: `profile.json 不可解析（${p.warning}）——fail-closed：ruleMode 一律按 block` });
    return { ok: false, errors, profile: { exists: true, corrupt: true }, counts: { registeredRules: registered.size, rulesInTable: 0 } };
  }

  const tiers = p.doc?.tiers;
  if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) {
    errors.push({ code: 'PROFILE_STRUCTURE', message: 'profile.json 缺 tiers 对象（期望 {version, tiers:{fast,standard,strict}}）' });
    return { ok: false, errors, profile: { exists: true }, counts: { registeredRules: registered.size, rulesInTable: 0 } };
  }

  const tables = {};
  for (const t of BUILTIN_TIERS) {
    const rules = tiers[t]?.rules;
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      errors.push({ code: 'PROFILE_STRUCTURE', tier: t, message: `tiers.${t} 缺 rules 对象` });
      tables[t] = {};
      continue;
    }
    tables[t] = rules;
    for (const [rid, mode] of Object.entries(rules)) {
      if (mode !== 'advise' && mode !== 'off') {
        errors.push({ code: 'PROFILE_BAD_MODE', tier: t, rule: rid, mode, message: `tiers.${t}.rules.${rid} 值须 "advise"|"off"（block 是默认态不进表）——收到 ${JSON.stringify(mode)}` });
      }
    }
  }
  // v1 只认三内置档（自定义档 extends 单调留给 v2）
  for (const key of Object.keys(tiers)) {
    if (!BUILTIN_TIERS.includes(key)) errors.push({ code: 'PROFILE_UNKNOWN_TIER', tier: key, message: `自定义档 v1 不开放（收到 tiers.${key}；内置 fast|standard|strict）` });
  }

  // ② 地板入表 → error（三性红线与不可逆保护不可表达为可调静音）
  for (const t of BUILTIN_TIERS) {
    for (const rid of Object.keys(tables[t])) {
      if (FLOOR_RULES.has(rid)) errors.push({ code: 'FLOOR_IN_TABLE', tier: t, rule: rid, message: `地板规则 ${rid} 不得入表——三性红线与不可逆保护任何档恒 block` });
    }
  }

  // ③ 幽灵规则：表中 id 不在现算注册面（防表里躺着死规则/拼错 id 假绿）
  for (const t of BUILTIN_TIERS) {
    for (const rid of Object.keys(tables[t])) {
      if (!registered.has(rid)) errors.push({ code: 'GHOST_RULE', tier: t, rule: rid, message: `规则 ${rid} 未在 hooks.mjs/classifier-rules 注册（注册面现算枚举）——表里的规则必须真实存在` });
    }
  }

  // ④ 三档单调：off(0) < advise(1) < block(2)，须 fast ≤ standard ≤ strict（未列出=block）。
  //    v1 strict=standard 天然满足，但校验逻辑真实现——防未来改表引入高档比低档松。
  const ids = [...new Set(BUILTIN_TIERS.flatMap((t) => Object.keys(tables[t])))];
  for (const rid of ids) {
    const rank = BUILTIN_TIERS.map((t) => (tables[t][rid] in MODE_RANK ? MODE_RANK[tables[t][rid]] : MODE_RANK.block));
    if (!(rank[0] <= rank[1] && rank[1] <= rank[2])) {
      errors.push({
        code: 'NOT_MONOTONIC', rule: rid,
        modes: BUILTIN_TIERS.map((t) => tables[t][rid] ?? 'block'),
        message: `规则 ${rid} 三档不单调（off<advise<block，须 fast≤standard≤strict；未列出=block）——高档不得比低档松`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
    profile: { exists: true, path: rel(ROOT, profileFile()), rulesInTable: ids.length },
    floorRules: [...FLOOR_RULES],
    registeredRules: registered.size,
  };
}

// ---------- explain ----------
function explainRow(rid) {
  return {
    rule: rid,
    floor: FLOOR_RULES.has(rid),
    fast: ruleMode(rid, 'fast'),
    standard: ruleMode(rid, 'standard'),
    strict: ruleMode(rid, 'strict'),
  };
}

export function tierExplain({ rule } = {}) {
  const registered = registeredRuleIds();
  const res = resolveTier();
  const head = { tier: res.tier, effective: res.effective, raisedBy: res.raisedBy, fastWindow: res.fastWindow, warnings: res.warnings };
  if (rule !== undefined && rule !== null) {
    if (!registered.has(rule)) {
      return { ok: false, code: 'UNKNOWN_RULE', rule, message: `规则 ${rule} 不在注册面（registeredRuleIds 现算枚举 hooks.mjs/classifier-rules）` };
    }
    return { ok: true, ...head, rules: [explainRow(rule)] };
  }
  return { ok: true, ...head, rules: [...registered].sort().map(explainRow) };
}

// ---------- status / set（CLI 消费） ----------
export function tierStatus() {
  const res = resolveTier();
  const fast = fastStatus();
  return {
    tier: res.tier,
    effective: res.effective,
    raisedBy: res.raisedBy,
    raiseCount: (res.raisedBy || []).length,
    fast: fast.enabled
      ? { enabled: true, hoursLeft: Number(Math.max(0, (new Date(fast.until).getTime() - Date.now()) / 3600_000).toFixed(1)), reason: fast.reason, windowId: fast.windowId }
      : { enabled: false },
    profile: rel(ROOT, profileFile()),
    warnings: res.warnings,
  };
}

// tier set <fast|standard|strict>：
//   fast：必填 --reason（非空）+ --hours（clamp 1..8 折算 minutes 1..480），等价 fast on 全套贷款语义；
//   standard/strict：只写档位，不动 fast 窗口（贷款是债务不是档位——正交，显式 fast off 或到期才清）。
export function tierSet(target, { reason, hours } = {}) {
  if (!BUILTIN_TIERS.includes(target)) {
    return { ok: false, code: 'TIER_UNKNOWN', message: `未知档位 ${JSON.stringify(target)}（三内置档：fast|standard|strict——自定义档 v1 不开放）` };
  }
  if (target !== 'fast') {
    const fast = fastStatus();
    writeSessionTier(target, {});
    return {
      ok: true, tier: target, effective: resolveTier().effective,
      fastWindow: fast.enabled ? 'still-open（tier set 不清贷款——档位与贷款正交，显式 fast off 或到期才清）' : 'closed',
    };
  }
  if (reason === undefined || reason === true || !String(reason).trim()) {
    return { ok: false, code: 'TIER_REASON_REQUIRED', message: 'tier set fast 必填 --reason（非空）：贷款必须有债务人与事由——无期限无债务人的贷款永远无法偿还' };
  }
  const raw = Number(hours);
  if (hours === undefined || hours === true || !Number.isFinite(raw)) {
    return { ok: false, code: 'TIER_HOURS_REQUIRED', message: 'tier set fast 必填 --hours（clamp 1..8，折算 minutes 1..480）：贷款必须有期限' };
  }
  const clamped = Math.min(8, Math.max(1, Math.round(raw)));
  let loan;
  try {
    loan = fastSet(true, { minutes: clamped * 60, reason: String(reason) });
  } catch (e) {
    return { ok: false, code: 'FAST_STATE_ERROR', message: String(e?.message ?? e) };
  }
  writeSessionTier('fast', { reason: String(reason).trim(), hours: clamped });
  const eff = resolveTier();
  return {
    ok: true, tier: 'fast', effective: eff.effective,
    raisedBy: eff.raisedBy,
    hoursRequested: raw, hoursApplied: clamped,
    clamped: raw !== clamped ? `${raw} → ${clamped}（clamp 1..8）` : null,
    minutes: clamped * 60, windowId: loan.windowId,
    note: 'fast 档=贷款窗口（DEBT 语义不变）；地板规则（三性/不可逆保护）窗口内照旧恒 block',
  };
}
