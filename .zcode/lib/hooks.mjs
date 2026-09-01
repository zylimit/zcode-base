// hook 统一入口：ZCode 7 事件 → 单 dispatcher（每事件一个 hook 注册，全部路由到本模块）。
// 输出契约：exit 0 + stdout {"additionalContext":"..."} 注入上下文；exit 2 + stderr 阻断原因。
// v2.1：
//   - emit 出口统一脱敏 + 预算化（boundedHookOutput 递归限长，超总限裁 additionalContext，deny 文案走 stderr 永可达）
//   - PostToolUse 护栏资产软执法：引擎文件写入放行但 gate-log 记 guardrail-write + 当场播报（维护合法，静默改不合法）
//   - Stop 三振按状态分键（sha256(taskId+fingerprint+缺失清单)）：不同缺失各自计数，同键连拦 3 次→第 4 次放行交人工
import { logGate } from './audit.mjs';
import { loadHarnessConfig } from './config.mjs';
import { matchAny, sha256, boundedHead } from './common.mjs';
import { changedPaths, fingerprint } from './git.mjs';
import { loadState, fastStatus, bumpStopStrike } from './state.mjs';
import { latestReceipts } from './receipts.mjs';

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

function emit(context) {
  if (!context || !context.trim()) process.exit(0);
  process.stdout.write(JSON.stringify(boundedHookOutput({ additionalContext: context })) + '\n');
  process.exit(0);
}

function deny(rule, reason, meta = {}) {
  logGate({ event: meta.event, tool: meta.tool, rule, action: 'deny', preview: meta.preview, reason });
  process.stderr.write(`[zbase 门禁] ${rule}: ${reason}\n`);
  process.exit(2); // deny 走 stderr，不受 hook 输出预算影响——拒绝永远可达
}

function observe(event, tool, rule, preview) {
  logGate({ event, tool, rule: rule || 'ok', action: 'observe', preview });
}

// ---------- 事件处理 ----------

function sessionStart(input) {
  const state = loadState();
  const fast = fastStatus(state);
  const lines = ['[zcode-base 会话恢复]'];
  const active = state.tasks.find((t) => t.id === state.activeTask?.id);
  if (active) {
    lines.push(`活跃任务 ${active.id}（${active.risk}）：${active.envelope.goal}`);
    lines.push('恢复步骤：读 progress.md 尾部 → node .zcode/zbase.mjs task status → 检查 baselineDrift（true 则旧证据已腐化，需重验）。');
  } else {
    lines.push('无活跃任务。新任务先读宪法 AGENTS.md 与 .zcode/rules/workflow.md。');
  }
  if (fast.enabled) lines.push(`⚠ Fast Mode 生效中（贷款 ${fast.minutes}min，到期 ${fast.until}，windowId ${fast.windowId}）：质量流程放水，security/safety/privacy 照旧硬拦；SKIPPED 仅在本窗口有效，task finish 前须补验偿贷。`);
  if ((state.degraded || []).length) lines.push(`degraded 状态 ${state.degraded.length} 条待处理。`);
  emit(lines.join('\n'));
}

const FEEDBACK_SIGNALS = /(不对|错了|不是这样|别这样|应该(是|用)|又(出现|坏|错)|上次(说|改)|回归了|改坏了|我说的是|反了|重复了|还是(有|不))/;

function userPromptSubmit(input) {
  const prompt = String(input.prompt || '');
  if (FEEDBACK_SIGNALS.test(prompt)) {
    logGate({ event: 'UserPromptSubmit', rule: 'feedback-signal', action: 'observe', preview: prompt.slice(0, 120) });
    emit('[zcode-base] 检测到修正/反馈信号：处理完用户请求后，调用 feedback-writer skill 记录到 .zcode/feedback/（含 occurrence 计数），不靠自觉。');
  }
  const fast = fastStatus();
  if (fast.enabled) emit(`[zcode-base] Fast Mode 生效中（到期 ${fast.until}），安全护栏不受影响。`);
  emit(null);
}

function checkBashCommand(event, input) {
  const cfg = loadHarnessConfig();
  const cmd = String(input.tool_input?.command || input.command || '');
  const preview = cmd.slice(0, 160);
  const fast = fastStatus().enabled;
  for (const { rule, pattern } of cfg.risk.confirm.dangerousCommands) {
    const re = new RegExp(pattern);
    if (re.test(cmd)) {
      // Fast Mode 不豁免安全护栏（铁律），全部硬拦
      deny(rule, `危险命令模式命中（规则 ${rule}）。需要执行请向用户说明理由并获得明确批准，或改用安全等价命令。`, { event, tool: 'Bash', preview });
    }
  }
  for (const sp of cfg.risk.confirm.secretReadPatterns) {
    if (new RegExp(sp).test(cmd)) {
      deny('secret-read', `命令疑似读取秘密路径（${sp}）。密钥/凭据不入上下文：请改用环境变量引用，勿 cat/读取内容。`, { event, tool: 'Bash', preview });
    }
  }
  observe(event, 'Bash', 'ok', preview);
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
];

function guardrailHit(relPath) {
  return relPath && GUARDRAIL_PREFIXES.some((p) => relPath === p.replace(/\/$/, '') || relPath.startsWith(p)) ? relPath : null;
}

function checkFileWrite(event, input) {
  const cfg = loadHarnessConfig();
  const filePath = String(input.tool_input?.file_path || input.tool_input?.path || input.file_path || '');
  if (!filePath) return;
  const norm = filePath.replace(/\\/g, '/');
  for (const sp of cfg.risk.confirm.secretWritePatterns) {
    if (new RegExp(sp).test(norm)) {
      deny('secret-write', `写入秘密路径（${filePath}）：秘密文件不入库不入上下文，用环境变量/密管服务。`, { event, tool: input.tool_name || 'Edit', preview: filePath });
    }
  }
  const relPath = toRepoRelPath(norm);
  for (const pat of cfg.risk.confirm.protectedWritePaths) {
    if (matchAny(relPath, [pat]) || norm.includes(pat.replace('/**', '/'))) {
      deny('protected-write', `受保护路径（${pat}）：账本/门禁注册/安装清单由 .zcode 治理框架管理，模型不可直接改写。`, { event, tool: input.tool_name || 'Edit', preview: filePath });
    }
  }
  observe(event, input.tool_name || 'Edit', 'ok', filePath.slice(0, 160));
}

function preToolUse(input) {
  const tool = String(input.tool_name || '');
  if (tool === 'Bash' || tool === 'bash') checkBashCommand('PreToolUse', input);
  if (/^(Edit|Write|ApplyPatch|MultiEdit)$/i.test(tool)) checkFileWrite('PreToolUse', input);
  emit(null);
}

function permissionRequest(input) {
  const tool = String(input.tool_name || '');
  if (tool === 'Bash' || tool === 'bash') checkBashCommand('PermissionRequest', input);
  emit(null);
}

function postToolUse(input) {
  const tool = String(input.tool_name || '');
  if (tool === 'Bash' || tool === 'bash') {
    const cmd = String(input.tool_input?.command || '');
    observe('PostToolUse', 'Bash', 'executed', cmd.slice(0, 160));
  } else if (/^(Edit|Write|ApplyPatch|MultiEdit)$/i.test(tool)) {
    // 成功写入（失败走 PostToolUseFailure 事件）命中引擎面 → 软执法：放行 + 留痕 + 播报
    const filePath = String(input.tool_input?.file_path || input.tool_input?.path || '');
    const hit = guardrailHit(toRepoRelPath(filePath.replace(/\\/g, '/')));
    if (hit) {
      logGate({ event: 'PostToolUse', tool, kind: 'guardrail-write', rule: 'guardrail-asset-write', action: 'guardrail-write', preview: hit });
      // systemMessage 字段尽力播报（宿主若不支持该键，additionalContext 兜底可见）
      const msg = `[zcode-base] 护栏资产已被修改：${hit}。请确认此改动有意为之——引擎面变更应有对应派单，doctor/manifest 将标记漂移。`;
      process.stdout.write(JSON.stringify(boundedHookOutput({ additionalContext: msg, systemMessage: msg })) + '\n');
      process.exit(0);
    }
    observe('PostToolUse', tool, 'ok', filePath.slice(0, 160));
  }
  emit(null);
}

function postToolUseFailure(input) {
  observe('PostToolUseFailure', String(input.tool_name || ''), 'failed', String(input.tool_input?.command || input.tool_input?.file_path || '').slice(0, 160));
  emit(null);
}

// Stop 门：有未提交改动且无覆盖当前 fingerprint 的新鲜回执 → 请求继续。
// 三振按状态分键：key = sha256(taskId+fingerprint+缺失清单 JSON)——不同缺失各自计数（修好一项不误耗另一项额度），
// 清单变化 → 新键从零计。同键连拦 ≥3 次 → 第 4 次显式放行 + 播报「需人工审查，任务仍未完成」+ gate-log 记 stop-release。
const STOP_STRIKE_LIMIT = 3;

function stop() {
  const paths = changedPaths();
  if (paths.length === 0) emit(null);
  const receipts = latestReceipts({ fresh: true });
  const fp = fingerprint();
  if (receipts.size > 0 && !fp.truncated) {
    // 有新鲜回执：信任账本，放行
    emit(null);
  }
  const state = loadState();
  const taskId = state.activeTask?.id || 'no-task';
  const key = sha256(`${taskId}\0${fp.fingerprint}\0${JSON.stringify([...paths].sort())}`);
  const { count, over } = bumpStopStrike(key, STOP_STRIKE_LIMIT);
  if (over) {
    logGate({ event: 'Stop', kind: 'stop-release', rule: 'stop-gate', action: 'stop-release', preview: `${paths.length} 个未验证路径，三振键 ${key.slice(0, 12)} 连拦 ${STOP_STRIKE_LIMIT} 次后放行` });
    emit(`[zcode-base Stop 门] 同一缺失状态已连拦 ${STOP_STRIKE_LIMIT} 次，本次放行：需人工审查，任务仍未完成（${paths.length} 个变更路径无新鲜回执）。`);
  }
  logGate({ event: 'Stop', rule: 'stop-gate', action: 'deny', preview: `${paths.length} 个变更路径无新鲜回执` });
  process.stderr.write(`[zbase Stop 门] 检测到 ${paths.length} 个未提交/未验证变更路径，且账本无覆盖当前代码状态（fingerprint）的新鲜回执。\n请完成受影响验证并落回执：node .zcode/zbase.mjs receipt write --check <name> --status PASS --note "<证据>"；或向用户说明跳过理由。三振 ${count}/${STOP_STRIKE_LIMIT}（按缺失清单分键计数）。\n`);
  process.exit(2);
}

export async function handle(event) {
  const input = await readStdin();
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
