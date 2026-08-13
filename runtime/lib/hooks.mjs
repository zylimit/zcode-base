// hook 统一入口：ZCode 7 事件 → 单 dispatcher（每事件一个 hook 注册，全部路由到本模块）。
// 输出契约：exit 0 + stdout {"additionalContext":"..."} 注入上下文；exit 2 + stderr 阻断原因。
import { logGate } from './audit.mjs';
import { loadHarnessConfig } from './config.mjs';
import { matchAny } from './common.mjs';
import { changedPaths, fingerprint } from './git.mjs';
import { loadState, fastStatus, bumpStopCount } from './state.mjs';
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

function emit(context) {
  if (context && context.trim()) process.stdout.write(JSON.stringify({ additionalContext: context }) + '\n');
  process.exit(0);
}

function deny(rule, reason, meta = {}) {
  logGate({ event: meta.event, tool: meta.tool, rule, action: 'deny', preview: meta.preview, reason });
  process.stderr.write(`[zbase 门禁] ${rule}: ${reason}\n`);
  process.exit(2);
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
    lines.push('恢复步骤：读 progress.md 尾部 → node runtime/zbase.mjs task status → 检查 baselineDrift（true 则旧证据已腐化，需重验）。');
  } else {
    lines.push('无活跃任务。新任务先读宪法 AGENTS.md 与 rules/workflow.md。');
  }
  if (fast.enabled) lines.push(`⚠ Fast Mode 生效中，到期 ${fast.expiresAt}：质量流程放水，security/safety 照旧硬拦。`);
  if ((state.degraded || []).length) lines.push(`degraded 状态 ${state.degraded.length} 条待处理。`);
  emit(lines.join('\n'));
}

const FEEDBACK_SIGNALS = /(不对|错了|不是这样|别这样|应该(是|用)|又(出现|坏|错)|上次(说|改)|回归了|改坏了|我说的是|反了|重复了|还是(有|不))/;

function userPromptSubmit(input) {
  const prompt = String(input.prompt || '');
  if (FEEDBACK_SIGNALS.test(prompt)) {
    logGate({ event: 'UserPromptSubmit', rule: 'feedback-signal', action: 'observe', preview: prompt.slice(0, 120) });
    emit('[zcode-base] 检测到修正/反馈信号：处理完用户请求后，调用 feedback-writer skill 记录到 .agents/feedback/（含 occurrence 计数），不靠自觉。');
  }
  const fast = fastStatus();
  if (fast.enabled) emit(`[zcode-base] Fast Mode 生效中（到期 ${fast.expiresAt}），安全护栏不受影响。`);
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
  // 归一化为仓库相对路径后做 glob 匹配；绝对路径在 .zbase/.zcode 之下同样命中
  const relPath = norm.includes('/') && !norm.startsWith('.')
    ? norm.replace(/^.*?\/(\.zbase\/|\.zcode\/|\.agents\/)/, '$1')
    : norm;
  for (const pat of cfg.risk.confirm.protectedWritePaths) {
    if (matchAny(relPath, [pat]) || norm.includes(pat.replace('/**', '/'))) {
      deny('protected-write', `受保护路径（${pat}）：账本/门禁注册/安装清单由 runtime 管理，模型不可直接改写。`, { event, tool: input.tool_name || 'Edit', preview: filePath });
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
  }
  emit(null);
}

function postToolUseFailure(input) {
  observe('PostToolUseFailure', String(input.tool_name || ''), 'failed', String(input.tool_input?.command || input.tool_input?.file_path || '').slice(0, 160));
  emit(null);
}

// Stop 门：有未提交改动且无覆盖当前 fingerprint 的新鲜回执 → 请求继续（自计数封顶 2，ZCode 原生上限 3）。
function stop() {
  const paths = changedPaths();
  if (paths.length === 0) emit(null);
  const receipts = latestReceipts({ fresh: true });
  const fp = fingerprint();
  if (receipts.size > 0 && !fp.truncated) {
    // 有新鲜回执：信任账本，放行
    emit(null);
  }
  const { count, over } = bumpStopCount(2);
  if (over) {
    logGate({ event: 'Stop', rule: 'stop-gate', action: 'exhausted', preview: `${paths.length} 个未验证路径，续命计数耗尽放行` });
    emit(null);
  }
  logGate({ event: 'Stop', rule: 'stop-gate', action: 'deny', preview: `${paths.length} 个变更路径无新鲜回执` });
  process.stderr.write(`[zbase Stop 门] 检测到 ${paths.length} 个未提交/未验证变更路径，且账本无覆盖当前代码状态（fingerprint）的新鲜回执。\n请完成受影响验证并落回执：node runtime/zbase.mjs receipt write --check <name> --status PASS --note "<证据>"；或向用户说明跳过理由。续命计数 ${count}/2。\n`);
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
