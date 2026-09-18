---
description: "通过有界 JSON-RPC 请求和显式导出的根目录，检查执行主机上的目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-host-worker

[English](README.md) | 中文

## Summary

检查已连接执行主机上显式命名的根目录中的目录。结果包含进程的主机身份，并在条目数量或字节限制生效时标明截断。取消操作会等待文件系统操作结束。工作进程在 dsh 配置方案中通过标准输入和输出提供按行分隔的 JSON-RPC。

## Table of Contents

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在工作进程配置方案中，将本插件与执行主机、文件系统和子进程提供者一起挂载。标准输出专用于协议帧；日志应写入标准错误。

### 配置

空根目录列表不导出任何文件系统访问权限。每个根目录都有唯一的 `id`、非空 `label` 和解析为目录的绝对 `path`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `roots` | `[]` | 可供检查的显式命名目录。 |
| `operationTimeoutMs` | `30000` | 中止操作并等待结束的截止时间。 |
| `maxFrameBytes` | `262144` | 每个完整 JSON-RPC 行的 UTF-8 字节数，不含换行符。 |
| `maxResultBytes` | `131072` | 完整操作结果的 UTF-8 字节数，包含结果元数据。 |
| `maxEntries` | `1000` | 每个检查结果中的目录条目数。 |
| `maxConcurrentOperations` | `16` | 拒绝新任务前允许的活跃检查数量。 |
| `maxCompletedOperations` | `256` | 为取消竞态保留的最近已结束操作 ID 数量。 |

### 请求与结果

检查目录前，以协议版本 1 初始化。使用返回的根目录 ID 和相对路径；空路径或 `.` 表示根目录。绝对路径、父目录跳转和解析到根目录之外的符号链接均会被拒绝。请求必须携带初始化返回的主机身份。错误包含稳定的机器代码和经过净化的消息。

取消操作应指定活跃或仍保留的已结束操作 ID。确认意味着其文件系统任务已结束；未知或已淘汰的 ID 会被拒绝。关闭请求和输入 EOF 会中止拥有的操作、等待结束，并请求启动器执行有界关闭。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[协议叶入口](src/protocol.ts) 为工作进程和连接器提供 DTO 校验模式与有界传输。[插件](src/index.ts) 通过 Cordis effect 管理标准流服务。插件需要启动器的就绪和退出服务，仅在成功启动确认后开始读取，并在初始化前等待 Loader 完成加载。目录检查使用注入文件系统的规范路径解析和包含判断。进程来源取自 `executionHost.current()`。

不发布 invariant companion：工作进程管理请求处理和操作生命周期，没有独立维护且可能发生偏离的投影。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [执行主机身份](../execution-host/README.zh.md)
- [文件系统能力](../../fs/fs/README.zh.md)
- [应用启动](../../../docs/architecture.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as 本工作进程不暴露 Agent 工具、提示词或模型请求。

#### KV Cache effect

工作进程不贡献模型上下文，也不影响可复用的模型前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

工作进程仅支持目录元数据检查。

- 文件系统提供者先列出完整目录，工作进程随后限制返回条目数量；提供者的取消行为决定操作结束延迟。
- 规范路径包含判断可阻止已解析的符号链接越界，但基于路径的文件系统 API 无法原子性防御恶意并发目录替换。
- 已结束操作 ID 会在超过保留上限时过期。客户端必须为每个操作使用新的 ID。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
