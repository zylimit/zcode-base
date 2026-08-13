// context pack：预算化上下文打包。DENY 路径永不入包；只打印 manifest，全文落盘。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS } from './config.mjs';
import { rel, isBinaryFile, human, nowIso, matchAny } from './common.mjs';
import { analyze } from './impact.mjs';
import { capsulePath } from './catalog.mjs';

// 秘密/依赖/构建产物/harness 自身运行时永不入包。
const DENY = [
  '.git/**', '.zbase/**', 'node_modules/**', '**/node_modules/**',
  '.env', '.env.*', '**/.env', '**/.env.*', '**/*.key', '**/*.pem', '**/.ssh/**',
  '**/dist/**', '**/build/**', '**/coverage/**', '**/__pycache__/**',
  '**/*.lock', '**/package-lock.json',
];

export function pack({ changed, budget } = {}) {
  const cfg = {
    totalChars: budget?.totalChars || 120000,
    fileChars: budget?.fileChars || 20000,
    maxFiles: budget?.maxFiles || 40,
  };
  const imp = analyze({ changed });
  const manifest = { generatedAt: nowIso(), budget: cfg, impact: { degraded: imp.degraded, reasons: imp.reasons }, files: [], truncated: false, denied: 0 };

  // 优先级：task diff 文件 > 受影响模块胶囊 > 公共契约 > diff 同目录文档
  const candidates = [];
  const push = (abs, priority, reason) => {
    const r = rel(ROOT, abs);
    if (r.startsWith('..')) return;
    if (matchAny(r, DENY)) { manifest.denied++; return; }
    candidates.push({ abs, r, priority, reason });
  };

  for (const p of changed) push(path.join(ROOT, p), 0, 'task-diff');
  if (imp.ok) {
    for (const m of imp.fanout) {
      const cap = capsulePath(m);
      if (fs.existsSync(cap)) push(cap, 1, `capsule:${m}`);
    }
    push(path.join(ROOT, 'harness', 'module-catalog.json'), 2, 'catalog');
    push(path.join(ROOT, 'harness', 'verification-matrix.json'), 2, 'verification-matrix');
    const docDirs = new Set(changed.map((p) => path.dirname(p)));
    for (const d of docDirs) {
      for (const cand of ['README.md', 'AGENTS.md']) {
        const abs = path.join(ROOT, d, cand);
        if (fs.existsSync(abs)) push(abs, 3, 'nearby-doc');
      }
    }
  }

  // 去重 + 按优先级排序 + 预算裁剪
  const seen = new Set();
  const uniq = candidates.filter((c) => (seen.has(c.r) ? false : (seen.add(c.r), true)));
  uniq.sort((a, b) => a.priority - b.priority || a.r.localeCompare(b.r));

  let total = 0;
  const packParts = [];
  for (const c of uniq) {
    if (manifest.files.length >= cfg.maxFiles) { manifest.truncated = true; break; }
    let content;
    try {
      if (!fs.existsSync(c.abs) || isBinaryFile(c.abs)) continue;
      const stat = fs.statSync(c.abs);
      if (stat.size > cfg.fileChars * 4) { manifest.truncated = true; continue; }
      content = fs.readFileSync(c.abs, 'utf8');
    } catch { continue; }
    if (content.length > cfg.fileChars) content = content.slice(0, cfg.fileChars) + '\n... [truncated]';
    if (total + content.length > cfg.totalChars) { manifest.truncated = true; break; }
    total += content.length;
    manifest.files.push({ path: c.r, chars: content.length, reason: c.reason });
    packParts.push(`### ${c.r} (${c.reason})\n\n\`\`\`\n${content}\n\`\`\`\n`);
  }
  manifest.totalChars = total;

  fs.mkdirSync(path.join(DIRS.state, 'context'), { recursive: true });
  const outFile = path.join(DIRS.state, 'context', `pack-${Date.now()}.md`);
  fs.writeFileSync(outFile, `# Context Pack ${manifest.generatedAt}\n\n${packParts.join('\n')}`);
  manifest.packFile = rel(ROOT, outFile);
  manifest.packSize = human(fs.statSync(outFile).size);
  return manifest;
}
