# zcode-base :: win-verify —— Windows 本地预验证缝（WSL ↔ pwsh 通道）
#
# 目的：Windows 兼容问题本地先复现，不烧 CI 轮次（CI windows 作业 ~3 分钟/轮）。
# 用法（WSL 侧）：
#   git archive HEAD -o /mnt/c/<win-temp>/zbase-win-src.tar
#   pwsh.exe -NoProfile -File .zcode/scripts/win-verify.ps1 [-TarPath <tar 绝对路径>] [-Keep]
# 前提：宿主 Windows 有 pwsh 7 + node（Git for Windows 必装——sh 依赖）。
#
# 本机已知边界（非产品缺陷，勿修产品去迁就）：
#   ① symlink 权限：非管理员/未开开发者模式的 Windows 上 fs.symlinkSync 报 EPERM
#     （CI runner 以管理员跑所以绿）——3 用例（r3b:121/470、r4d:545 symlink 逃逸系）；
#   ② Windows 侧无真 Python（python/python3 为 Store stub）——make-release MINGW 分支
#     依赖 python3——6 用例（make-release 系）。装 Python 后自动可跑。
#   预期基线：Windows 侧 node 24 + 上述边界 → 206 用例 pass 195 / fail 9 / skipped 2
#   （fail 全部落在 symlink+python 边界即健康；出现其余失败 = 真 Windows 兼容回归，先本地修再推 CI）。
#
# 踩坑沉淀（改这里前先读，都是实证过的）：
#   - PATH 只可前置 Git\bin（sh/bash/git 一小撮）：前置 usr\bin 会劫持 tar 为 GNU tar
#     （解析不了 pwsh 传的盘符路径形态，静默失败出空目录）；后置则 find 被 System32
#     find.exe 劫持报 FIND: Parameter format not correct。Git\bin 前置后，sh 起来
#     Git Bash 自把 /usr/bin 置前，脚本内 find/tar 解析为 GNU 版——与 CI runner 同构。
#   - 解压固定用 System32\tar.exe（bsdtar）绝对路径，不吃 PATH。
#   - 测试输出落盘再读，不经跨进程管道（pwsh↔WSL 管道偶发丢输出）。
param(
  [string]$TarPath = (Join-Path $env:TEMP 'zbase-win-src.tar'),
  [switch]$Keep
)
$ErrorActionPreference = 'Stop'

$gitBin = 'C:\Program Files\Git\bin'
if (-not (Test-Path $gitBin)) { Write-Error "未找到 $gitBin（Git for Windows 必装）" }
if (-not $env:PATH.Contains($gitBin)) { $env:PATH = "$gitBin;$env:PATH" }

$dst = Join-Path $env:TEMP 'zbase-win-verify'
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Path $dst | Out-Null
C:\Windows\System32\tar.exe -xf $TarPath -C $dst
Set-Location $dst
git init -q
git -c user.email=t@t -c user.name=t add -A
git -c user.email=t@t -c user.name=t commit -qm init
Write-Output ("win-verify: " + (Get-Location) + " | node " + (node --version))

$log = Join-Path $env:TEMP 'zbase-win-test.log'
node .zcode/scripts/run-tests.mjs *> $log
$code = $LASTEXITCODE
Get-Content $log -Tail 15
Write-Output ("NPM_TEST_EXIT=" + $code)
Write-Output "判读：fail=0 全绿；fail≤9 且全部落在 symlink EPERM / python3 stub 边界 = 本机环境边界（见脚本头注释）；其余失败 = 真回归，本地先修再推。"
if (-not $Keep) { Set-Location $env:TEMP; Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue }
exit $code
