---
description: 进入需求阶段：引导生成/修订 Product-Spec.md 并请求用户签字。
argument-hint: "[需求描述或修订要点]"
---

# /zbase:spec

1. 调用 product-spec-builder skill。
2. 传入需求上下文：$ARGUMENTS
3. 产出 Product-Spec.md（+首次创建 Product-Spec-CHANGELOG.md）后，列出待用户确认项与开放问题，进入 Spec 签字闸（批的是当前这版内容）。
