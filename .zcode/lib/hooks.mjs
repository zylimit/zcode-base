import fs from 'node:fs';
import path from 'node:path';
import { classifyCommand } from './classifier.mjs';
import { recap, syncCheck } from './context.mjs';
import { boundedHead, bumpStopStrike, changedPaths, DIRS, fastStatus, fingerprint, loadHarnessConfig, loadState, matchAny, ROOT, sha256, updateState } from './core.mjs';
import { latestReceipts, logGate, refreshTask } from './quality.mjs';
import { ruleMode, resolveTier, tierLine } from './tier.mjs';
import { candidateWritePaths, preflightWrites, resolveForWrite, shellWritePaths } from './writes.mjs';

// hook 统一入口：ZCode 7 事件 → 单 dispatcher（每事件一个 hook 注册，全部路由到本模块）。
// 输出契约：exit 0 + stdout {"additionalContext":"..."} 注入上下文；exit 2 + stderr 阻断原因。
// v2.1：
//   - emit 出口统一脱敏 + 预算化（boundedHookOutput 递归限长，超总限裁 additionalContext，deny 文案走 stderr 永可达）
//   - PostToolUse 护栏资产软执法：引擎文件写入放行但 gate-log 记 guardrail-write + 当场播报（维护合法，静默改不合法）
//   - Stop 三振按状态分键（sha256(taskId+fingerprint+缺失清单)）：不同缺失各自计数，同键连拦 3 次→第 4 次放行交人工
// v2.2（R3b）：
//   - PreToolUse 写路径预检（Task 7.6）：工具+shell 写路径提取 / symlink 逃逸 / ownedPaths 闸 / knownHashes 并发冲突
//   - PostToolUse 成功写后 refreshTask 更新基线与 touchedPaths
//   - SessionStart 切 recap 预算化注入 + A4 脏树校准 + A5 待毕业 feedback 播报（Task 7.12）
//   - Stop 门聚合三文件同步（Task 7.10 cc A2）：dirty 树代码变更而 progress 未同步 → 拦停先同步；
//     recorder 豁免 = .zcode/state/.progress-recording 标志 或 progress.md 最近 2 秒被改（防异步写入窗口死锁）
// v2.4（R8a，tier 档位盘）：
//   - deny 单一收敛口接 ruleMode 三出口：block=现状 deny / advise=提醒+gate-log advise（不计三振）/ off=skip-tier 留痕；
//     effective 档每进程 resolveTier 现算一次（治理面脏树自动 strict）；地板规则任何档恒 block；standard=全 block 零回归

async function readStdin() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

// ---------- hook 输出预算 ----------
const HOOK_OUTPUT_LIMIT = 4000;

// 递归限长：字符串 ≤min(limit,3000)、数组 ≤20、对象逐值——任何一层都不超预算
function limitStrings(value, limit) {
  if (typeof value === 'string') return boundedHead(value, Math.min(limit, 3000));
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => limitStrings(v, limit));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, limitStrings(v, limit)]));
  }
  return value;
}

// emit 前过预算：超总限先裁 additionalContext；仍超给通用兜底文案（deny 走 stderr，永不受此影响）
export function boundedHookOutput(output) {
  if (!output || typeof output !== 'object') return output;
  const limited = limitStrings(output, HOOK_OUTPUT_LIMIT);
  if (JSON.stringify(limited).length <= HOOK_OUTPUT_LIMIT) return limited;
  if (typeof limited.additionalContext === 'string') {
    limited.additionalContext = boundedHead(limited.additionalContext, Math.max(100, HOOK_OUTPUT_LIMIT - 300));
    if (JSON.stringify(limited).length <= HOOK_OUTPUT_LIMIT) return limited;
  }
  return { additionalContext: '[zcode-base] hook 输出超预算限制，原上下文已省略（HOOK_OUTPUT_LIMIT）' };
}

function emit(context, onDelivered) {
  if (!context || !context.trim()) process.exit(0);
  process.stdout.write(JSON.stringify(boundedHookOutput({ additionalContext: context })) + '\n');
  // R9-P3-3（E2）：先送达后记账——stdout 写出成功（未抛错）才回调 onDelivered；
  // 写失败抛错则不回调（崩溃可见，指纹不落）。「已记账未送达」的旧时序会让用户永远见不到该行。
  if (onDelivered) onDelivered();
  process.exit(0);
}

// ---------- R8a tier 档位盘（hook 侧唯一消费点） ----------
// 本 hook 进程启动时 resolveTier 解析一次（含治理面脏树 raise——改判官的人自动挨最严审查）。
// effective 只换出口强度：block=现状 deny 路径；advise=同判定逻辑跑、命中改出提醒不拦（gate-log advise，
// 不计三振）；off=跳过判定 + gate-log skip-tier（跳过要留痕不是消失）。
// 地板规则（三性红线/不可逆保护）任何档恒 block（lib/tier.mjs FLOOR_RULES）——安全护栏不在可调静音面内。
// standard=全 block=现状零回归（未列出默认 block，硬保证）。
let TIER = null;
const ADVISES = [];
const effectiveTier = () => TIER?.effective || 'standard';

// 出口合并：advise 消息与原 fallback 一次单行 JSON 输出（宿主输出契约恰一个 JSON 行；
// advise 走 systemMessage 尽力播报 + additionalContext 兜底，同 guardrail-write 形态）
function flushAdvises(fallback) {
  const context = [fallback, ...ADVISES].filter(Boolean).join('\n') || null;
  if (!context) process.exit(0);
  const payload = ADVISES.length
    ? { additionalContext: context, systemMessage: ADVISES.join('\n') }
    : { additionalContext: context };
  process.stdout.write(JSON.stringify(boundedHookOutput(payload)) + '\n');
  process.exit(0);
}

function deny(rule, reason, meta = {}) {
  const mode = ruleMode(rule, effectiveTier());
  if (mode === 'off') {
    // 跳过要留痕不是消失：tier 字段标记哪个档跳的
    logGate({ event: meta.event, tool: meta.tool, rule, action: 'skip-tier', tier: effectiveTier(), preview: meta.preview });
    return;
  }
  if (mode === 'advise') {
    // 同判定同账本，只换出口形态（业界 warn 档共识）：不拦、不计三振
    logGate({ event: meta.event, tool: meta.tool, rule, action: 'advise', tier: effectiveTier(), preview: meta.preview, reason });
    ADVISES.push(`[zbase tier-advise] ${rule}: ${reason}——档 ${effectiveTier()} 已将该规则降为提醒（本次不拦）。`);
    return;
  }
  logGate({ event: meta.event, tool: meta.tool, rule, action: 'deny', preview: meta.preview, reason });
  process.stderr.write(`[zbase 门禁] ${rule}: ${reason}\n`);
  process.exit(2); // deny 走 stderr，不受 hook 输出预算影响——拒绝永远可达
}

function observe(event, tool, rule, preview) {
  logGate({ event, tool, rule: rule || 'ok', action: 'observe', preview });
}

// ---------- 事件处理 ----------

function sessionStart(input) {
  // v2.2：注入内容改用 recap 派生摘要（预算 3600 < hook 输出预算 4000，确定性收纳）；
  // A4 脏树校准：dirty>0 注入头部提醒先对照实际改动校准 progress（压缩后无新 SessionStart，跨 session 脏树是漂移主载体）。
  const r = recap({ budget: 3600 });
  const lines = ['[zcode-base 会话恢复]', r.text];
  if (r.dirtyPaths > 0) lines.splice(1, 0, `⚠ 工作树非干净（${r.dirtyPaths} 个未提交路径）——先对照实际改动校准 progress，再继续新工作。`);
  // A5：feedback 只进不出会饿死进化引擎——未毕业条目 >0 播报
  if (r.feedbackPending > 0) lines.push(`待毕业 feedback ${r.feedbackPending} 条——考虑派 evolution-runner 评估毕业（occurrence ≥3）。`);
  const state = loadState();
  if ((state.degraded || []).length) lines.push(`degraded 状态 ${state.degraded.length} 条待处理。`);
  // R8a：tier 档位一行播报（档位+effective+raise 数；无 ISO 时钟值）
  if (TIER) lines.push(tierLine(TIER));
  emit(lines.join('\n'));
}

const FEEDBACK_SIGNALS = /(不对|错了|不是这样|别这样|应该(是|用)|又(出现|坏|错)|上次(说|改)|回归了|改坏了|我说的是|反了|重复了|还是(有|不))/;

// R9 铁律重注入：会话中段宪法已被压缩出上下文——活跃任务存在且代码指纹变化时，
// 每个新指纹只补发一行「按 invariants 校准」的锚（不是重发全文，预算纪律：单行、指纹不变只发一次）。
// 状态键 lastReinjectedFingerprint（state.json）。R9-P3-3（E2 时序整改）：先送达后记账——
// 指纹只在 emit 成功写出后由 commitReinjection 落盘；emit 抛错则不落，下轮重发一行
// （重于漏发）。指纹写回自身失败不砖 hook——重注入幂等，写不进下一轮同样重发（fail-visible 交给 gate-log）。
function reinjectionCandidate(state) {
  const active = state.activeTask ? state.tasks.find((t) => t.id === state.activeTask?.id) || null : null;
  if (!active) return null;
  const fp = fingerprint().fingerprint; // 进程内 memoize（core.fingerprint 缓存）
  if (fp === state.lastReinjectedFingerprint) return null;
  const fast = fastStatus(state);
  const hoursLeft = fast.enabled
    ? Number(Math.max(0, (new Date(fast.until).getTime() - Date.now()) / 3600_000).toFixed(1))
    : null;
  const tierPart = TIER ? `${TIER.tier}/${TIER.effective}` : 'standard/standard';
  const line = `[zbase 铁律重注入] 活跃任务：${String(active.envelope?.goal || '').slice(0, 40)}；档位 ${tierPart}；fast ${fast.enabled ? `剩余 ${hoursLeft}h` : '关'}——按 invariants 校准，别按压缩后印象走`;
  return { line, fp };
}

// 送达后记账（emit 的 onDelivered 回调）：指纹写回与 observe 留痕都在「行确实已写出 stdout」之后。
function commitReinjection({ line, fp }) {
  try {
    updateState((s) => ({ ...s, lastReinjectedFingerprint: fp }));
  } catch (e) {
    logGate({ event: 'UserPromptSubmit', rule: 'reinjection', action: 'degraded', preview: `指纹写回失败（下轮重发一行，幂等无害）：${String(e?.message ?? e).slice(0, 100)}` });
  }
  logGate({ event: 'UserPromptSubmit', rule: 'reinjection', action: 'observe', preview: line.slice(0, 120) });
}

function userPromptSubmit(input) {
  const prompt = String(input.prompt || '');
  const lines = [];
  if (FEEDBACK_SIGNALS.test(prompt)) {
    logGate({ event: 'UserPromptSubmit', rule: 'feedback-signal', action: 'observe', preview: prompt.slice(0, 120) });
    lines.push('[zcode-base] 检测到修正/反馈信号：处理完用户请求后，调用 feedback-writer skill 记录到 .zcode/feedback/（含 occurrence 计数），不靠自觉。');
  }
  // 各播报源攒行、一次 emit（宿主输出契约恰一个 JSON 行；多条提醒 newline 串接）。
  // state 同进程只读一次复用（对齐 quality.mjs status() 先例——loadState 是全量 JSON 读盘）
  const st = loadState();
  const candidate = reinjectionCandidate(st);
  if (candidate) lines.push(candidate.line);
  const fast = fastStatus(st);
  if (fast.enabled) lines.push(`[zcode-base] Fast Mode 生效中（到期 ${fast.until}），安全护栏不受影响。`);
  // R9-P3-3：emit 成功后才落指纹（onDelivered）；emit 抛错则指纹不落、下轮重发——重于漏发。
  emit(lines.length ? lines.join('\n') : null, candidate ? () => commitReinjection(candidate) : null);
}

// v2.3（R6a，Task 10.1）：
//   - checkBashCommand 正则黑名单直测替换为 shell 语义分类器（lib/classifier.mjs，四仓融合）：
//     tokenizer/wrapper 剥壳/嵌套 shell 递归/管道级秘密外传跟踪/融合参数提取/三档决策。
//     deny=exit 2；ask=放行+gate-log observe(规则)+additionalContext 提醒；内置危险 rule id 保持旧值
//     （rm-rf-root/git-reset-hard/...），项目附加正则仍走 harness.json risk.confirm（raw 串直测，opt-in）。
function checkBashCommand(event, input) {
  const cfg = loadHarnessConfig();
  const cmd = String(input.tool_input?.command || input.command || '');
  const preview = cmd.slice(0, 160);
  const verdict = classifyCommand(cmd, {
    extraDangerous: cfg.risk.confirm.dangerousCommands,
    extraSecretRead: cfg.risk.confirm.secretReadPatterns,
  });
  if (verdict.decision === 'deny') {
    // Fast Mode 不豁免安全护栏（铁律），全部硬拦——tier 面由 deny 内 ruleMode 裁：
    // 地板规则任何档恒 block；表内软规则在 fast 档降 advise（提醒+留痕不拦）/off（skip-tier 留痕）。
    // deny 走到 return 之后 = 该规则已被 tier 降级：按放行记账继续既有流程。
    deny(verdict.rule, `${verdict.reason}。需要执行请向用户说明理由并获得明确批准，或改用安全等价命令。`, { event, tool: 'Bash', preview });
  }
  if (verdict.decision === 'ask') {
    // ask 档：放行但必须人工知情——gate-log 记 observe(规则 id，喂 R6b effectiveness 计数) + 提醒注入。
    // tier off 时整条跳过（skip-tier 留痕，提醒不再注入）；advise/block 保持现状（ask 本就是提醒出口）。
    if (ruleMode(verdict.rule, effectiveTier()) === 'off') {
      logGate({ event, tool: 'Bash', rule: verdict.rule, action: 'skip-tier', tier: effectiveTier(), preview });
      // R8a P3-5：与 deny-off 落账形态统一——deny-off 经 fallthrough 天然多一行 observe('ok')，
      // ask-off 原先只有 skip-tier 单行；统一补上执行留痕行（信息多优于少，两路径形态一致）。
      observe(event, 'Bash', 'ok', preview);
      return null;
    }
    logGate({ event, tool: 'Bash', rule: verdict.rule, action: 'observe', preview });
    return `[zcode-base] 命令需人工确认（规则 ${verdict.rule}）：${verdict.reason}。`;
  }
  observe(event, 'Bash', 'ok', preview);
  return null;
}

// 归一化为仓库相对路径（供保护路径/护栏前缀匹配）；绝对路径在 .zcode（含 state/）或旧装 .zbase 之下同样提取
function toRepoRelPath(filePath) {
  const norm = String(filePath || '').replace(/\\/g, '/');
  if (!norm) return '';
  return norm.includes('/') && !norm.startsWith('.')
    ? norm.replace(/^.*?\/(\.zbase\/|\.zcode\/|\.agents\/)/, '$1')
    : norm;
}

// ---------- 护栏资产软执法（两档）----------
// 硬拦（protectedWritePaths，不动）：.zcode/state/**（账本/门禁注册）、.zcode/config.json、FRAMEWORK-MANIFEST.json。
// 软执法（本层）：引擎面写入放行，但 gate-log 记 kind=guardrail-write + 当场播报「确认此改动有意为之」——
// 维护自身是合法操作，静默改引擎才是腐败面；事后 doctor/manifest 漂移检测构成第二道闸。
const GUARDRAIL_PREFIXES = [
  '.zcode/lib/', '.zcode/zbase.mjs', '.zcode/harness/', '.zcode/rules/',
  '.zcode/skills/', '.zcode/commands/', '.zcode/feedback/', '.zcode/docs/', '.zcode/scripts/',
  'tests/', // 测试套件是证据链本体（60+ 用例锁行为）——改测试与改引擎同级留痕
];

function guardrailHit(relPath) {
  return relPath && GUARDRAIL_PREFIXES.some((p) => relPath === p.replace(/\/$/, '') || relPath.startsWith(p)) ? relPath : null;
}

// ---------- 写路径预检（Task 7.6，在既有 secret/protected 分支之上） ----------
// 提取候选 → 逐个 resolveForWrite（symlink 逃逸/出仓检测）→ preflightWrites（ownedPaths 闸 + knownHashes 并发冲突）。
// 两类越界分档：SYMLINK_ESCAPE 是安全面（仓内入口指向仓外目标），**无条件拦**；
// OUTSIDE_REPO 是任务边界执法（写目标整个在仓外），**仅在存在活跃 task 时拦**——无任务时的仓外写
// （如 echo > /tmp/probe.txt）不属任务越权，放行；受保护路径/秘密路径由既有层硬拦不受此影响。
// 拒绝原则：deny 文案指明下一步动作；预检异常 fail-visible（当 deny 处理），绝不静默放行。
function preflightWritePaths(event, tool, candidates, preview) {
  const hasActiveTask = Boolean(loadState().activeTask);
  const resolved = [];
  for (const cand of candidates) {
    try {
      resolved.push(resolveForWrite(cand));
    } catch (e) {
      const code = e?.code || 'UNSAFE_PATH';
      if (code === 'OUTSIDE_REPO' && !hasActiveTask) continue; // 无任务：仓外写放行（不进后续 ownedPaths 闸）
      deny('write-preflight', `${code === 'SYMLINK_ESCAPE' ? 'symlink 逃逸' : code === 'OUTSIDE_REPO' ? '写目标在仓外' : '不安全写路径'}：${cand}${e?.resolves ? `（解析到 ${e.resolves}）` : ''}——${code === 'OUTSIDE_REPO' ? '活跃任务的写路径必须留在仓内（任务边界）' : '写路径必须解析后仍在仓内'}。`, { event, tool, preview });
    }
  }
  const relPaths = resolved.map((r) => r.rel).filter((r) => r && !r.startsWith('..'));
  if (relPaths.length === 0) return [];
  const verdict = preflightWrites(relPaths);
  if (!verdict.ok) {
    deny(verdict.code, verdict.reason, { event, tool, preview: verdict.path });
  }
  return relPaths;
}

function checkFileWrite(event, input) {
  const cfg = loadHarnessConfig();
  const tool = input.tool_name || 'Edit';
  const filePath = String(input.tool_input?.file_path || input.tool_input?.path || input.file_path || '');
  if (filePath) {
    const norm = filePath.replace(/\\/g, '/');
    for (const sp of cfg.risk.confirm.secretWritePatterns) {
      if (new RegExp(sp).test(norm)) {
        deny('secret-write', `写入秘密路径（${filePath}）：秘密文件不入库不入上下文，用环境变量/密管服务。`, { event, tool, preview: filePath });
      }
    }
    const relPath = toRepoRelPath(norm);
    for (const pat of cfg.risk.confirm.protectedWritePaths) {
      if (matchAny(relPath, [pat]) || norm.includes(pat.replace('/**', '/'))) {
        deny('protected-write', `受保护路径（${pat}）：账本/门禁注册/安装清单由 .zcode 治理框架管理，模型不可直接改写。`, { event, tool, preview: filePath });
      }
    }
  }
  // 写路径预检：工具载荷提取（含 apply_patch 补丁解析）+ symlink 逃逸 + ownedPaths/knownHashes
  // （filePath 为空的载荷——如 apply_patch 纯补丁文本——同样必须过预检，不得短路）
  const candidates = candidateWritePaths(tool, input.tool_input);
  preflightWritePaths(event, tool, candidates, filePath.slice(0, 160) || candidates.join(',').slice(0, 160));
  observe(event, tool, 'ok', (filePath || candidates.join(',')).slice(0, 160));
}

function preToolUse(input) {
  const tool = String(input.tool_name || '');
  let askContext = null;
  if (tool === 'Bash' || tool === 'bash') {
    // ask 档上下文先挂起：写路径预检仍有机会 deny（deny 优先于 ask 播报）
    askContext = checkBashCommand('PreToolUse', input);
    // shell 写路径（重定向/tee/cp·mv 等）同过预检——无活跃任务时仅 symlink 逃逸生效
    const cmd = String(input.tool_input?.command || input.command || '');
    preflightWritePaths('PreToolUse', 'Bash', shellWritePaths(cmd), cmd.slice(0, 160));
  }
  if (/^(Edit|Write|ApplyPatch|MultiEdit|Create|Delete|Move|Rename)$/i.test(tool)) checkFileWrite('PreToolUse', input);
  if (isApplyPatchTool(tool)) checkFileWrite('PreToolUse', input);
  flushAdvises(askContext);
}

function isApplyPatchTool(toolName) {
  return /(?:^|[._-])apply_patch$/i.test(String(toolName || ''));
}

function permissionRequest(input) {
  const tool = String(input.tool_name || '');
  if (tool === 'Bash' || tool === 'bash') {
    const askContext = checkBashCommand('PermissionRequest', input);
    flushAdvises(askContext);
    return;
  }
  flushAdvises(null);
}

// 成功写后的写路径集合（与 PreToolUse 同一提取口径）
function writtenPaths(input) {
  const tool = String(input.tool_name || '');
  if (tool === 'Bash' || tool === 'bash') {
    const cmd = String(input.tool_input?.command || '');
    return shellWritePaths(cmd).map((c) => { try { return resolveForWrite(c).rel; } catch { return null; } }).filter((p) => p && !p.startsWith('..'));
  }
  return candidateWritePaths(tool, input.tool_input)
    .map((c) => { try { return resolveForWrite(c).rel; } catch { return null; } })
    .filter((p) => p && !p.startsWith('..'));
}

function postToolUse(input) {
  const tool = String(input.tool_name || '');
  if (tool === 'Bash' || tool === 'bash') {
    const cmd = String(input.tool_input?.command || '');
    observe('PostToolUse', 'Bash', 'executed', cmd.slice(0, 160));
    // 成功执行：刷新任务基线（shell 写路径），让「自己写的样子」成为新基线
    const written = writtenPaths(input);
    if (written.length && loadState().activeTask) refreshTask(written);
  } else if (/^(Edit|Write|ApplyPatch|MultiEdit|Create|Delete|Move|Rename)$/i.test(tool) || isApplyPatchTool(tool)) {
    const written = writtenPaths(input);
    // 成功写入（失败走 PostToolUseFailure 事件）命中引擎面 → 软执法：放行 + 留痕 + 播报
    const hits = written.map((p) => guardrailHit(p)).filter(Boolean);
    if (hits.length) {
      logGate({ event: 'PostToolUse', tool, kind: 'guardrail-write', rule: 'guardrail-asset-write', action: 'guardrail-write', preview: hits.join(', ') });
      // systemMessage 字段尽力播报（宿主若不支持该键，additionalContext 兜底可见）
      const msg = `[zcode-base] 护栏资产已被修改：${hits.join(', ')}。请确认此改动有意为之——引擎面变更应有对应派单，doctor/manifest 将标记漂移。`;
      process.stdout.write(JSON.stringify(boundedHookOutput({ additionalContext: msg, systemMessage: msg })) + '\n');
      if (written.length && loadState().activeTask) refreshTask(written);
      process.exit(0);
    }
    if (written.length && loadState().activeTask) refreshTask(written);
    observe('PostToolUse', tool, 'ok', written.join(',').slice(0, 160));
  }
  flushAdvises(null);
}

function postToolUseFailure(input) {
  observe('PostToolUseFailure', String(input.tool_name || ''), 'failed', String(input.tool_input?.command || input.tool_input?.file_path || '').slice(0, 160));
  flushAdvises(null);
}

// ---------- Stop 门 ----------
// 三层聚合：①三文件同步（A2）②新鲜回执（R1 起）③三振按状态分键（R3a）。
// recorder 豁免：progress-recorder 异步写 progress 的窗口内不拦同步门（cc 已知坑：recorder 未写完时闸会拦，
// 造成死锁）——标志文件 .zcode/state/.progress-recording 或 progress.md 最近 2 秒被修改任一成立即视为记录中。
function recorderActive() {
  if (fs.existsSync(path.join(DIRS.state, '.progress-recording'))) return true;
  try {
    return Date.now() - fs.statSync(path.join(ROOT, 'progress.md')).mtimeMs < 2000;
  } catch { return false; }
}

const STOP_STRIKE_LIMIT = 3;

function stopBlock(state, fp, missing, reason, rule) {
  const taskId = state.activeTask?.id || 'no-task';
  const key = sha256(`${taskId}\0${fp}\0${JSON.stringify(missing)}`);
  const { count, over } = bumpStopStrike(key, STOP_STRIKE_LIMIT);
  if (over) {
    logGate({ event: 'Stop', kind: 'stop-release', rule, action: 'stop-release', preview: `三振键 ${key.slice(0, 12)} 连拦 ${STOP_STRIKE_LIMIT} 次后放行` });
    emit(`[zcode-base Stop 门] 同一缺失状态已连拦 ${STOP_STRIKE_LIMIT} 次，本次放行：需人工审查（${reason}）。`);
  }
  logGate({ event: 'Stop', rule, action: 'deny', preview: reason.slice(0, 160) });
  // R8a P3-4：block 出口前不丢已积累的 advise 播报（账本行本就在；stderr 附加行不解除阻断——
  // exit 2 语义不变，advise 只是随行可见，不能因拦截而静默）。
  process.stderr.write(`[zbase Stop 门] ${reason}\n三振 ${count}/${STOP_STRIKE_LIMIT}（按缺失清单分键计数）。\n`);
  if (ADVISES.length) process.stderr.write(`${ADVISES.join('\n')}\n`);
  process.exit(2);
}

function stop() {
  const paths = changedPaths();
  if (paths.length === 0) flushAdvises(null);

  // ① 三文件同步门（共用 syncCheck 判定函数；recorder 写入窗口豁免）。
  // R8a tier 面：block=现状 stopBlock（exit 2+三振）；advise=留痕+提醒不拦不计三振；off=skip-tier 留痕跳过。
  const sync = syncCheck();
  if (sync.errors.length > 0 && !recorderActive()) {
    const syncReason = `三文件同步欠账：${sync.errors.map((e) => `${e.code}（${e.note}）`).join('；')}\n先同步 progress.md / Product-Spec-CHANGELOG.md 再结束会话。`;
    const syncMode = ruleMode('three-file-sync', effectiveTier());
    if (syncMode === 'off') {
      logGate({ event: 'Stop', rule: 'three-file-sync', action: 'skip-tier', tier: effectiveTier(), preview: syncReason.slice(0, 160) });
    } else if (syncMode === 'advise') {
      logGate({ event: 'Stop', rule: 'three-file-sync', action: 'advise', tier: effectiveTier(), preview: syncReason.slice(0, 160) });
      ADVISES.push(`[zbase tier-advise] three-file-sync: ${syncReason}——档 ${effectiveTier()} 已将该规则降为提醒（本次不拦、不计三振）。`);
    } else {
      const state0 = loadState();
      const fp0 = fingerprint();
      stopBlock(
        state0, fp0,
        { sync: sync.errors.map((e) => e.code), paths: [...paths].sort() },
        syncReason,
        'three-file-sync',
      );
    }
  }

  const receipts = latestReceipts({ fresh: true });
  const fp = fingerprint();
  if (receipts.size > 0 && !fp.truncated) {
    // 有新鲜回执：信任账本，放行
    flushAdvises(null);
  }
  const state = loadState();
  const gateReason = `检测到 ${paths.length} 个未提交/未验证变更路径，且账本无覆盖当前代码状态（fingerprint）的新鲜回执。\n请完成受影响验证并落回执：node .zcode/zbase.mjs receipt write --check <name> --status PASS --note "<证据>"；或向用户说明跳过理由。`;
  const gateMode = ruleMode('stop-gate', effectiveTier());
  if (gateMode === 'off') {
    logGate({ event: 'Stop', rule: 'stop-gate', action: 'skip-tier', tier: effectiveTier(), preview: gateReason.slice(0, 160) });
    flushAdvises(null);
  }
  if (gateMode === 'advise') {
    logGate({ event: 'Stop', rule: 'stop-gate', action: 'advise', tier: effectiveTier(), preview: gateReason.slice(0, 160) });
    ADVISES.push(`[zbase tier-advise] stop-gate: ${gateReason}——档 ${effectiveTier()} 已将回执门降为提醒（本次不拦、不计三振；补验落回执仍是债务纪律）。`);
    flushAdvises(null);
  }
  stopBlock(
    state, fp,
    { paths: [...paths].sort() },
    gateReason,
    'stop-gate',
  );
}

export async function handle(event) {
  const input = await readStdin();
  // R8a：每 hook 进程解析一次 effective 档（含治理面脏树 raise，现算无状态——提交后自然回落）；
  // 解析自身失败不得砖 hook（TIER=null → effectiveTier 回落 standard=现状全拦，fail-closed 永不弱于任何档）
  // ——但降级必须留痕（纪律 7 失败必须可见）：best-effort 落 gate-log degraded 行；logGate 自身失败不再二度
  // 兜底（递归兜底会遮蔽原始错误，静默降级才是要修的缺陷）。
  try {
    TIER = resolveTier();
  } catch (e) {
    TIER = null;
    try {
      logGate({ event, rule: 'tier-resolve', action: 'degraded', preview: String(e?.message ?? e).slice(0, 160) });
    } catch { /* 留痕 best-effort：原始降级方向不变 */ }
  }
  switch (event) {
    case 'session-start':
    case 'SessionStart': return sessionStart(input);
    case 'user-prompt-submit':
    case 'UserPromptSubmit': return userPromptSubmit(input);
    case 'pre-tool-use':
    case 'PreToolUse': return preToolUse(input);
    case 'permission-request':
    case 'PermissionRequest': return permissionRequest(input);
    case 'post-tool-use':
    case 'PostToolUse': return postToolUse(input);
    case 'post-tool-use-failure':
    case 'PostToolUseFailure': return postToolUseFailure(input);
    case 'stop':
    case 'Stop': return stop();
    default:
      process.stderr.write(`[zbase] 未知 hook 事件：${event}\n`);
      process.exit(1);
  }
}
