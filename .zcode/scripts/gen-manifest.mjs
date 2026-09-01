#!/usr/bin/env node
// 生成/校验 FRAMEWORK-MANIFEST（薄壳，实现在 .zcode/lib/doctor.mjs 的 manifest 段）。用法：node .zcode/scripts/gen-manifest.mjs [check]
import { generate, check } from '../lib/doctor.mjs';

const mode = process.argv[2] || 'generate';
if (mode === 'check') {
  const res = check();
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 3);
}
console.log(JSON.stringify(generate(), null, 2));
