// feedback 引擎化（cursor 移植）：教训库是评审可读的文件而非数据库，但契约破坏
// （错 frontmatter/重复 id）与「复发 ≥3 未毕业」必须机器发现——不靠自觉。
// 契约：.zcode/feedback/<id>.md frontmatter 含 id（=文件名）/ occurrences（正整数）/
// graduated（bool）。复发时递增 occurrences 更新而非写重复文件；毕业 = 提升为被执法的
// 东西（规则/检查/命令）且须用户确认，文件保留作「规则为何存在」的档案。
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.mjs';
import { parseFrontmatter } from './skillslint.mjs';

const RESERVED = new Set(['FEEDBACK-INDEX.md']); // 索引非条目

export function parseFeedback() {
  const dir = DIRS.feedback;
  const entries = [];
  const errors = [];
  if (!fs.existsSync(dir)) return { entries, errors };
  const boolish = new Set(['true', 'false']);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !RESERVED.has(f)).sort();
  const seenIds = new Map();
  for (const f of files) {
    const file = path.join(dir, f);
    const relFile = path.relative(dir, file);
    const stem = f.replace(/\.md$/, '');
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm.ok) { errors.push({ file: relFile, code: 'BAD_FRONTMATTER', message: fm.reason }); continue; }
    const { id, occurrences, graduated } = fm.data;
    if (!id) errors.push({ file: relFile, code: 'NO_ID', message: 'frontmatter 缺 id' });
    else if (id !== stem) errors.push({ file: relFile, code: 'ID_MISMATCH', message: `frontmatter id "${id}" ≠ 文件名 "${stem}"——id 即文件名，双轨必漂移` });
    if (occurrences === undefined) errors.push({ file: relFile, code: 'NO_OCCURRENCES', message: 'frontmatter 缺 occurrences（正整数）' });
    else if (!/^\d+$/.test(String(occurrences).trim()) || Number(occurrences) < 1) errors.push({ file: relFile, code: 'BAD_OCCURRENCES', message: `occurrences "${occurrences}" 非正整数` });
    if (graduated === undefined) errors.push({ file: relFile, code: 'NO_GRADUATED', message: 'frontmatter 缺 graduated（true/false）' });
    else if (!boolish.has(String(graduated).trim())) errors.push({ file: relFile, code: 'BAD_GRADUATED', message: `graduated "${graduated}" 非 bool` });
    const idKey = id || stem;
    if (seenIds.has(idKey)) errors.push({ file: relFile, code: 'DUPLICATE_ID', message: `id "${idKey}" 与 ${seenIds.get(idKey)} 重复` });
    else seenIds.set(idKey, relFile);
    entries.push({
      id: idKey,
      file: relFile,
      occurrences: /^\d+$/.test(String(occurrences || '')) ? Number(occurrences) : null,
      graduated: String(graduated || '').trim() === 'true',
    });
  }
  return { entries, errors };
}

// feedback lint：契约破坏 exit 1（ERROR 而非 FINDINGS——契约是结构问题不是检查发现）
export function feedbackLint() {
  const { entries, errors } = parseFeedback();
  return {
    command: 'feedback lint',
    ok: errors.length === 0,
    entries: entries.length,
    errors,
  };
}

// feedback list：毕业候选（occurrences ≥3 未毕业）——进化引擎不被饿死的机器发现
export const GRADUATION_THRESHOLD = 3;
export function graduationCandidates() {
  const { entries } = parseFeedback();
  return entries.filter((e) => e.occurrences !== null && e.occurrences >= GRADUATION_THRESHOLD && !e.graduated);
}

export function feedbackList() {
  const candidates = graduationCandidates();
  return {
    command: 'feedback list',
    candidates,
    counts: { entries: parseFeedback().entries.length, candidates: candidates.length },
    advice: candidates.length
      ? `${candidates.length} 条教训复发 ≥${GRADUATION_THRESHOLD} 未毕业：派 evolution-runner 评估毕业（优先毕业为检查/命令而非常驻文本——检查不触发零成本，提示词每次请求都付费）`
      : '无待毕业教训',
  };
}
