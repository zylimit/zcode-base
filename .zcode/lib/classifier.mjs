// shell 语义分类器 v2（Task 10.1 / R6a，DEV-PLAN Phase 10）——四仓融合旗舰：
//   - codex-base（.codex/runtime/lib/hooks.mjs:17-339）：shellTokens 引号状态机 / effectiveWords
//     wrapper 剥壳（WRAPper_SKIP_VALUE 值旗标跳两格——「timeout 5 git reset --hard 曾被分类为名为 5 的程序」）
//     / nestedShellPayloads 嵌套递归（depth≤3）/ gitInvocation 全局选项跳格 / 融合参数提取（-d@.env、file=@id_rsa）。
//   - cursor-base（src/harness.mts:4156-4621）：sensitivePath 名单（.env 非 example/sample/template +
//     .ssh/.aws/.azure/.gnupg/.kube/.docker 目录，反斜杠折叠跨平台）/ 跨管道段外传跟踪（cat id_rsa | nc host port）
//     / 受控转义教训（本实现按 codex 不消费反斜杠，Windows 路径原样保留——分类器不执行，只识别）。
//   - cc-base（dangerous-pkill-guard）：命令执行位置锚定（(^|;|&&|\|\||`|\$\()）——语义层天然锚定：
//     只认「段的程序名 + 旗标/目标」，不认参数文本里的字符串。echo "git push --force" / grep 'rm -rf' 不误伤。
//   - zcode-base 既有行为：危险 rule id（rm-rf-root/git-reset-hard/...）与 secret-read=deny 档位保持
//     （tests/harness.test.mjs 等既有用例锁行为）；新增三档 deny/ask/allow。
//
// 决策语义（hooks.mjs 消费）：deny=exit 2 硬拦；ask=放行 + gate-log observe(rule) + additionalContext 提醒；allow=放行。
// 零依赖纯函数；单命令分类 <5ms（简单命令 tokenizer 单趟短路）。
// 规则自带测试向量：.zcode/harness/classifier-rules.json —— `node .zcode/zbase.mjs classifier lint` 自测
// （codex safety.rules 思想：规则改坏立即发现，向量即规则契约，不一致=契约破坏 exit 1）。
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './core.mjs';

const ALLOW = { decision: 'allow', rule: null, reason: null };

// ---------- A. tokenizer（codex shellTokens 移植） ----------
// 引号状态机（单/双）；$(...)、反引号、*、? 标 dynamic；换行=;；>>/||/&& 合并；>/|/;/& 分 kind。
// 反斜杠不按转义消费（cursor 教训的反向取舍：C:\Users\me\.ssh\id_rsa 必须保持可识别）。
export function shellTokens(command) {
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
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
      else {
        if (character === '$' || character === '`') dynamic = true;
        value += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      push();
      if (character === '\n' || character === '\r') tokens.push({ kind: 'op', value: ';' });
      continue;
    }
    if (character === '>' || character === ';' || character === '|' || character === '&') {
      push();
      const pair = text.slice(index, index + 2);
      if (pair === '>>' || pair === '||' || pair === '&&') index += 1;
      tokens.push({ kind: character === '>' ? 'redirect' : 'op', value: pair === '>>' || pair === '||' || pair === '&&' ? pair : character });
      continue;
    }
    if (character === '$' || character === '`' || character === '*' || character === '?') dynamic = true;
    value += character;
  }
  push();
  return tokens;
}

export function normalizeName(value) {
  return path.win32.basename(path.posix.basename(String(value ?? ''))).toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/i, '');
}

// ---------- B. wrapper 剥壳（codex effectiveWords 移植 + builtin） ----------
const WRAPPER_SKIP_VALUE = new Map([
  ['sudo', new Set(['-u', '-g', '-h', '-p', '--user', '--group'])],
  ['doas', new Set(['-u'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['ionice', new Set(['-c', '-n', '--class', '--classdata'])],
  ['stdbuf', new Set([])],
  ['timeout', new Set(['-k', '-s', '--kill-after', '--signal'])],
]);
const PLAIN_WRAPPERS = new Set(['command', 'exec', 'nohup', 'time', 'builtin']);
// ask 档用：提权壳（剥壳后程序名不再是 sudo，须在剥壳前看段首词）
const PRIVILEGE_WRAPPERS = new Set(['sudo', 'doas', 'runas']);

// 剥掉 env VAR=1 / sudo -u root / nice -n 5 / timeout -k 1 -s TERM 5 / command|exec|nohup|time，
// 让「真正的程序名与参数」露出来再做判定。
export function effectiveWords(segment) {
  const words = segment.filter((token) => token.kind === 'word');
  let index = 0;
  while (index < words.length) {
    const raw = words[index].value;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) { index += 1; continue; }
    const name = normalizeName(raw);
    if (PLAIN_WRAPPERS.has(name)) { index += 1; continue; }
    if (name === 'env') {
      index += 1;
      while (index < words.length && (words[index].value.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index].value))) index += 1;
      continue;
    }
    if (WRAPPER_SKIP_VALUE.has(name)) {
      const valueFlags = WRAPPER_SKIP_VALUE.get(name);
      index += 1;
      while (index < words.length && words[index].value.startsWith('-')) {
        index += valueFlags.has(words[index].value) ? 2 : 1;
      }
      if (name === 'timeout' && index < words.length && /^\d/.test(words[index].value)) index += 1;
      continue;
    }
    break;
  }
  return words.slice(index);
}

// ---------- C. 嵌套 shell 递归（codex nestedShellPayloads 移植） ----------
const NESTED_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'busybox']);
const NESTED_POWERSHELL = new Set(['pwsh', 'powershell']);

export function nestedShellPayloads(words) {
  if (!words.length) return [];
  const name = normalizeName(words[0].value);
  const payloads = [];
  if (NESTED_SHELLS.has(name)) {
    for (let index = 1; index < words.length - 1; index += 1) {
      if (words[index].value === '-c' || words[index].value === '-lc') payloads.push(words[index + 1].value);
    }
  }
  if (NESTED_POWERSHELL.has(name)) {
    for (let index = 1; index < words.length - 1; index += 1) {
      if (/^-c(?:ommand)?$/i.test(words[index].value)) payloads.push(words[index + 1].value);
    }
  }
  return payloads;
}

// 段切分：op（|/;/&/||/&&/换行）切段，joiner 挂在后续段上（'|' 即数据流入下一段）；
// redirect（> / >>）不切段（归属当前段，重定向目标由 writes.mjs 写预检另行执法）。
export function segmentsWithJoiners(command) {
  const segments = [{ joiner: null, tokens: [] }];
  for (const token of shellTokens(command)) {
    if (token.kind === 'op') segments.push({ joiner: token.value, tokens: [] });
    else segments.at(-1).tokens.push(token);
  }
  return segments.filter((segment) => segment.tokens.length);
}

// git 全局选项含值跳格后取子命令（git -C /repo reset --hard 与 git reset --hard 同判）。
function gitInvocation(words) {
  if (!words.length || normalizeName(words[0].value) !== 'git') return null;
  const raw = words.map((token) => token.value);
  let index = 1;
  const optionsWithValue = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path']);
  while (index < raw.length && raw[index].startsWith('-')) {
    if (optionsWithValue.has(raw[index])) index += 2;
    else index += 1;
  }
  if (index >= raw.length) return { subcommand: null, args: [] };
  return { subcommand: raw[index].toLowerCase(), args: raw.slice(index + 1) };
}

// 系统根目标：/ /* ~ ~/ ~/* 盘符根 / 动态 $HOME——rm/chmod/chown 递归作用其上即高危。
function rootishTarget(words) {
  return words.some((token) => {
    if (token.kind !== 'word' || token.value.startsWith('-')) return false;
    const value = token.value.replace(/["']/g, '');
    return value === '/' || value === '/*' || value === '*' || value === '~' || value === '~/' || value === '~/*'
      || /^[A-Za-z]:[\\/]?\*?$/.test(value)
      || (token.dynamic && /^\$(?:HOME|USERPROFILE)\/?(\*)?$/.test(value));
  });
}

// ---------- E-1. 敏感路径（cursor sensitivePath 融合 zcode 旧模式超集） ----------
// 反斜杠先折叠：安全检查的答案不能取决于跑在哪个平台。
export function sensitivePath(candidate) {
  const norm = String(candidate ?? '').replace(/\\/g, '/').toLowerCase();
  const name = norm.slice(norm.lastIndexOf('/') + 1);
  if (!name) return /(^|\/)(\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker)(\/|$)/.test(norm);
  if (/^\.env($|\.)/.test(name) && !/\.(example|sample|template)$/.test(name)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name)) return true;
  // 前缀而非全等：id_rsa.pub / credentials.prod 一并覆盖（旧 secretReadPatterns 为子串匹配，取其广度的 sane 子集）
  if (/^(id_rsa|id_ecdsa|id_ed25519|credentials|credentials\.json|secrets?\.json|service-account\.json|\.netrc|\.npmrc|\.pypirc)/.test(name)) return true;
  // 目录本身与其下任何路径（无尾分隔符 naming the directory 也算）
  return /(^|\/)(\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker)(\/|$)/.test(norm);
}

// ---------- E-2. 融合参数提取（codex secretTokens + cursor pathFragments 前缀剥离） ----------
// 一个 token 可藏多个路径形态：-d@.env / --data=@.env / file=@id_rsa / --env-file=.env / -T.env。
export function secretCandidates(tokenValue) {
  const value = String(tokenValue ?? '');
  const out = new Set([value]);
  const atMatch = value.match(/@([^@\s]+)$/);
  if (atMatch) out.add(atMatch[1]);
  const assignMatch = value.match(/^[^=\s]+=@?(.+)$/);
  if (assignMatch) out.add(assignMatch[1]);
  const stripped = value.replace(/^-{1,2}[A-Za-z0-9_-]*=?/, '');
  if (stripped && stripped !== value) out.add(stripped);
  return [...out];
}

const SECRET_READERS = new Set(['cat', 'type', 'more', 'less', 'strings', 'base64', 'xxd', 'od', 'grep', 'rg', 'awk', 'sed', 'cut', 'get-content', 'gc', 'select-string', 'findstr']);
const SECRET_COPIERS = new Set(['cp', 'copy', 'mv', 'move', 'install', 'copy-item', 'move-item']);
const EGRESS_COMMANDS = new Set(['curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'scp', 'sftp', 'ssh', 'rsync', 'ftp', 'telnet', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'start-bitstransfer', 'aws', 'az', 'gcloud', 'gsutil']);
const REMOTE_FETCHERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod', 'fetch']);
const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'iex', 'invoke-expression', 'python', 'python3', 'perl', 'ruby', 'node']);
// 出站数据载荷旗标（curl -d / wget --post-data 等，含 --data=xxx 融合连写形态）：无秘密命中时降为 ask 档
const DATA_UPLOAD_FLAGS = /^(?:-d|-F|-T|--data(?:-raw|-binary|-urlencode)?|--form(?:-string)?|--upload-file|--post-data|--post-file)(?:=|$)/;

function segmentSecrets(words) {
  const hits = [];
  for (const token of words.slice(1)) {
    if (secretCandidates(token.value).some((candidate) => sensitivePath(candidate))) hits.push(token.value);
  }
  return hits;
}

// ---------- D. 危险命令语义判定 ----------
function dangerousSegment(name, words) {
  const deny = (rule, reason) => ({ decision: 'deny', rule, reason });
  const git = gitInvocation(words);
  if (git?.subcommand === 'reset' && git.args.includes('--hard')) return deny('git-reset-hard', 'git reset --hard 可丢弃未提交工作');
  if (git?.subcommand === 'clean' && git.args.some((flag) => /^-[^-]*[fdx]/i.test(flag))) return deny('git-clean', 'git clean 带 f/d/x 删除旗标可丢弃未跟踪文件');
  if (git?.subcommand === 'push' && git.args.some((flag) => flag === '--force' || flag === '--mirror' || flag === '-f')) {
    // --force-with-lease 是不同 token，天然放行（负向保障：只有精确 --force/-f/--mirror 才拦）
    return deny('git-force-push', 'force push 可摧毁远端历史——需要时用 --force-with-lease 并获得明确批准');
  }
  const flags = words.slice(1).filter((token) => token.value.startsWith('-') || token.value.startsWith('/')).map((token) => token.value);
  const operands = words.slice(1).filter((token) => !token.value.startsWith('-') && !token.value.startsWith('/')).map((token) => token.value);
  if (name === 'rm') {
    const recursive = flags.some((flag) => flag === '--recursive' || /^-[^-]*[rR]/.test(flag));
    const forced = flags.some((flag) => flag === '--force' || /^-[^-]*f/.test(flag));
    if (recursive && forced && rootishTarget(words.slice(1))) return deny('rm-rf-root', '递归强删系统根目标（/ ~ $HOME *）不可恢复');
    if (recursive && forced) return deny('recursive-forced-deletion', '递归加强制删除（rm -r 与 -f 组合）不可恢复——逐个列出目标或去掉强制旗标');
  }
  if (['del', 'erase', 'rd', 'rmdir'].includes(name) && flags.some((f) => /^\/s$/i.test(f)) && flags.some((f) => /^\/q$/i.test(f))) {
    return deny('recursive-forced-deletion', 'Windows 递归静默删除（/s /q）不可恢复');
  }
  const lowerFlags = flags.map((flag) => flag.toLowerCase());
  if (name === 'remove-item' && lowerFlags.includes('-recurse') && lowerFlags.includes('-force')) {
    return deny('recursive-forced-deletion', 'Remove-Item -Recurse -Force 递归强删不可恢复');
  }
  if (name === 'pkill' || name === 'killall') return deny('broad-kill', `${name} 按名广谱杀进程——精确 PID（kill <pid>）或向用户说明`);
  if (name === 'kill' && flags.some((flag) => /^-[^-]*9/.test(flag))) return deny('broad-kill', 'kill -9 强杀进程需明确协调');
  if (name === 'taskkill' && flags.some((flag) => /^\/f$/i.test(flag))) return deny('broad-kill', 'taskkill /F 强杀进程需明确协调');
  if (name === 'chmod') {
    if (operands.some((op) => /^777$/.test(op.replace(/["']/g, '')))) {
      return deny('chmod-777', 'chmod 777 对任何人开放可写——用最小权限（如 750/640）');
    }
    if (flags.some((flag) => flag === '--recursive' || /^-[^-]*R/.test(flag)) && rootishTarget(words.slice(1))) {
      return deny('recursive-system-chmod', '对系统根目标递归改权限会破坏整棵树');
    }
  }
  if (name === 'chown' && flags.some((flag) => flag === '--recursive' || /^-[^-]*R/.test(flag)) && rootishTarget(words.slice(1))) {
    return deny('recursive-system-chmod', '对系统根目标递归改属主会破坏整棵树');
  }
  if (/^mkfs(?:\.|$)/.test(name) || name === 'fdisk' || name === 'diskpart') return deny('mkfs-dd-disk', '磁盘格式化/分区表改写不可恢复');
  if (name === 'format' && operands.some((op) => /^[A-Za-z]:/.test(op.replace(/["']/g, '')))) return deny('mkfs-dd-disk', '格式化盘符不可恢复');
  if (name === 'dd' && words.some((token) => /^of=(?:\/dev\/|\\\\\.\\)/i.test(token.value))) return deny('mkfs-dd-disk', 'dd 直写块设备不可恢复');
  if (['shutdown', 'reboot', 'halt', 'poweroff', 'restart-computer', 'stop-computer'].includes(name)) return deny('machine-shutdown', '关机/重启属人工操作，不由会话发起');
  return null;
}

// fork bomb：唯一保留的文本级规则（无程序名可锚定）；锚定命令执行位置（cc 思想）——
// echo "…:(){ :|:& };:…" 字符串文本不构成命令，不拦。
const FORK_BOMB_RE = /(^|[;&\n`]|\$\()\s*:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/;

// ---------- E-3. 管道级秘密外传（cursor classifySecretExposure 两遍式 + codex 融合） ----------
// pass1 跨段数据流：任一段碰敏感路径 + 后续管道段 ∈ EGRESS → deny 外传；
// pass2 直接形态：egress 带秘密参数 / reader 读秘密 / copier 复制秘密 / dd if=<secret>。
function secretExposure(segments) {
  let pipedSecret = null;
  for (const { joiner, tokens } of segments) {
    if (joiner !== '|') pipedSecret = null;
    const words = effectiveWords(tokens);
    const name = words.length ? normalizeName(words[0].value) : '';
    const secrets = segmentSecrets(words);
    if (pipedSecret && EGRESS_COMMANDS.has(name)) {
      return { decision: 'deny', rule: 'secret-egress', reason: `管道中的秘密内容（${pipedSecret}）外发到 ${name}——密钥不出网` };
    }
    if (secrets.length) pipedSecret = secrets[0];
  }
  for (const { tokens } of segments) {
    const words = effectiveWords(tokens);
    const name = words.length ? normalizeName(words[0].value) : '';
    const secrets = segmentSecrets(words);
    if (EGRESS_COMMANDS.has(name) && secrets.length) {
      return { decision: 'deny', rule: 'secret-egress', reason: `疑似把秘密文件（${secrets[0]}）经 ${name} 外发——密钥不出网` };
    }
    if (SECRET_READERS.has(name) && secrets.length) {
      return { decision: 'deny', rule: 'secret-read', reason: `读取秘密文件（${secrets[0]}）入会话——密钥不入上下文：改用环境变量引用` };
    }
    if (SECRET_COPIERS.has(name) && secrets.length) {
      return { decision: 'deny', rule: 'secret-copy', reason: `复制/移动秘密文件（${secrets[0]}）——密钥文件不落新位置` };
    }
    if (name === 'dd' && words.some((token) => {
      const source = token.value.match(/^if=(.+)$/i);
      return source && sensitivePath(source[1]);
    })) {
      return { decision: 'deny', rule: 'secret-read', reason: 'dd if=<秘密文件> 读出秘密内容——密钥不入上下文' };
    }
  }
  return null;
}

// ---------- F. 三档决策主入口 ----------
// options.extraDangerous / options.extraSecretRead：项目级附加正则（harness.json risk.confirm，
// {rule, pattern} / pattern 串，raw 命令串直测——opt-in 项目规则维持旧的直测语义；内置语义规则为本模块）。
export function classifyCommand(command, options = {}) {
  const text = String(command ?? '');
  if (!text.trim()) return ALLOW;
  for (const { rule, pattern } of options.extraDangerous || []) {
    if (new RegExp(pattern).test(text)) return { decision: 'deny', rule, reason: `项目附加危险命令模式命中（规则 ${rule}）` };
  }
  for (const sp of options.extraSecretRead || []) {
    if (new RegExp(sp).test(text)) return { decision: 'deny', rule: 'secret-read', reason: `项目附加秘密读取模式命中（${sp}）——密钥不入上下文` };
  }
  return classifySemantics(text, 0);
}

function classifySemantics(text, depth) {
  if (FORK_BOMB_RE.test(text)) return { decision: 'deny', rule: 'fork-bomb', reason: 'fork bomb 模式会耗尽进程资源' };

  const segments = segmentsWithJoiners(text);
  if (!segments.length) return ALLOW;
  const dynamic = segments.some(({ tokens }) => tokens.some((token) => token.kind === 'word' && token.dynamic));

  // ① 危险语义：剥壳→程序名→规则；嵌套 payload 递归（depth≤3）；远端内容管道进解释器。
  let nestedAsk = null;
  let previousFetches = false;
  for (const { joiner, tokens } of segments) {
    const words = effectiveWords(tokens);
    const name = words.length ? normalizeName(words[0].value) : '';
    if (!name) { previousFetches = false; continue; }
    if (depth < 3) {
      for (const payload of nestedShellPayloads(words)) {
        const nested = classifySemantics(payload, depth + 1);
        if (nested.decision === 'deny') return { ...nested, via: depth === 0 ? 'nested-shell' : undefined };
        if (nested.decision === 'ask' && !nestedAsk) nestedAsk = nested;
      }
    }
    if (joiner === '|' && previousFetches && SHELL_INTERPRETERS.has(name)) {
      return { decision: 'deny', rule: 'curl-pipe-shell', reason: '远端内容直接管道进 shell 解释器——先下载审阅再执行' };
    }
    const danger = dangerousSegment(name, words);
    if (danger) return danger;
    previousFetches = REMOTE_FETCHERS.has(name);
  }

  // ② 秘密外传/读取/复制（deny）
  const secret = secretExposure(segments);
  if (secret) return secret;

  // ③ ask 档：不硬拦但必须人工知情——提权壳 / 不可验证的外发载荷 / 出站数据上传 / 触碰敏感路径的非读取命令。
  // 本段 ask 优先于嵌套 payload 的 ask（当前命令的语境更具体）；嵌套 ask 仅作兜底。
  for (const { tokens } of segments) {
    const raw = tokens.filter((token) => token.kind === 'word');
    if (raw.length && PRIVILEGE_WRAPPERS.has(normalizeName(raw[0].value))) {
      return { decision: 'ask', rule: 'privilege-escalation', reason: '命令经 sudo/doas 提权执行——确认此提权有意为之' };
    }
  }
  for (const { tokens } of segments) {
    const words = effectiveWords(tokens);
    const name = words.length ? normalizeName(words[0].value) : '';
    if (!name) continue;
    if (EGRESS_COMMANDS.has(name) && dynamic) {
      return { decision: 'ask', rule: 'unverifiable-egress', reason: '外发命令含命令替换/通配（$(...)、反引号、*?）——载荷无法静态验证' };
    }
    if (EGRESS_COMMANDS.has(name) && words.slice(1).some((token) => DATA_UPLOAD_FLAGS.test(token.value))) {
      return { decision: 'ask', rule: 'data-upload', reason: `${name} 携带数据上传旗标（-d/--data/-T/-F 等）——确认出站内容有意为之` };
    }
  }
  for (const { tokens } of segments) {
    const words = effectiveWords(tokens);
    const name = words.length ? normalizeName(words[0].value) : '';
    if (!name || EGRESS_COMMANDS.has(name) || SECRET_READERS.has(name) || SECRET_COPIERS.has(name)) continue;
    const secrets = segmentSecrets(words);
    if (secrets.length) return { decision: 'ask', rule: 'sensitive-touch', reason: `命令触碰敏感路径（${secrets[0]}）但未读取内容——确认有意为之` };
  }
  return nestedAsk || ALLOW;
}

// ---------- G. 规则自带测试向量（classifier lint） ----------
// 向量文件 = 规则契约：match 必须命中该规则该档位；notMatch 该规则不得命中；allow 整体放行。
// 任何不一致 = 分类器契约破坏（exit 1，非运行时检查发现）。
// 路径按项目根解析（与 hook/CLI 同一 projectRoot 语义——CLI 以 cwd 定项目，测试可换仓验证）。
const RULES_PATH = path.join(projectRoot(), '.zcode', 'harness', 'classifier-rules.json');

export function lintClassifier(rulesPath = RULES_PATH) {
  const failures = [];
  let rules = 0;
  let vectors = 0;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  } catch (e) {
    return { ok: false, rules: 0, vectors: 0, failures: [{ scope: 'file', vector: rulesPath, expected: '可解析 JSON', actual: e.message }] };
  }
  if (!Array.isArray(doc.rules) || !Array.isArray(doc.allow || [])) {
    return { ok: false, rules: 0, vectors: 0, failures: [{ scope: 'file', vector: rulesPath, expected: '{rules:[...], allow:[...]}', actual: '结构不符' }] };
  }
  for (const rule of doc.rules) {
    rules += 1;
    for (const vector of rule.match || []) {
      vectors += 1;
      const verdict = classifyCommand(vector);
      if (verdict.rule !== rule.id || verdict.decision !== rule.decision) {
        failures.push({ scope: rule.id, vector, expected: `${rule.decision}:${rule.id}`, actual: `${verdict.decision}:${verdict.rule}` });
      }
    }
    for (const vector of rule.notMatch || []) {
      vectors += 1;
      const verdict = classifyCommand(vector);
      if (verdict.rule === rule.id) {
        failures.push({ scope: rule.id, vector, expected: `不命中 ${rule.id}`, actual: `${verdict.decision}:${verdict.rule}` });
      }
    }
  }
  for (const vector of doc.allow || []) {
    vectors += 1;
    const verdict = classifyCommand(vector);
    if (verdict.decision !== 'allow') {
      failures.push({ scope: 'allow', vector, expected: 'allow', actual: `${verdict.decision}:${verdict.rule}` });
    }
  }
  return { ok: failures.length === 0, rules, vectors, failures: failures.slice(0, 20), failureCount: failures.length };
}
