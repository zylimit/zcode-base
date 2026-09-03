# zcode-base :: win-verify —— Windows 本地预验证缝（WSL ↔ pwsh 通道）
#
# 目的：Windows 兼容问题本地先复现，不烧 CI 轮次（CI windows 作业 ~3 分钟/轮）。
# 用法（WSL 侧）：
#   git archive HEAD -o /mnt/c/<win-temp>/zbase-win-src.tar
#   pwsh.exe -NoProfile -File .zcode/scripts/win-verify.ps1 [-TarPath <tar 绝对路径>] [-Keep]
# 前提：宿主 Windows 有 pwsh 7 + node（Git for Windows 必装——sh 依赖）。
#
# 本机环境已齐备（2026-09-03）：Python 3.12（winget user scope + python3.exe 别名 copy——官方安装器
# 只装 python.exe）+ 开发者模式（symlink 权限）。齐备后基线：206 用例 pass 204 / fail 0 / skipped 2
# （与 CI 一致，skipped 为环境条件用例）。环境缺失时的降级基线：fail≤9 且全部落在 symlink EPERM /
# python3 stub 边界 = 环境边界非产品缺陷；出现其余失败 = 真 Windows 兼容回归，本地先修再推 CI。
#
# 踩坑沉淀（改这里前先读，都是实证过的）：
#   - 从 WSL 以 \\wsl.localhost UNC 路径 -File 运行本脚本会被执行策略拦截（静默 exit 1 零副作用，
#     残留旧 log 造成「重跑无变化」幻影）——先 copy 到 Windows 本地路径再跑，或加 -ExecutionPolicy Bypass；
#   - PATH 只可前置 Git\bin（sh/bash/git 一小撮）：前置 usr\bin 会劫持 tar 为 GNU tar
#     （解析不了 pwsh 传的盘符路径形态，静默失败出空目录）；后置则 find 被 System32
#     find.exe 劫持报 FIND: Parameter format not correct。Git\bin 前置后，sh 起来
#     Git Bash 自把 /usr/bin 置前，脚本内 find/tar 解析为 GNU 版——与 CI runner 同构；
#   - WSL→Windows 进程 PATH 是 WSL 启动时快照，winget 新装不反映——Python 目录显式探测 prepend；
#   - 解压固定用 System32\tar.exe（bsdtar）绝对路径，不吃 PATH；
#   - 测试输出落盘再读，不经跨进程管道（pwsh↔WSL 管道偶发丢输出）。
param(
  [string]$TarPath = (Join-Path $env:TEMP 'zbase-win-src.tar'),
  [switch]$Keep
)
$ErrorActionPreference = 'Stop'

$gitBin = 'C:\Program Files\Git\bin'
if (-not (Test-Path $gitBin)) { Write-Error "未找到 $gitBin（Git for Windows 必装）" }
if (-not $env:PATH.Contains($gitBin)) { $env:PATH = "$gitBin;$env:PATH" }

# Python：WSL→Windows 进程的 PATH 是 WSL 启动时快照，winget 新装不反映——显式探测 prepend。
# 官方安装器只装 python.exe；python3.exe 为本脚本生态约定别名（安装后 copy 一份，见 progress 2026-09-03）。
$pyHome = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*" -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'python3.exe') } | Select-Object -First 1
if ($pyHome) { $env:PATH = "$($pyHome.FullName);$($pyHome.FullName)\Scripts;$env:PATH" }

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
