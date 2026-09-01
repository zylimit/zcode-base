---
id: uptime-misleads
occurrences: 1
graduated: false
---

# uptime-misleads

- 日期: 2026-09-01
- 来源: cursor-base（feedback: deploy-acceptance 验收细节）
- 信号: 部署验收用 uptime 读数判断「新版本已上线」
- occurrence: 1

## 现象（事故语境）

cursor 部署验收教训：旧进程滞留时 uptime 读数照样在涨——读 uptime 会把「旧版本还活着」误判为「新版本已上线」。同族反向案例：回复 incomplete ≠ 失败（部署其实成功）——自报状态两个方向都不可信。

## 根因

uptime 度量的是「某进程活了多久」，不是「你要的那个部署物在不在」；指标与主张错位。

## 规则（可执行表述）

部署验收读**产物创建时间戳与镜像/build tag**（部署三件套已有此项），不用 uptime 作上线判据；反向同理——报错回复不等于失败，以健康端点+live 冒烟的实查为准。

## 执法建议

宪法已定三件套（产物时间戳/健康端点/live 冒烟）；本条补「uptime 不在判据内」的否定项，deployer 回执不得以 uptime 充当时间戳证据。
