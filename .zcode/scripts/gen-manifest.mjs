#!/usr/bin/env node
// FRAMEWORK-MANIFEST 生成/校验（CI/分发面独立验证器——E1-1 审计独立性禁边，kimi ADR-0002 轻量版）。
//
// 刻意双实现：本文件**不得 import .zcode/lib/***（tests/independence.test.mjs 静态钉死 +
// module-catalog forbidden 边 installer→lib-*（arch check FORBIDDEN_EDGE）双执法）——
// 引擎缺陷无法让审计沉默。引擎侧同型实现在 .zcode/lib/doctor.mjs manifest 段
// （`zbase manifest generate|check` 走引擎面，CI gate.yml 用引擎路径）。
// 两实现刻意保持字节兼容（同一输出形态 + 同一 LF 归一化 sha256 口径），
// 漂移由 tests/independence.test.mjs「双实现互证」用例互锁（独立产物引擎 check 必过）。
// 改动任一侧时同步另一侧——双实现的维护成本是反共谋的代价，不是可还的债。
//
// 用法：node .zcode/scripts/gen-manifest.mjs [check]
//   无参 = generate（写 FRAMEWORK-MANIFEST.json，exit 0）
//   check = 校验（漂移 exit 3——对齐 zbase manifest check 的 FINDINGS 语义）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');

// 安装面（与引擎 doctor.mjs SURFACE 同源的独立副本——禁 import 拿）：
// .zcode/ 整体 + 根级文件；运行态 state/ 与角色记忆 agent-memory/ 永不入清单。
const SURFACE = ['AGENTS.md', '.zcode', 'docs', 'setup.sh', 'package.json', 'README.md'];
const EXCLUDE_PREFIX = ['.zcode/state/', '.zcode/agent-memory/'];

function walkManifest(file, prefix = '') {
  const st = fs.statSync(file);
  if (st.isFile()) return [file];
  const out = [];
  for (const e of fs.readdirSync(file, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.tmp-')) continue;
    const childPrefix = prefix ? `${prefix}/${e.name}` : e.name;
    if (EXCLUDE_PREFIX.some((p) => `${childPrefix}/`.startsWith(p))) continue;
    out.push(...walkManifest(path.join(file, e.name), childPrefix));
  }
  return out;
}

const relRoot = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
// LF 归一化哈希（与引擎同口径）：内容一致性忽略行尾风格（CRLF checkout 不误报漂移）
const fileHash = (file) => crypto.createHash('sha256')
  .update(fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n')).digest('hex');

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
}

function generate() {
  const files = {};
  for (const item of SURFACE) {
    const p = path.join(ROOT, item);
    if (!fs.existsSync(p)) continue;
    for (const f of walkManifest(p, item)) files[relRoot(f)] = fileHash(f);
  }
  const manifest = { name: 'zcode-base', version: readVersion(), algorithm: 'sha256-lf-v1', generatedAt: new Date().toISOString(), files };
  fs.writeFileSync(path.join(ROOT, 'FRAMEWORK-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { ok: true, files: Object.keys(files).length, manifest: 'FRAMEWORK-MANIFEST.json' };
}

function check() {
  const manifestPath = path.join(ROOT, 'FRAMEWORK-MANIFEST.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, reason: 'FRAMEWORK-MANIFEST.json 不存在，先 manifest generate' };
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
    for (const f of walkManifest(p, item)) {
      const rp = relRoot(f);
      if (!known.has(rp)) drift.push({ file: rp, code: 'UNTRACKED' });
    }
  }
  return { ok: drift.length === 0, drift, tracked: known.size };
}

const mode = process.argv[2] || 'generate';
if (mode === 'check') {
  const res = check();
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 3);
}
console.log(JSON.stringify(generate(), null, 2));
