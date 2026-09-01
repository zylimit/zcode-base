// harness 配置装载：.zcode/harness/harness.json + 目录定位。
// v2.0 单目录封装：脚手架本体全部收进 .zcode/，运行态在 .zcode/state/（gitignored）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectRoot, readJson } from './common.mjs';

export const ROOT = projectRoot();

export const DIRS = {
  zcode: path.join(ROOT, '.zcode'),
  harness: path.join(ROOT, '.zcode', 'harness'),
  runtime: path.join(ROOT, '.zcode', 'lib'),
  scripts: path.join(ROOT, '.zcode', 'scripts'),
  state: path.join(ROOT, '.zcode', 'state'),
  feedback: path.join(ROOT, '.zcode', 'feedback'),
  skills: path.join(ROOT, '.zcode', 'skills'),
  commands: path.join(ROOT, '.zcode', 'commands', 'zbase'),
  docs: path.join(ROOT, '.zcode', 'docs'),
  adr: path.join(ROOT, '.zcode', 'docs', 'adr'),
  rules: path.join(ROOT, '.zcode', 'rules'),
};

export const FILES = {
  catalog: path.join(DIRS.harness, 'module-catalog.json'),
  matrix: path.join(DIRS.harness, 'verification-matrix.json'),
  harnessConfig: path.join(DIRS.harness, 'harness.json'),
  manifest: path.join(ROOT, 'FRAMEWORK-MANIFEST.json'),
  progress: path.join(ROOT, 'progress.md'),
  ledger: path.join(DIRS.state, 'ledger.jsonl'),
  gateLog: path.join(DIRS.state, 'gate-log.jsonl'),
  state: path.join(DIRS.state, 'state.json'),
  waivers: path.join(DIRS.state, 'waivers.json'),
  archBaseline: path.join(DIRS.state, 'arch-baseline.json'),
};

const DEFAULTS = {
  version: 1,
  risk: {
    confirm: {
      // HIGH 档命令模式：出现即建议人工审批（hook 侧硬拦 + 留痕）
      dangerousCommands: [
        { rule: 'rm-rf-root', pattern: '\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf[a-zA-Z]*)\\s+(/|~|\\$HOME|\\*)' },
        { rule: 'git-force-push', pattern: '\\bgit\\s+push\\s+[^#]*?(--force(?![\\w-])|--force-plus=|-f(?![\\w-]))' },
        { rule: 'git-reset-hard', pattern: '\\bgit\\s+reset\\s+--hard' },
        { rule: 'git-clean', pattern: '\\bgit\\s+clean\\s+[^#]*-f' },
        { rule: 'chmod-777', pattern: '\\bchmod\\s+(-R\\s+)?777' },
        { rule: 'broad-kill', pattern: '\\b(pkill|killall)\\b' },
        { rule: 'mkfs-dd-disk', pattern: '\\b(mkfs|fdisk)\\b|\\bdd\\s+[^#]*of=/dev/' },
        { rule: 'fork-bomb', pattern: ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:' },
        { rule: 'sudo', pattern: '(^|[\\s;|&])sudo\\b' },
        { rule: 'curl-pipe-shell', pattern: '\\b(curl|wget)\\b[^|;]*\\|\\s*(ba)?sh\\b' },
      ],
      secretReadPatterns: ['\\.env(\\.|$)', '\\.pem$', '\\.key$', 'id_rsa', 'credentials\\.json', '\\.ssh/'],
      protectedWritePaths: ['.zcode/state/**', '.zcode/config.json', 'FRAMEWORK-MANIFEST.json'],
      secretWritePatterns: ['^\\.env', '\\.key$', '\\.pem$', '^\\.ssh/'],
    },
  },
  context: { totalChars: 120000, fileChars: 20000, diffChars: 40000, maxFiles: 40, maxTrackedPaths: 100000 },
  ledger: { maxLines: 50000 },
  retention: { evidenceDays: 30, gateLogDays: 14 },
  fast: { defaultHours: 24 },
  // 变更爆炸半径预算（budget 命令；超限不禁止但必须拆分或记 ADR 显式升级）
  budget: { maxChangedFiles: 40, maxChangedLines: 1500, maxModulesTouched: 3, maxNewFiles: 25 },
  // 项目记忆：recap 预算 / 归档保留条数 / M3 阈值（Done>m3Threshold 提示自动归档）
  memory: {
    ledger: 'progress.md', archive: 'progress.archive.md',
    keepDone: 40, keepNotes: 30, recapBudget: 6000, invariantsBudget: 1200,
    maxLedgerBytes: 24000, m3Threshold: 100,
  },
};

export function loadHarnessConfig() {
  let user = {};
  if (fs.existsSync(FILES.harnessConfig)) user = readJson(FILES.harnessConfig) || {};
  const merged = structuredClone(DEFAULTS);
  for (const k of Object.keys(user)) {
    if (user[k] && typeof user[k] === 'object' && !Array.isArray(user[k]) && typeof merged[k] === 'object' && !Array.isArray(merged[k])) {
      Object.assign(merged[k], user[k]);
    } else merged[k] = user[k];
  }
  return merged;
}

export function catalogExists() {
  return fs.existsSync(FILES.catalog);
}

// 用户级 ZCode 配置（hooks 注册面：~/.zcode/cli/config.json，无工作区 hooks 的会话级审核）。
// 经 os.homedir() 解析（POSIX 下 HOME 环境变量优先），测试可用 HOME=<临时目录> 隔离。
export function userConfigPath() {
  return path.join(os.homedir(), '.zcode', 'cli', 'config.json');
}
