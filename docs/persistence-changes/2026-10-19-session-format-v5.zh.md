---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-19-session-format-v5

[English](2026-10-19-session-format-v5.md) | 中文

## 概述

将 SessionHeader.version 从 4 推进至 5，在接插收件箱与标题请求中保留 context-formed 消息来源变体，并增加 auto-review/request 审计记录与附件隔离事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-19-session-format-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "8d6be70b60c8774f8b2103f573357f8c75ca841335dd76f1045952d212338338"
    decision: version-bump
  - root: "event:assessment/operation-decided"
    previous: null
    after: "dd85a3097ca985cd83aaf9ab127f0a73902a25b14ed9cbfb0b196235aea43af6"
    decision: version-bump
  - root: "event:assessment/scope-bound"
    previous: null
    after: "e362fd0ba42741f3910f70cddf7f7f0a0c56a10ea1c41ee2343b089b01b281d9"
    decision: version-bump
  - root: "event:attachment/quarantine"
    previous: null
    after: "e6dde2a3d2b014656c82a13c0b7403a412ae67445a2eca14327f12deccf7fbdf"
    decision: version-bump
  - root: "event:attachment/recovered"
    previous: null
    after: "bec475b9a9b739bce5cbe21dbba40f3a1d5c44feacb73ff93b79c4da2832fe64"
    decision: version-bump
  - root: "event:auto-review/request"
    previous: null
    after: "1295b096549e180bf9365bf4489c6aa449b9e88803478e6d04239a613f9719b4"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "9bbb5fd13324cabba7ce0a8c30d272d87f4d583876d1ed2b320d3fb86f91f149"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "c371d7ea190246eff7897ef8adf09242b6c24524cbc2dfee48c82a1cff79e1de"
    decision: version-bump
  - root: "event:execution/bound"
    previous: null
    after: "9606dbc97da4c9252d1ef2ff5b17d08df53f701a4da2495f2ba357629453a261"
    decision: version-bump
  - root: "event:finding/change"
    previous: null
    after: "a5f57fbe51d1f69be1661012356b972f2ab7d662a15a3cfbf58fb919ab22835e"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "f0e8021110ed21dc7dc6b88091f67d6b1d8f8ba76ff978c2dca24166ca4e44df"
    decision: version-bump
  - root: "event:task-surface/dismissed"
    previous: null
    after: "9fc9b9c9c874774c66814454da82ff0f7fb14e90eeb9163f7f27db9f57601c06"
    decision: version-bump
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "f3ea7104b97d48c87cb28e75c7dcbb4ecc2ee45cc11656baa4716e1e66b84bd6"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "d66e11dddf5dfa3c71547e2cbd7b0608824cd8d6243fc16f532017ff28e8fba5"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "6619d727020789d8370bf4fdb8a3bf413380e0e5e22891f212b2a20248b51581"
    decision: version-bump
  - root: "event:working-directory/change"
    previous: null
    after: "124aa62078ca3311353b39cc3bf6c75da281338be6bbf672f8b361d828cddca3"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

既有 V4 及更早会话通过流式相邻迁移边升级，不改写已提交字节。V5 在记录 V5 写入器代次的同时完整保留消息来源归属与所有事件坐标。

<a id="verification"></a>
## 验证

vitest run packages/session/session-format-v4-to-v5/tests packages/session/session-format-catalog/tests：50 项测试通过。

<a id="dev-note"></a>
## 开发备注

无。
