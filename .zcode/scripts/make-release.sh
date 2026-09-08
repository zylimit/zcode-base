#!/bin/sh
# zcode-base :: make-release — 发布打包自动化（Task 8.7，源 cc-base make-release.sh 融合移植）。
# 机制与内容分离：进化机制（skills/模板/引擎）保留；私人进化内容（.zcode/feedback/ 顶层经验 *.md）剥离，
# FEEDBACK-INDEX.md 重置为干净模板（内联——发布包自带干净索引骨架，不依赖源仓状态）。
# 包内容 = git HEAD 已跟踪文件的干净快照（未 commit 的自然漏——先 commit 再打包）。
#
# 打包后泄漏自验（verify-not-assume）：任何命中 exit 1 不发坏包——
#   ① feedback/ 下非 templates/ 非 FEEDBACK-INDEX.md 的 .md = 私人经验泄漏；
#   ② 运行态（.zcode/state/ 或 .zbase/）入包 = 运行态泄漏；
#   ③ 秘密完整形态命中 = 密钥泄漏。模式与引擎同源：scan.mjs SECRET_LITERAL_PATTERNS 十族
#     （sk/pk/rk/sess- 前缀 {12,}/gh[pousr]_/github_pat_/glpat-/xox[baprs]-/AKIA|ASIA/AIza/JWT 三段/
#      PEM 私钥块/DB URI（mongodb|postgres|mysql|redis|amqp|mssql）://user@/password 等赋值引串），
#     按 POSIX ERE 改写：\b→(^|[^[:alnum:]_])、\s→[[:space:]]、(?:)→()、\+→[+]。
#     模式锚定完整形态：引擎/钩子里作为「扫描模式源码」存在的 `AKIA[0-9A-Z]{16}` 等文本，
#     前缀后跟 `[` 不在字符类内，自然不误命中；测试 fixture 须运行期拼装 token。
#     共有局限（与引擎一致，非本脚本独有）：base64 整串、跨行分块、宽字符混淆、无前缀随机串
#     不在形态锚定内——发布前的 scan 门与人工复核仍是主防线，本自验是最后兜底。
#
# tagging/pushing/deploying 是 HIGH 档人类行为，本脚本永不执行（tag/push/deploy 由人类执行）。
# fail-closed：POSIX sh 无 trap ERR/set -E（bash 专属），等价实现 = set -eu（任一命令失败即终止）
# + trap cleanup EXIT/INT/TERM（临时目录必清理，坏包必删除）。
#
# 用法： sh .zcode/scripts/make-release.sh <version> [--dry-run]
#        产物 ${TMPDIR:-/tmp}/<repo>-<version>.tar.gz；--dry-run 只输出清单不写包。
#        MINGW/MSYS/CYGWIN 分支用 python3 zipfile 打 .zip（无 python3 → 报错退出，不发半包）。
set -eu

VER="${1:?usage: sh .zcode/scripts/make-release.sh <version> [--dry-run]  例：v2.0.0}"
DRY_RUN="${2:-}"
if [ "$#" -gt 2 ] || { [ -n "$DRY_RUN" ] && [ "$DRY_RUN" != "--dry-run" ]; }; then
  echo "make-release: 参数非法（只接受 <version> [--dry-run]）" >&2
  exit 1
fi

ROOT=$(git rev-parse --show-toplevel)
REPO=$(basename "$ROOT")
TMP=$(mktemp -d "${TMPDIR:-/tmp}/zbase-mkrel.XXXXXX")
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# ── 1) git archive HEAD 解包（只含已跟踪文件）──────────────────────────────
git -C "$ROOT" archive --format=tar --prefix="$REPO/" HEAD | tar -x -C "$TMP"
PKG="$TMP/$REPO"

# ── 2) 私人内容剥离：feedback 顶层经验 *.md 删（templates/ 保留），索引重置干净模板；
#        agent-memory（角色战术笔记，本机私产）整目录剥 ──
FB="$PKG/.zcode/feedback"
STRIPPED=""
if [ -d "$FB" ]; then
  STRIPPED=$(find "$FB" -maxdepth 1 -type f -name '*.md' ! -name 'FEEDBACK-INDEX.md' | sort \
    | while read -r f; do printf '%s\n' "${f#"$PKG/"}"; done)
  if [ -n "$STRIPPED" ]; then
    find "$FB" -maxdepth 1 -type f -name '*.md' ! -name 'FEEDBACK-INDEX.md' -delete
  fi
  cat > "$FB/FEEDBACK-INDEX.md" <<'EOF'
# FEEDBACK-INDEX

反馈条目索引（干净发布模板——源仓私人条目不随包分发）。occurrence ≥3 = 毕业候选（evolution-engine 评估机制化或进规则）。
条目格式见 `.zcode/harness/templates/Feedback-Template.md`；新条目由 feedback-writer skill 写入。

| 条目 | 主题 | occurrence | 毕业 |
|---|---|---|---|

## 状态说明

- 删除/停用条目属 HIGH 审批（存量资产铁律）。
EOF
fi
AM="$PKG/.zcode/agent-memory"
if [ -d "$AM" ]; then
  AM_STRIPPED=$(find "$AM" -type f | sort | while read -r f; do printf '%s\n' "${f#"$PKG/"}"; done)
  if [ -n "$AM_STRIPPED" ]; then
    # ${var:+guard} 空串不接换行（feedback 面零剥离时不得出首空行）；换行用引号内字面 LF——
    # $'\n' 是 bash/ksh 专属，dash（/bin/sh）展开为字面 $'\n' 文本（实测），本脚本须 POSIX 可移植
    STRIPPED="${STRIPPED:+$STRIPPED
}$AM_STRIPPED"
  fi
  rm -rf "$AM"
fi

# ── 2.5) release-provenance 机读边车（E1-4，codewhale 轻量版，包内附档；dry-run 跳过）──
# 包内逐文件 sha256 清单 + git 溯源（commit/tag）。部署面拿运行产物清单与本档比对（md5/sha 任一）
# 即可发现漂移；gitCommit 是包自述的出生地——与当前 HEAD 对不上 = 旧产物在跑而 git 已前进
# （codewhale 真实回滚事故形态）。清单只含哈希不含内容，泄漏自验照跑不冲突。
# packageSha256 = entries 规范串接（逐条 "path:sha256" LF 连接）的 sha256——包**内容**指纹：
# 与压缩格式无关、解包即可复算（压缩工件自身的哈希不可能嵌进它自己，自指不可解）；
# 本档自身同理不入 entries，entryCount = 包文件数 - 1。
# sha256 工具面：sha256sum（coreutils/Linux/Git Bash）→ shasum -a 256（macOS）→ python3 兜底；
# 三者全缺 = 发不出可溯源包（与不发坏包同优先级，exit 1）。
# 注：文件清单用 while read < 临时文件（非管道——POSIX sh 管道内 while 落子壳，累加变量必丢）。
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"
  else echo "make-release: 无 sha256sum/shasum/python3 可算 provenance 哈希——不发无溯源包" >&2; exit 1; fi
}
hash_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 | cut -d' ' -f1
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
  else echo "make-release: 无 sha256 工具——不发无溯源包" >&2; exit 1; fi
}
ENTRY_COUNT=0
if [ "$DRY_RUN" != "--dry-run" ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) PKG_EXT=".zip" ;;
    *) PKG_EXT=".tar.gz" ;;
  esac
  GIT_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
  GIT_TAG=$(git -C "$ROOT" describe --tags --exact-match HEAD 2>/dev/null || true)
  GIT_TAG_JSON=${GIT_TAG:+"\"$GIT_TAG\""}
  GIT_TAG_JSON=${GIT_TAG_JSON:-null}
  LIST="$TMP/.prov-files"
  (cd "$TMP" && find "$REPO" -type f ! -path "$REPO/release-provenance.json" | sort) > "$LIST"
  ENTRIES=""
  CANON=""
  while read -r f; do
    H=$(hash_file "$TMP/$f")
    FJ=$(printf '%s' "$f" | sed 's/\\/\\\\/g; s/"/\\"/g')
    # 显式 -n 判空做分隔符：${ENTRY_COUNT:+} 对字面 "0" 仍展开（首条目带出前导逗号→坏 JSON）；
    # JSON 数组元素间必须真逗号（,\n），CANON 是私有串接格式用 \n
    if [ -n "$ENTRIES" ]; then ENTRIES="$ENTRIES,
"; fi
    ENTRIES="$ENTRIES    {\"path\": \"$FJ\", \"sha256\": \"$H\"}"
    if [ -n "$CANON" ]; then CANON="$CANON
"; fi
    CANON="$CANON$f:$H"
    ENTRY_COUNT=$((ENTRY_COUNT + 1))
  done < "$LIST"
  rm -f "$LIST"
  PKG_SHA=$(printf '%s' "$CANON" | hash_stdin)
  GEN_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat > "$PKG/release-provenance.json" <<EOF
{
  "generatedAt": "$GEN_AT",
  "gitCommit": "$GIT_COMMIT",
  "gitTag": $GIT_TAG_JSON,
  "packageFile": "$REPO-$VER$PKG_EXT",
  "packageSha256": "$PKG_SHA",
  "entryCount": $ENTRY_COUNT,
  "entries": [
$ENTRIES
  ],
  "generator": "make-release.sh"
}
EOF
fi

# ── 3) 泄漏面装配：dry-run 扫描剥离后的树；正式跑扫描实际产物（解包复验）──────
SECRET_RE="(^|[^[:alnum:]_])(sk|pk|rk|sess)-[[:alnum:]_-]{12,}|gh[pousr]_[[:alnum:]]{20,}|github_pat_[[:alnum:]_]{20,}|glpat-[[:alnum:]_-]{16,}|xox[baprs]-[[:alnum:]-]{10,}|A(KIA|SIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[[:alnum:]_-]{10,}\.[[:alnum:]_-]{10,}\.[[:alnum:]_-]{5,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(mongodb([+]srv)?|postgres(ql)?|mysql|redis|amqps?|mssql)://[^@[:space:]\"']+@|(password|passwd|secret|api[_-]?key|access[_-]?key)[[:space:]]*[=:][[:space:]]*[\"'][^\"']{8,}[\"']"
OUT=""
if [ "$DRY_RUN" = "--dry-run" ]; then
  NAMES=$(cd "$TMP" && find "$REPO" -type f | sort)
  CONTENT_DIR="$TMP"
else
  OUT_BASE="${TMPDIR:-/tmp}/$REPO-$VER"
  rm -f "$OUT_BASE.tar.gz" "$OUT_BASE.zip"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      # Windows（Git Bash）分支：python3 zipfile（tar.gz 依赖与 /tmp 挂载问题，见 cc-base #9）。
      # 原生 Windows python3 不识 MSYS 路径（/tmp/… 直传 → FileNotFoundError WinError 3，CI #141/143/144/145/162/163）——
      # 凡 bash 传给 python3 的路径一律 cygpath -w 显式转 Windows 形态；cygpath 缺失即报错退出，不发半包。
      command -v python3 >/dev/null 2>&1 || {
        echo "make-release: MINGW/MSYS 分支需 python3（zipfile）打包，未找到——不发半包" >&2
        exit 1
      }
      command -v cygpath >/dev/null 2>&1 || {
        echo "make-release: MINGW/MSYS 分支需 cygpath 把路径转 Windows 形态传给 python3，未找到——不发半包" >&2
        exit 1
      }
      BASE=$(cygpath -w "$OUT_BASE") # 产物 zip 路径（Windows 形态，python 可写）
      TMP_W=$(cygpath -w "$TMP")     # 打包根目录（$TMP 是 MSYS /tmp/… 形态，原生 python 打不开）
      OUT="$OUT_BASE.zip"
      python3 -c "import shutil; shutil.make_archive(r'$BASE', 'zip', r'$TMP_W', r'$REPO')"
      # 条目名归一（CI #141 + 跨平台分发缺陷）：原生 Windows python 的 make_archive 内部 os.path.join
      # 产反斜杠条目名（.zcode\feedback\…）写入 zip——下游 endsWith('.zcode/…') 断言必红，且 unix
      # unzip 会解出带反斜杠的文件名。打包后立即重写 zip：条目名反斜杠 → /（chr(92)——sh 内嵌反斜杠
      # 转义易错，用字符码构造）；写回时透传原条目的 ZipInfo（compress_type 随之保留），外层压缩参数
      # ZIP_DEFLATED 与 make_archive zip 默认一致；os.replace 原子替换原文件后走原流程。
      python3 -c "
import zipfile,sys,os
src=sys.argv[1]; tmp=src+'.rew'
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as zout:
    for it in zin.infolist():
        data=zin.read(it.filename)
        it.filename=it.filename.replace(chr(92),'/')
        zout.writestr(it,data)
os.replace(tmp,src)
" "$(cygpath -w "$OUT")"
      NAMES=$(python3 -c "import zipfile,sys; print('\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))" "$(cygpath -w "$OUT")")
      ;;
    *)
      OUT="$OUT_BASE.tar.gz"
      tar -czf "$OUT" -C "$TMP" "$REPO"
      NAMES=$(tar -tzf "$OUT")
      ;;
  esac
  # 产物在场自证（fail-visible，CI macos 34212732976 首跑红）：macOS 上观察到「脚本 exit 0 而
  # stdout 空、测试侧包列表为空」的形态——bsdtar 对空档案/空文件名静默 exit 0（GNU tar 则报错），
  # 差异把真相掩盖成「安静的零条目」。本地 dash/bash-posix × bsdtar × symlink 根 × TMPDIR 尾斜杠
  # 四组合均无法复现（真根因待测试侧取证增强的下次 CI 输出定位）；在此之前把「产物缺位/空清单」
  # 从静默空成功变为响亮 exit 1——不发坏包优先于发不出包。
  [ -f "$OUT" ] || { echo "make-release: 产物未生成：$OUT——不发坏包" >&2; exit 1; }
  [ -n "$NAMES" ] || { echo "make-release: 包条目清单为空（$OUT）——不发坏包" >&2; rm -f "$OUT"; exit 1; }
  CONTENT_DIR="$TMP/scan"
  mkdir -p "$CONTENT_DIR"
  case "$OUT" in
    *.tar.gz) tar -xzf "$OUT" -C "$CONTENT_DIR" ;;
    # zip ⇒ 必为 MINGW 分支产物：解包复验同走原生 python3，两路径同样 cygpath -w（上面已验 cygpath 在场）
    *) python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$(cygpath -w "$OUT")" "$(cygpath -w "$CONTENT_DIR")" ;;
  esac
fi

# ── 4) 泄漏自验：①feedback 私条目 ②agent-memory 私产 ③运行态 ④秘密完整形态 ──────
LEAK_FB=$(printf '%s\n' "$NAMES" | grep '\.zcode/feedback/' | grep '\.md$' \
  | grep -v '/FEEDBACK-INDEX\.md$' | grep -v '/templates/' || true)
LEAK_AM=$(printf '%s\n' "$NAMES" | grep '\.zcode/agent-memory/' || true)
LEAK_STATE=$(printf '%s\n' "$NAMES" | grep -E '(^|/)\.zcode/state/|(^|/)\.zbase/' || true)
LEAK_SECRET=$(grep -rEl "$SECRET_RE" -I "$CONTENT_DIR" 2>/dev/null || true)

if [ -n "$LEAK_FB" ] || [ -n "$LEAK_AM" ] || [ -n "$LEAK_STATE" ] || [ -n "$LEAK_SECRET" ]; then
  echo "make-release: 泄漏自验失败，不发坏包（exit 1）：" >&2
  [ -n "$LEAK_FB" ] && printf '  私人 feedback 泄漏: %s\n' "$(printf '%s\n' "$LEAK_FB" | head -5 | tr '\n' ' ')" >&2
  [ -n "$LEAK_AM" ] && printf '  角色记忆泄漏: %s\n' "$(printf '%s\n' "$LEAK_AM" | head -5 | tr '\n' ' ')" >&2
  [ -n "$LEAK_STATE" ] && printf '  运行态泄漏: %s\n' "$(printf '%s\n' "$LEAK_STATE" | head -5 | tr '\n' ' ')" >&2
  [ -n "$LEAK_SECRET" ] && printf '  秘密形态命中: %s\n' "$(printf '%s\n' "$LEAK_SECRET" | head -5 | tr '\n' ' ')" >&2
  if [ "$DRY_RUN" != "--dry-run" ] && [ -n "$OUT" ]; then rm -f "$OUT"; fi
  exit 1
fi

# ── 5) 输出 ────────────────────────────────────────────────────────────────
FILES=$(printf '%s\n' "$NAMES" | grep -v '/$' | grep -c . || true)
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "make-release --dry-run：零写（未打包）。"
  echo "  包文件数: $FILES"
  echo "  将产出: ${TMPDIR:-/tmp}/$REPO-$VER.tar.gz（MINGW 分支 .zip）"
  echo "  将附入: release-provenance.json（gitCommit/tag + 包内逐文件 sha256 清单——部署面比对/漂移发现用）"
  echo "  剥离的私人 feedback 条目:"
  if [ -n "$STRIPPED" ]; then
    printf '%s\n' "$STRIPPED" | sed 's/^/    /'
  else
    echo "    （无——feedback 顶层无经验 *.md 或无 feedback 目录）"
  fi
  echo "  泄漏自验: 通过（feedback/agent-memory/运行态/秘密形态零命中）"
  exit 0
fi

echo "  包内附档: release-provenance.json（$ENTRY_COUNT 条目 / packageSha256 ${PKG_SHA} / gitCommit $GIT_COMMIT）"
echo "$OUT"
