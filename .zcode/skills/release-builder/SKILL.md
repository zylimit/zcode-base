---
name: release-builder
description: Phase 收尾需要打包、发版、部署上线，或需要发布前验证与溯源时使用。发布前必须用户明确批准。
---

# release-builder：构建发布

## 发布三验（缺一不可）

1. **产物验**：构建产物存在且新鲜（时间戳/镜像 tag/哈希核对），不是旧产物改名。
2. **健康验**：部署后健康检查端点真实通过（不是「端口通了」）。
3. **冒烟验**：live 环境对新功能产物做最小真实调用（新 API 打一发、新页面开一次），勿看「Up 时长」。

## 流程

1. 前置闸：`/zbase:verify` 全绿 + `node .zcode/zbase.mjs quality verify` 无 blocking + `receipt verify` 链完整。
2. 变更清单：版本号/CHANGELOG/迁移步骤/回滚方式。
3. 派 deployer（fresh）：执行构建/部署，回传三验证据。
4. 主 Agent 独立复核三验（宪法纪律 5：验收只认客观证据）。
5. **发布闸（HIGH 审批）**：向用户呈三验证据 + 回滚方式，**用户明确批准后**才 push tag / 上线。
6. 收口：`receipt write`（发布三验证据）+ progress.md 记 Decisions/Done + 溯源（版本→commit→receipt seq 链）。

## 纪律

- 远端/生产写操作前当场实查当前实况；被拒/超时调用按「可能已执行」对待，先实查再重发。
- 回滚方案先演练或至少验证入口可用；不可逆操作必 HIGH 审批。
- 发布后发现问题：先评估影响面（是否回滚），不先修复后通知。

## 回执

三验证据 + 版本/commit/回滚方式 + 用户批准记录 + receipt seq。
