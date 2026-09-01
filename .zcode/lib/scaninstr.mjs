// scan-instructions：指令文件安全扫描——AGENTS.md/SKILL.md/commands/rules/docs/feedback
// 是宿主不经人审就自动装载的输入，属活跃攻击面（野外在 AI 指令文件中实测发现过
// 泄漏 API key 与攻击者控制的 base URL 覆写）。八规则行级扫描，security 级永不可豁免。
// 抑制：`scan-instructions:ignore` 注释（本行或上一行）——抑制留在 diff 内可见。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

// 本仓指令面：宿主会装载的一切 markdown
const TARGET_SPECS = [
  { flat: 'AGENTS.md' },
  { dir: path.join('.zcode', 'skills'), leaf: 'SKILL.md' }, // <name>/SKILL.md
  { dir: path.join('.zcode', 'commands') }, // **/*.md
  { dir: path.join('.zcode', 'rules') }, // *.md
  { dir: path.join('.zcode', 'docs') }, // **/*.md
  { dir: path.join('.zcode', 'feedback') }, // *.md
];

const RULES = [
  {
    id: 'endpoint-override', severity: 'error',
    message: '改写模型/工具端点：指令文件挪动 API base URL = 把每次请求与凭据发给读者未选择的地方',
    re: /\b(ANTHROPIC_BASE_URL|OPENAI_BASE_URL|OPENAI_API_BASE|GEMINI_BASE_URL|LLM_BASE_URL|HTTPS?_PROXY|ALL_PROXY)\b\s*[:=]/i,
  },
  {
    id: 'embedded-credential', severity: 'error',
    message: '携带凭据形态材料：指令文件会被跨仓复制、被贴进 issue——这里的 key 等于已公开',
    re: /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: 'instruction-override', severity: 'error',
    message: '试图覆盖更高权威指令：仓库文本是最低权威，主张相反的文本即注入尝试',
    re: /\b(ignore (all )?(previous|prior|above|earlier) (instructions|rules|prompts)|disregard (the )?(system|previous|above)|you are now [a-z]|forget (everything|all previous)|override (the )?(system|safety))\b/i,
  },
  {
    id: 'exfiltration-command', severity: 'error',
    message: '指示 agent 把仓库内容发往网络端点：指令文件可以讲怎么构建，没有理由讲怎么上传',
    // 前导连字符旗标前置 \b 永无边界（空格与 - 都是非词字符）——用显式 \s 定位旗标（dsh 原版此规则实测漏检 curl -d）
    re: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^\n]{0,120}\s(-d|--data|--upload-file|-F|-T|--post-file|-Method\s+Post)\b|\bnc\b\s+-[a-z]*\s*\d{1,5}\b/i,
  },
  {
    id: 'silent-execution', severity: 'error',
    message: '下载的脚本直接进 shell：必须先读后跑的东西不该以这种方式到达',
    re: /\b(curl|wget)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba)?sh\b|\biex\s*\(\s*(new-object|iwr|invoke-webrequest)/i,
  },
  {
    id: 'hidden-characters', severity: 'error',
    message: '含零宽/双向控制字符：人看不见但模型会读的文本，按构造即为逃避审查的指令',
    re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/,
  },
  {
    id: 'gate-disable-instruction', severity: 'error',
    message: '指示 agent 绕过验证：告诉 agent 跳过自家门禁的仓库是在描述漏洞而非构建',
    // --no-verify 前导连字符：\b 无边界，改 (?:^|\s) 定位（词形旗标保留 \b）
    re: /(?:^|\s)(--no-verify)\b|\b(skip[- ]?(the )?(hook|gate|check|test)s?|disable (the )?(hook|gate|lint|check)s?)\b|跳过门禁|跳过钩子|跳过检查/i,
  },
  {
    id: 'secret-file-read', severity: 'warning',
    message: '点名秘密承载路径：指令文件没有理由指向它',
    re: /(^|[\s"'\x60])(\.env(\.[a-z]+)?|id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials|\.npmrc)\b/i,
  },
];

const SUPPRESS = /scan-instructions:ignore/;
const MAX_BYTES = 1024 * 1024;

function walkMd(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

export function instructionFiles() {
  const files = [];
  for (const spec of TARGET_SPECS) {
    if (spec.flat) {
      const p = path.join(ROOT, spec.flat);
      if (fs.existsSync(p)) files.push(p);
    } else if (spec.leaf) {
      // 发现形态精确一层：<root>/<name>/SKILL.md
      const dir = path.join(ROOT, spec.dir);
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory()) continue;
        const p = path.join(dir, e.name, spec.leaf);
        if (fs.existsSync(p)) files.push(p);
      }
    } else {
      const dir = path.join(ROOT, spec.dir);
      if (fs.existsSync(dir)) files.push(...walkMd(dir));
    }
  }
  return files;
}

export function scanInstructions() {
  const targets = instructionFiles();
  const findings = [];
  for (const file of targets) {
    let text;
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_BYTES) {
        findings.push({ file: path.relative(ROOT, file), rule: 'oversized', severity: 'warning', line: 0, message: `指令文件 ${st.size} 字节超 1MB 上限，未扫描` });
        continue;
      }
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (SUPPRESS.test(lines[i]) || (i > 0 && SUPPRESS.test(lines[i - 1]))) continue;
      for (const rule of RULES) {
        if (!rule.re.test(lines[i])) continue;
        findings.push({
          file: path.relative(ROOT, file), line: i + 1, rule: rule.id, severity: rule.severity,
          message: rule.message, excerpt: lines[i].trim().slice(0, 120),
        });
      }
    }
  }
  const errors = findings.filter((f) => f.severity === 'error');
  return {
    command: 'scan-instructions',
    ok: errors.length === 0,
    scanned: targets.length,
    findings,
    counts: { error: errors.length, warning: findings.length - errors.length },
  };
}
