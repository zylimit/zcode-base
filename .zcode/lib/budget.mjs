// 变更爆炸半径预算（Task 7.9，源 dsh assessBudget）：超预算不禁止，但必须拆分变更或记 ADR 显式升级。
// 四指标：changedFiles ≤40 / changedLines（numstat 累加）≤1500 / modulesTouched（impact 直接受影响模块）≤3 / newFiles（untracked）≤25。
// 限额可由 harness.json budget 段覆盖（默认值见 config.mjs DEFAULTS）。
import { loadHarnessConfig } from './config.mjs';
import { statusPaths, numstat } from './git.mjs';
import { analyze } from './impact.mjs';

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
