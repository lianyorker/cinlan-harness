---
description: "通过 `/feedback`、Host Remote 或直接生产方记录含可选文本和类别的 Session 反馈。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-feedback

[English](README.md) | 中文

## 概述

`dsh-command-feedback` 记录关于 Session 的反馈，文本和类别均可省略。用户可通过 `/feedback` 提交评价；产品集成可通过 `sessionFeedback.record` 或 `recordFeedback` 记录反馈。记录会立即追加，绝不会启动或打断模型工作。命令会确认 Session id 与匿名用户 id。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用户可以直接在 Web 客户端中记录反馈：`/feedback` 命令随标准 `dsh` 基础组合交付，无需配置，可在任何对话中使用。自定义应用只需把 Session 存储、命令注册表与本插件组合在一起，即可获得同样的命令。

### `/feedback` 命令

输入 `/feedback` 加你的评价并发送。成功时会以接收会话 id 与匿名用户 id 确认：

| 输入 | 结果 |
|---|---|
| `/feedback the diff view is unreadable` | 记录评价并以两行确认：`Feedback recorded for session {sessionId}` 和 `Anonymous user: {userId}.` |
| `/feedback` | Host 命令返回用法错误：`Feedback text is required. Usage: /feedback <text>`。仅含空白的输入视为空输入。 |

用户从输入菜单选择 `/feedback` 或发送不带文本的命令时，会打开 [Web 反馈对话框](../../client/ui-message-feedback/README.zh.md)。Web 客户端将 `/feedback <text>` 发送给 Host 命令。

前后空白会被去除，但除此之外，评价会按输入原样保留：不进行截断、大小写折叠或命令解析——`/feedback /plan felt slow` 记录的就是这段字面文本。每次执行命令都会记录自己的条目；不会发生合并或替换。

<a id="feedback-categories"></a>
### 反馈类别

Session 反馈与逐消息反馈共享以下类别 id；各 UI 提供自己的本地化标签。省略类别时，反馈保持未分类。

| 类别 id | 含义 |
|---|---|
| `task-result` | 任务结果 |
| `instruction-following` | 理解和遵循指令 |
| `product-interaction` | 产品功能与交互 |
| `service-stability` | 稳定性与速度 |
| `resource-cost` | 资源使用与成本 |
| `security-privacy-permission` | 安全、隐私与权限 |
| `other` | 其他问题 |

### 从自己的 UI 记录反馈

Host 集成调用 `recordFeedback(session, { text, category })`，或通过 Host Remote 调用 `sessionFeedback.record({ sessionId, text, category })`。两个字段均可省略：空白文本不写入，只有类别或完全为空的条目也会被接受，每次调用都追加一个 `feedback/record`，不产生命令簿记。当 id 没有对应的活跃 Session 时，Remote 返回 `session-not-found`。将 Session 存储、命令注册表与本插件一起挂载：

```yaml
- id: session
  name: '@deepseek-ai/dsh-session'
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-feedback
  name: '@deepseek-ai/dsh-command-feedback'
```

Web 客户端随附该命令。无头模式、ACP 自动化和 JSON-RPC 不提供斜杠命令，因此 `/feedback` 在那里不可用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

评价是会话日志中一个仅追加的事实，由事件而非产生它的命令拥有：反馈可能来自任何触发方式，因此事实绝不能依赖斜杠命令。命令自身的簿记不携带载荷，所以评价文本在日志中只存在于一个地方，且该事件绝不会浮出到模型。

### 评价如何被记录

生产方去除文本首尾空白，并追加可选文本和类别；`/feedback` 处理器要求非空白文本，Remote 则接受空条目。追加是即时但未 flush 的：确认表示条目已进入内存日志，而非已经持久化到磁盘。只有命令会为确认文本获取匿名用户 id。生产方和 Remote 实现见 [`src/index.ts`](src/index.ts)；[`src/types.ts`](src/types.ts) 定义事件载荷和请求类型。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 生产方、类别元组、Host Remote 和命令注册 |
| [`src/types.ts`](src/types.ts) | 反馈类别与载荷类型、事件声明、Remote 请求与结果 |
| — | 不发布运行时不变式伴生入口；每个事件都是独立的仅追加事实。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们涵盖这条采集路径所依赖的命令注册表、持久化与身份事实。

- [dsh-commands](../../interaction/commands/README.zh.md)——发现全局命令并定义 `recordInput` 语义的注册表。
- [会话持久化子系统](../../../docs/subsystems/persistence.zh.md)——追加事件如何持久化、flush 屏障的含义。
- [匿名用户身份](../../identity/anonymous-user-id/README.zh.md)——确认文本报告的 id。
- [反馈包映射](../README.zh.md)——仅写入日志的采集与逐消息反馈并存的组。

-----

<a id="model-experience"></a>
## 模型体验

### 用户 `/feedback` 采集

#### 模型看到什么

无。斜杠输入、`feedback/record` 以及确认文本都不出现在模型请求中。反馈事件和注册表生命周期记录仅写入日志且不携带 `surfaceOp`，因此它们绝不会进入有序 surface、`deriveMessages()` 或系统提示词。在某个轮次中记录反馈不会改变该轮次剩余的请求。

#### Token 影响

无直接 token 影响。无论是已接受的条目还是用法错误，都不会在记录所在轮次或此后任何轮次增加模型 token。

#### KV Cache 影响

与模型请求路径无关。记录只追加到会话日志，不触碰已经可复用的请求前缀。本包贡献的任何内容都不会使缓存复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明 `/feedback` 何时不合适，或何时行为与用户预期不同。它们是当前包约束，不是任务积压。

- **没有反馈检索或管理 surface**——本包不为 `feedback/record` 提供检索、聚合或面向模型的工具。
- **只有类别和文本**——一条条目至多包含一个类别和一段自由文本，没有严重程度或关联事件链接。
- **Remote 仅支持活跃 Session**——对于没有活跃所有者的 Session，`sessionFeedback.record` 返回 `session-not-found`。
- **不支持修改或撤回**——会话日志是仅追加的，本包也不新增 tombstone，因此错误的条目会一直保留在记录中，只能由后续条目取代。
- **没有显式持久化屏障**——确认文本紧随追加而非 flush，因此紧临崩溃前记录的条目可能与其他未 flush 的尾部一同丢失。需要该保证的消费方可自行等待 `ctx.sessions.flush(session)`。
- **新会话上没有可见的确认**——Web 转录只在会话激活后渲染命令行，因此在仍为空白的新会话上执行 `/feedback` 会记录事件但不会显示确认行。发送首条消息后再记录反馈即可正常渲染。
- **随附的产品入口中只有 Web 使用此命令**——无头模式、ACP 自动化和 JSON-RPC 不提供命令适配器，因此 `/feedback` 在那里不可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性。已交付的行为、限制与理由以上文与包代码为准。

- 确认文本句子由 [`tests/command-feedback.spec.ts`](tests/command-feedback.spec.ts) 固定；修改它们会改变用户可见文案。
- 检索界面仍是开放方向；当前 API 没有预留检索格式。

</details>
