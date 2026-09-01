// 证据留存：按策略销毁过期留痕；deny 记录窗口加倍保留（审计需要拦截历史）。
import fs from 'node:fs';
import path from 'node:path';
import { FILES, DIRS, loadHarnessConfig } from './config.mjs';
import { readLines, nowIso } from './common.mjs';

export function prune({ days } = {}) {
  const cfg = loadHarnessConfig();
  const gateDays = days ?? cfg.retention.gateLogDays;
  const results = { gateLog: { removed: 0, kept: 0 }, contextPacks: { removed: 0 }, at: nowIso() };

  const cutoff = Date.now() - gateDays * 86400_000;
  const denyCutoff = Date.now() - gateDays * 2 * 86400_000;
  const lines = readLines(FILES.gateLog);
  const kept = [];
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      const ts = new Date(e.ts || 0).getTime();
      const keep = e.action === 'deny' ? ts > denyCutoff : ts > cutoff;
      if (keep) kept.push(l); else results.gateLog.removed++;
    } catch { results.gateLog.removed++; }
  }
  results.gateLog.kept = kept.length;
  if (results.gateLog.removed > 0) {
    fs.mkdirSync(DIRS.state, { recursive: true });
    fs.writeFileSync(FILES.gateLog, kept.length ? kept.join('\n') + '\n' : '');
  }

  // 过期上下文包清理（保留最新 3 份）
  const ctxDir = path.join(DIRS.state, 'context');
  if (fs.existsSync(ctxDir)) {
    const packs = fs.readdirSync(ctxDir).filter((f) => f.startsWith('pack-')).sort();
    for (const f of packs.slice(0, Math.max(0, packs.length - 3))) {
      fs.unlinkSync(path.join(ctxDir, f));
      results.contextPacks.removed++;
    }
  }
  return results;
}
