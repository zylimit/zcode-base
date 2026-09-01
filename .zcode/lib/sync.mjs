// 三文件同步执法（Task 7.10，源 dsh syncCheck + cc A2）：项目记忆不得落后代码；Spec 与 CHANGELOG 成对。
// 双缝共用本判定：git pre-commit（--staged 仅 index）与 Stop 事件（工作树+untracked 合集）。
// 判定：
//   ① MEMORY_BEHIND_CODE（error）：governed 代码路径变了而 progress.md 不在变更集；
//   ② SPEC_WITHOUT_CHANGELOG（error）：Product-Spec*.md 非 CHANGELOG 变了而同窗无 Product-Spec-CHANGELOG.md
//      （仅当两份文件都在盘上时执法——「文件存在即维护，不存在的不强造」）；反向 CHANGELOG_WITHOUT_SPEC 为 warning。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { loadCatalog, classify } from './catalog.mjs';
import { statusPaths } from './git.mjs';

const STATE_PREFIXES = ['.zcode/state/', '.zbase/'];

// governed 代码：有 catalog 时按归类（module/catchall/overlap）；无 catalog 时按启发式（非 .md 且非纯文档面）。
function isGovernedCode(catalog, p) {
  if (p.endsWith('.md')) return false;
  if (STATE_PREFIXES.some((s) => p.startsWith(s))) return false;
  if (catalog) {
    const c = classify(catalog, p);
    return c.kind === 'module' || c.kind === 'catchall' || c.kind === 'overlap';
  }
  return true;
}

export function syncCheck({ staged = false } = {}) {
  const s = statusPaths();
  const paths = [...new Set(staged ? s.staged : [...s.staged, ...s.unstaged, ...s.untracked])]
    .filter((p) => !STATE_PREFIXES.some((pre) => p.startsWith(pre)));
  const catalog = loadCatalog();
  const errors = [];
  const warnings = [];

  // ① 代码脏而账本不脏（progress.md 在盘上才执法——「文件存在即维护，不存在的不强造」；
  //    不存在时降为提示：建议建立，不强造也不阻断）
  const codeChanged = paths.filter((p) => isGovernedCode(catalog, p));
  if (codeChanged.length > 0 && !paths.includes('progress.md')) {
    if (fs.existsSync(path.join(ROOT, 'progress.md'))) {
      errors.push({ code: 'MEMORY_BEHIND_CODE', changed: codeChanged.length, note: `${codeChanged.length} 个 governed 代码路径已变更而 progress.md 未同步——三文件同步铁律：决策/约束/完成即时写 progress.md` });
    } else {
      warnings.push({ code: 'LEDGER_NOT_CREATED', changed: codeChanged.length, note: `${codeChanged.length} 个 governed 代码路径已变更而仓内无 progress.md——建议建立项目记忆（宪法：文件存在即维护）` });
    }
  }

  // ② Spec 与 CHANGELOG 成对（两份都在盘上才执法；缺 CHANGELOG 文件 → warning 提示建立）
  const specFile = 'Product-Spec.md';
  const changelogFile = 'Product-Spec-CHANGELOG.md';
  const specChanged = paths.filter((p) => /^Product-Spec.*\.md$/.test(p) && !p.includes('CHANGELOG'));
  const changelogChanged = paths.includes(changelogFile);
  const specOnDisk = fs.existsSync(path.join(ROOT, specFile));
  const changelogOnDisk = fs.existsSync(path.join(ROOT, changelogFile));
  if (specChanged.length > 0 && !changelogChanged) {
    if (changelogOnDisk) {
      errors.push({ code: 'SPEC_WITHOUT_CHANGELOG', changed: specChanged, note: `${specChanged.join(', ')} 变更而 ${changelogFile} 未同步——需求变更必须成对更新（只改一个不算完成）` });
    } else {
      warnings.push({ code: 'SPEC_NO_CHANGELOG_FILE', note: `${specChanged.join(', ')} 变更但仓内无 ${changelogFile}——建议建立并成对维护` });
    }
  }
  if (changelogChanged && !specChanged.length && specOnDisk) {
    warnings.push({ code: 'CHANGELOG_WITHOUT_SPEC', note: `${changelogFile} 单独变更（无 Spec 变更）——确认这是纯记录性更新` });
  }

  return { ok: errors.length === 0, staged, checkedPaths: paths.length, errors, warnings };
}
