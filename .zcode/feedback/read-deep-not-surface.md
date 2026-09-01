---
id: read-deep-not-surface
occurrences: 2
graduated: false
---

# read-deep-not-surface

- 日期: 2026-09-01
- 来源: cc-base（progress Pinned「验收五步闸」两起翻车案例）
- 信号: 查证命令跑过了，但结论没读到输出里真正说了什么
- occurrence: 2（PS 5.1 git fatal 误判 + 远程 tag 误判）

## 现象（事故语境）

cc 两起验收翻车：其一 PS 5.1 下 git 输出 fatal 前缀被表层格式掩盖误判为成功；其二远程 tag 判断没读到关键行——都发生在「查了但没读到位」：命令跑了，眼睛没跟上。

## 根因

「查证后再结论」的关键不是「去查」，是**读到位、不被表层信息覆盖已查到的证据**；跑了命令≠读了输出。

## 规则（可执行表述）

五步闸第 3-4 步（读完整输出→确认输出支持结论）不可压缩：结论必须能指认到输出中的具体行/具体 exit code；输出含 fatal/error/denied 字样时按失败处理，除非能解释为什么不是。

## 执法建议

宪法纪律 5 已有五步闸；本条是第 3-4 步的失败模式存档——code-review 对「结论与输出不贴」的回执直接打 error。
