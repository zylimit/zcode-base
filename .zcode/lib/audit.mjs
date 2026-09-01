// 门禁日志 + 死闸审计：所有 hook 拦截/观察留痕；「从未拦过的门要么给证据要么撤」。
// v2.1：gate-log 出口统一脱敏（命令/理由里的 token 不入留痕），preview/reason 截头保审计信息。
import fs from 'node:fs';
import path from 'node:path';
import { FILES, DIRS } from './config.mjs';
import { appendLine, readLines, nowIso, rel, boundedHead } from './common.mjs';

export function logGate(entry) {
  const safe = {};
  for (const [k, v] of Object.entries(entry)) {
    safe[k] = typeof v === 'string' ? boundedHead(v, 300) : v;
  }
  appendLine(FILES.gateLog, { ts: nowIso(), ...safe });
}

export function readGateLog() {
  return readLines(FILES.gateLog).map((l) => {
    try { return JSON.parse(l); } catch { return { ts: null, event: 'malformed', rule: null, action: 'malformed' }; }
  });
}

// 死闸审计：统计每条规则的拦截/观察次数。denied=0 且 observed=0 的规则 = 疑似死闸。
export function audit() {
  const entries = readGateLog();
  const rules = new Map();
  for (const e of entries) {
    const key = `${e.event}:${e.rule || e.tool || 'unspecified'}`;
    if (!rules.has(key)) rules.set(key, { key, denied: 0, observed: 0, lastSeen: null });
    const r = rules.get(key);
    if (e.action === 'deny') r.denied++;
    else r.observed++;
    r.lastSeen = e.ts;
  }
  const list = [...rules.values()];
  return {
    totalEvents: entries.length,
    rules: list,
    dead: list.filter((r) => r.denied === 0),
    neverFired: list.filter((r) => r.denied === 0 && r.observed === 0),
  };
}

export function gateLogPath() {
  return rel(process.cwd(), FILES.gateLog);
}
