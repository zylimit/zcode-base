// skills-lint：skill 发现契约机器校验——防「skill 写了但被宿主整丢/永不触发」的静默失效。
// 吸收 dsh skillsLint（frontmatter 完整性/命名/体积/重复）+ cc skill-description-lint ③④
// （触发式描述：描述若以流程总结作主体而无触发条件，模型读摘要跳正文导致漏触发）。
// 阈值沿用 dsh 数字：description >500 error（目录截断）、>220 warning；SKILL.md >24000B warning。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_CAP = 500; // error：宿主目录截断阈值
const DESCRIPTION_SOFT = 220; // warning：每个会话每次请求都为它付费
const SKILL_LARGE_BYTES = 24000;

// 手写 frontmatter 解析：引号剥壳、块标量（>- | > | |-）折叠、缩进续行。
// 不引 YAML 依赖（零依赖红线），只解析 skill 契约需要的扁平键值形态。
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { ok: false, reason: '缺 YAML frontmatter（须以 --- 开头）' };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { ok: false, reason: 'frontmatter 未闭合（缺结束 ---）' };
  const raw = text.slice(3, end).replace(/^\r?\n/, '');
  const lines = raw.split('\n');
  const data = {};
  let key = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (m) {
      key = m[1];
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
      if (['>', '|', '>-', '|-', '>+', '|+'].includes(v)) {
        // 块标量：续读后续缩进行（折叠 > 拼空格；字面 | 拼换行——长度语义一致）
        const literal = v.startsWith('|');
        const block = [];
        i++;
        while (i < lines.length) {
          const nxt = lines[i];
          if (nxt.trim() === '') { i++; continue; } // 块内空行：长度语义忽略
          if (!/^\s/.test(nxt)) break; // 回到顶层键，块结束
          block.push(nxt.trim());
          i++;
        }
        data[key] = literal ? block.join('\n') : block.join(' ');
        continue;
      }
      data[key] = v;
    } else if (key && /^\s+\S/.test(line)) {
      data[key] = (data[key] ? `${data[key]} ` : '') + line.trim();
    }
    i++;
  }
  return { ok: true, data, raw };
}

// 触发条件信号（③）：「当…时」「…时(必须/应当)使用」「由…调用」或以 当/由 开头。
export function hasTrigger(desc) {
  if (/当[^。；\n]{1,40}时/.test(desc)) return true;
  if (/由[^。；\n]{1,30}调用/.test(desc)) return true;
  if (/时[^\s。；，]{0,3}使用/.test(desc)) return true;
  return desc.startsWith('当') || desc.startsWith('由');
}

// 流程总结词（④）：无触发条件时，这些词作主体开头 = 描述在总结流程而非告知何时触发。
const WORKFLOW_SUMMARY_TOKENS = ['生成', '支持', '分阶段', '输出', '执行', '维护'];

export function skillsLint(roots = null) {
  const scanRoots = roots || [path.join(ROOT, '.zcode', 'skills')];
  const findings = [];
  const skills = [];
  for (const dir of scanRoots) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory()) continue; // 发现形态只认 <name>/SKILL.md
      const skillDir = path.join(dir, e.name);
      const file = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(file)) {
        findings.push({ file: `${path.relative(ROOT, skillDir)}`, severity: 'error', code: 'NO_SKILL_MD', message: 'skill 目录无 SKILL.md——宿主只发现 <name>/SKILL.md，目录等于不存在' });
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.ok) { findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'BAD_FRONTMATTER', message: fm.reason }); continue; }
      const meta = fm.data;
      if (!meta.name) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NO_NAME', message: 'frontmatter 缺 name' });
      else {
        if (!KEBAB.test(meta.name)) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NAME_NOT_KEBAB', message: `skill name "${meta.name}" 须 kebab-case（宿主拒绝其他形态）` });
        if (meta.name !== e.name) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NAME_MISMATCH', message: `frontmatter name "${meta.name}" ≠ 目录名 "${e.name}"——发现与装载不一致即失效` });
      }
      if (!meta.description) {
        findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'NO_DESCRIPTION', message: 'frontmatter 缺 description——它是模型看到的唯一路由信号' });
      } else {
        if (meta.description.length > DESCRIPTION_CAP) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'DESCRIPTION_TOO_LONG', message: `description ${meta.description.length} 字符，超目录截断阈值 ${DESCRIPTION_CAP}` });
        else if (meta.description.length > DESCRIPTION_SOFT) findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'DESCRIPTION_LONG', message: `description ${meta.description.length} 字符（>${DESCRIPTION_SOFT}）：每个会话每次请求都为它付费` });
        // ③ 触发式描述：无触发条件 → warning（skill 可能永不触发）
        if (!hasTrigger(meta.description)) {
          findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'DESCRIPTION_NO_TRIGGER', message: 'description 无触发条件（当…时使用/由…调用）——模型读摘要跳正文，skill 会静默漏触发' });
          // ④ 无触发条件时禁流程总结词作主体
          const hits = WORKFLOW_SUMMARY_TOKENS.filter((t) => meta.description.startsWith(t));
          if (hits.length) findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'DESCRIPTION_SUMMARY_SUBJECT', message: `description 以流程总结词「${hits.join('、')}」开头作主体且无触发条件——在总结流程而非告知何时触发` });
        }
      }
      for (const k of Object.keys(meta)) {
        if (/^[a-z]+[A-Z]/.test(k)) findings.push({ file: path.relative(ROOT, file), severity: 'error', code: 'CAMEL_CASE_KEY', message: `frontmatter 键 "${k}" 是 camelCase——宿主整丢该 skill（只认 kebab-case 键）` });
      }
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > SKILL_LARGE_BYTES) findings.push({ file: path.relative(ROOT, file), severity: 'warning', code: 'SKILL_LARGE', message: `skill ${bytes} 字节超 ${SKILL_LARGE_BYTES}：加载即全额付费，细节移 references/ 并链接` });
      skills.push({ name: meta.name || e.name, file: path.relative(ROOT, file), bytes, descriptionChars: (meta.description || '').length });
    }
  }
  const names = skills.map((s) => s.name);
  for (const n of [...new Set(names.filter((x, i) => names.indexOf(x) !== i))]) {
    findings.push({ severity: 'error', code: 'DUPLICATE_SKILL', message: `重名 skill "${n}"：近层静默遮蔽远层` });
  }
  const errors = findings.filter((f) => f.severity === 'error');
  return {
    ok: errors.length === 0,
    skills,
    findings,
    counts: { skills: skills.length, error: errors.length, warning: findings.length - errors.length },
  };
}
