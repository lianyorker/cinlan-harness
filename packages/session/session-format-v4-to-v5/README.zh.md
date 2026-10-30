---
description: "从 Session 格式 V4 到原生 V5 的相邻流式迁移与校验。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 摘要

将受支持的 V4 会话还原为原生 V5，而不改写已存储的代次。本库提供从格式 V4 到格式 V5 的相邻流式迁移、原生 V5 物理编解码器以及目标代次校验器。事件 JSON、消息来源归属、引用和事件坐标均完整保留，同时 Session 头部推进至格式 5。

## 目录

- [使用此包](#use-this-package)
- [了解实现细节](#understand-the-implementation)
- [进阶探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

完整的多跳还原请使用[迁移目录](../session-format-catalog/README.zh.md)。直接导入用于目录组装、编解码器分发和测试固件；本库没有 Cordis 挂载配置。

其[公共导出](src/index.ts)提供相邻的 `sessionFormatV4ToV5` 迁移声明、已发布的 V4 来源编解码器、原生 V5 编解码器以及目标校验器。

仅头部迁移推进元数据而不修改事件体：

```ts
import { sessionFormatV4ToV5 } from '@deepseek-ai/dsh-session-format-v4-to-v5'

const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

<a id="understand-the-implementation"></a>
## 了解实现细节

`sessionFormatV4ToV5` 实现有状态的 `SessionFormatMigrationStage` 接口。Stage 按序遍历事件，若未提供继承切点则从末尾的继承 `session/end-seed` 标记推导，并验证活跃投递标记符合源代次。事件在不复制且不修改载荷的情况下透传。

`releasedV5SessionFormatCodec` 包装 V4 物理记录帧，同时断言原生格式 5 头部版本。

<a id="further-exploration"></a>
## 进阶探索

- [Session 格式目录](../session-format-catalog/README.zh.md) — 静态多跳迁移链。
- [Session 格式库](../session-format/README.zh.md) — 核心迁移类型与 Stage 协议。
- [新增 Session 格式版本](../../../docs/cookbook/adding-a-session-format-version.zh.md) — 版本推进流程。

<a id="model-experience"></a>
## 模型体验

本库执行确定性的格式迁移，不调用模型。

#### 代币影响

转换不修改任何请求文本或携带 token 的数据。

#### 键值缓存影响

迁移边完整保留精确记录的请求块与消息前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **已提交输入不可变** — 迁移绝不就地修改源文件；持久化层在写入打开时写入新代次。
- **投递代次隔离** — 来自代次 4 的历史投递标记保持未解释状态，不会被激活为代次 5 水位。
- **种子切点推导** — 缺少继承 end-seed 标记的种子会话会拒绝迁移，而不会猜测继承切点。

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
