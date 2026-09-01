// FRAMEWORK-MANIFEST 维护：LF 规范化 SHA-256 清单，支撑安装器安全升级。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, FILES } from './config.mjs';
import { sha256, rel, nowIso } from './common.mjs';

// 安装面（v2.0 单目录封装）：.zcode/ 整体 + 根级文件；运行态 .zcode/state/ 永不入清单。
export const SURFACE = [
  'AGENTS.md',
  '.zcode',
  'setup.sh',
  'package.json',
  'README.md',
];

const EXCLUDE_PREFIX = ['.zcode/state/'];

function walk(file, prefix = '') {
  const st = fs.statSync(file);
  if (st.isFile()) return [file];
  const out = [];
  for (const e of fs.readdirSync(file, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.tmp-')) continue;
    const childPrefix = prefix ? `${prefix}/${e.name}` : e.name;
    if (EXCLUDE_PREFIX.some((p) => `${childPrefix}/`.startsWith(p))) continue;
    out.push(...walk(path.join(file, e.name), childPrefix));
  }
  return out;
}

function fileHash(file) {
  const content = fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n');
  return sha256(content);
}

export function generate() {
  const files = {};
  for (const item of SURFACE) {
    const p = path.join(ROOT, item);
    if (!fs.existsSync(p)) continue;
    for (const f of walk(p, item)) files[rel(ROOT, f)] = fileHash(f);
  }
  const manifest = { name: 'zcode-base', version: readVersion(), algorithm: 'sha256-lf-v1', generatedAt: nowIso(), files };
  fs.writeFileSync(FILES.manifest, JSON.stringify(manifest, null, 2) + '\n');
  return { ok: true, files: Object.keys(files).length, manifest: rel(ROOT, FILES.manifest) };
}

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
}

export function check() {
  if (!fs.existsSync(FILES.manifest)) return { ok: false, reason: 'FRAMEWORK-MANIFEST.json 不存在，先 manifest generate' };
  const m = JSON.parse(fs.readFileSync(FILES.manifest, 'utf8'));
  const drift = [];
  for (const [rp, hash] of Object.entries(m.files || {})) {
    const abs = path.join(ROOT, rp);
    if (!fs.existsSync(abs)) { drift.push({ file: rp, code: 'MISSING' }); continue; }
    if (fileHash(abs) !== hash) drift.push({ file: rp, code: 'MODIFIED' });
  }
  // 新增未登记文件（安装面内）
  const known = new Set(Object.keys(m.files || {}));
  for (const item of SURFACE) {
    const p = path.join(ROOT, item);
    if (!fs.existsSync(p)) continue;
    for (const f of walk(p, item)) {
      const rp = rel(ROOT, f);
      if (!known.has(rp)) drift.push({ file: rp, code: 'UNTRACKED' });
    }
  }
  return { ok: drift.length === 0, drift, tracked: known.size };
}
