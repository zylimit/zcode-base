import fs from 'node:fs';
import path from 'node:path';
import { loadState, matchAny, ROOT, sha256 } from './core.mjs';

// 写路径预检（Task 7.6，源 codex §1.4 + cursor §3）：把「最小副作用/保护现有改动」从 prompt 约束变机器闸。
//   a) 工具写路径提取：按工具名（write/edit/create/delete/move/multiEdit）+ 路径键递归提取；apply_patch 补丁文本解析。
//   b) shell 写路径提取：重定向目标 / tee·touch·mkdir·rm 操作数 / cp·mv 末操作数 / PowerShell Set-Content -Path、Copy-Item -Destination。
//   c) symlink 逃逸检测：对每个存在的祖先 realpath，解析后必须仍在仓内（防 symlink 链跳出）。
//   d) ownedPaths 闸：活跃 task 下写路径不在信封内 → deny（任务外写路径）。
//   e) knownHashes 并发冲突检测：task start 逐文件 digest 基线；写前比对——存在但不在基线 = 任务外进程已改动；
//      哈希≠基线 = 任务外并发改动（基线由 PostToolUse refreshTask 在成功写后更新）。
// 无活跃 task 时 d/e 不生效，仅 c) symlink 逃逸 + 受保护路径硬拦（hooks.mjs 既有层）。

// ---------- a) 工具写路径提取 ----------

// apply_patch 补丁文本：*** Add/Update/Delete File: 行
export function patchPaths(patch) {
  const result = [];
  const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  for (const match of String(patch ?? '').matchAll(pattern)) result.push(match[1].trim());
  return [...new Set(result)];
}

export function isApplyPatchTool(toolName) {
  return /(?:^|[._-])apply_patch$/i.test(toolName);
}

const WRITE_TOOL_RE = /(?:write|edit|create|delete|remove|move|rename|copy|multiedit|apply_patch)/i;

// 按工具名模式 + 路径键集合递归提取（值可能是嵌套对象/数组）
export function candidateWritePaths(toolName, toolInput) {
  if (isApplyPatchTool(toolName)) {
    const patch = typeof toolInput === 'string'
      ? toolInput
      : toolInput?.patch ?? toolInput?.command ?? toolInput?.input;
    return patchPaths(patch);
  }
  if (!toolInput || typeof toolInput !== 'object') return [];
  if (!WRITE_TOOL_RE.test(toolName)) return [];
  const pathKeys = new Set(['path', 'paths', 'file', 'files', 'filepath', 'filepaths', 'target', 'targets', 'destination', 'destinations', 'to', 'literalpath', 'destinationpath', 'dir', 'directory', 'from']);
  const result = [];
  const visit = (value, key = '') => {
    const normalizedKey = key.replace(/[-_]/g, '').toLowerCase();
    if (typeof value === 'string' && pathKeys.has(normalizedKey)) result.push(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(toolInput);
  return [...new Set(result)];
}

// ---------- b) shell 写路径提取（轻量 tokenizer：引号状态机 + 操作符切分） ----------

function shellTokens(command) {
  const tokens = [];
  let value = '';
  let quote = null;
  let dynamic = false;
  const push = () => {
    if (value) tokens.push({ kind: 'word', value, dynamic });
    value = '';
    dynamic = false;
  };
  const text = String(command ?? '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else {
        if (c === '$' || c === '`') dynamic = true;
        value += c;
      }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s/.test(c)) {
      push();
      if (c === '\n' || c === '\r') tokens.push({ kind: 'op', value: ';' });
      continue;
    }
    if (c === '>' || c === ';' || c === '|' || c === '&' || c === '<') {
      push();
      const pair = text.slice(i, i + 2);
      if (pair === '>>' || pair === '||' || pair === '&&' || pair === '<<') i += 1;
      tokens.push({ kind: c === '>' ? 'redirect' : 'op', value: pair === '>>' || pair === '||' || pair === '&&' || pair === '<<' ? pair : c });
      continue;
    }
    if (c === '$' || c === '`' || c === '*' || c === '?') dynamic = true;
    value += c;
  }
  push();
  return tokens;
}

function shellSegments(command) {
  const segments = [[]];
  for (const token of shellTokens(command)) {
    if (token.kind === 'op') segments.push([]);
    else segments.at(-1).push(token);
  }
  return segments.filter((s) => s.length);
}

function commandName(segment) {
  const first = segment.find((t) => t.kind === 'word');
  return first ? path.basename(first.value).toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/i, '') : '';
}

// 静态路径：非动态展开、非旗标、非 ~/%VAR% 形态；
// /dev/null 等设备汇与伪文件系统不是文件写目标（`cmd > /dev/null 2>&1` 是最高频的合法形态，不得误拦）
const DEV_SINK_RE = '^/dev/(null|zero|full|random|urandom|tty|stdin|stdout|stderr)$';
function staticPath(token) {
  if (!token || token.kind !== 'word' || token.dynamic || !token.value || token.value.startsWith('-')) return null;
  if (/^%[^%]+%$/.test(token.value) || token.value.startsWith('~')) return null;
  if (new RegExp(DEV_SINK_RE).test(token.value) || /^\/(proc|sys|dev\/fd)\//.test(token.value)) return null;
  return token.value;
}

function operands(segment) {
  return segment.filter((t) => t.kind === 'word').slice(1).filter((t) => !t.value.startsWith('-'));
}

// PowerShell 命名参数取值：-Path <v> / -Path=<v>
function parameterValues(words, names) {
  const result = [];
  for (let i = 1; i < words.length; i++) {
    const m = words[i].value.match(/^-([A-Za-z]+)(?:=|:)(.+)$/);
    if (m && names.has(m[1].toLowerCase())) result.push({ ...words[i], value: m[2] });
    else if (names.has(words[i].value.replace(/^-/, '').toLowerCase()) && words[i + 1]) result.push(words[++i]);
  }
  return result;
}

export function shellWritePaths(command) {
  const result = [];
  const add = (token) => {
    const value = staticPath(token);
    if (value) result.push(value);
  };
  const tokens = shellTokens(command);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'redirect' && tokens[i + 1]?.kind === 'word' && tokens[i].value !== '<') add(tokens[i + 1]);
  }
  for (const segment of shellSegments(command)) {
    const name = commandName(segment);
    const words = segment.filter((t) => t.kind === 'word');
    if (name === 'tee' || name === 'touch' || name === 'mkdir' || name === 'rm' || name === 'del') operands(segment).forEach(add);
    else if (name === 'cp' || name === 'mv' || name === 'copy' || name === 'move') add(operands(segment).at(-1));
    else if (name === 'set-content' || name === 'add-content' || name === 'out-file' || name === 'new-item') {
      const named = parameterValues(words, new Set(['path', 'literalpath', 'filepath']));
      (named.length ? named : operands(segment).slice(0, 1)).forEach(add);
    } else if (name === 'copy-item' || name === 'move-item') {
      const named = parameterValues(words, new Set(['destination', 'destinationpath']));
      (named.length ? named : operands(segment).slice(-1)).forEach(add);
    } else if (name === 'remove-item') {
      const named = parameterValues(words, new Set(['path', 'literalpath']));
      (named.length ? named : operands(segment)).forEach(add);
    }
  }
  return [...new Set(result)];
}

// ---------- c) symlink 逃逸检测 ----------

const isInside = (parent, child) => {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

// 解析写目标：相对路径按仓根解析；找最深的存在祖先 realpath（非存在尾段不可能是指向仓外的 symlink），
// 解析结果必须仍在仓内。返回 { abs, rel }；越界抛 { code: 'SYMLINK_ESCAPE'|'OUTSIDE_REPO', target }。
export function resolveForWrite(inputPath, root = ROOT) {
  const abs = path.resolve(root, String(inputPath));
  let realRoot = root;
  try { realRoot = fs.realpathSync(root); } catch { /* 根不存在（极端）：按字面根比较 */ }
  if (!isInside(realRoot, abs)) throw { code: 'OUTSIDE_REPO', target: inputPath };
  let cursor = abs;
  while (true) {
    try {
      const existing = fs.realpathSync(cursor); // ENOENT → 上溯一级
      if (!isInside(realRoot, existing)) throw { code: 'SYMLINK_ESCAPE', target: inputPath, resolves: existing };
      return { abs, rel: path.relative(root, abs).split(path.sep).join('/') };
    } catch (e) {
      if (e && typeof e === 'object' && e.code !== 'ENOENT') throw e; // escape/OUTSIDE 直接上抛；其他错误可见
      const parent = path.dirname(cursor);
      if (parent === cursor) throw { code: 'UNSAFE_PATH', target: inputPath };
      cursor = parent;
    }
  }
}

// ---------- 文件指纹（symlink 不跟随——只记链接目标，绝不读内容） ----------

export function fileDigest(absPath) {
  try {
    const st = fs.lstatSync(absPath);
    if (st.isSymbolicLink()) return `symlink:${fs.readlinkSync(absPath)}`;
    if (!st.isFile()) return `${st.mode}:${st.size}`;
    return sha256(fs.readFileSync(absPath));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// ---------- d+e) ownedPaths 闸 + knownHashes 并发冲突（活跃 task 时） ----------

// 路径是否被信封 ownedPaths 覆盖：字面路径按相等/前缀目录；含通配符的按 glob 匹配
// （派单 Scope 惯用 'src/**' 形态，ownedPaths 两种都接受）
export function pathOwned(ownedPaths, relPath) {
  const target = String(relPath).replace(/\/+$/, '');
  return (ownedPaths || []).some((owned) => {
    const o = String(owned).replace(/\/+$/, '');
    if (/[*?]/.test(o)) return matchAny(target, [o]);
    return target === o || target.startsWith(`${o}/`);
  });
}

// 写前预检。返回 { ok: true } 或 { ok: false, code, reason, path }。
// code：TASK_SCOPE（任务外写路径）/ TASK_NEW_FILE_CONFLICT（存在但不在基线）/ TASK_CONCURRENT_CHANGE（哈希≠基线）。
// 旧任务（R3b 之前创建，无 knownHashes 基线）只走 d) scope 闸，e) 并发检测降级跳过。
export function preflightWrites(relPaths, { state = loadState() } = {}) {
  const active = state.tasks.find((t) => t.id === state.activeTask?.id);
  if (!active) return { ok: true, task: null }; // 无活跃任务：d/e 不生效（symlink 逃逸已在调用方先行）
  const hasBaseline = active.baseline && typeof active.baseline.knownHashes === 'object';
  for (const rel of relPaths) {
    if (!pathOwned(active.ownedPaths, rel)) {
      return { ok: false, code: 'TASK_SCOPE', path: rel, reason: `任务外写路径 ${rel}：不在任务 ${active.id} 的 ownedPaths（${active.ownedPaths.join(', ')}）内——重启任务圈定该路径，或交回主 Agent 升级派单` };
    }
    if (!hasBaseline) continue;
    const known = active.baseline.knownHashes[rel];
    const current = fileDigest(path.join(ROOT, rel));
    if (current === null) continue; // 尚不存在 → 新建，无并发语义
    if (known === undefined || known === null) {
      return { ok: false, code: 'TASK_NEW_FILE_CONFLICT', path: rel, reason: `任务外进程已改动 ${rel}：文件存在但不在任务基线（start 后被外部创建/修改）——先核对内容，重启任务或升级处理` };
    }
    if (known !== current) {
      return { ok: false, code: 'TASK_CONCURRENT_CHANGE', path: rel, reason: `任务外并发改动 ${rel}：当前内容哈希≠任务基线（有任务外进程写过）——先协调冲突再写，禁止直接覆盖他人改动` };
    }
  }
  return { ok: true, task: active };
}
