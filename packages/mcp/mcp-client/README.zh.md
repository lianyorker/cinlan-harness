---
description: "面向部署方与维护者的 MCP 客户端桥接说明，用于选择、配置或排查连接到外部 MCP 服务器、并将其工具注册到 ctx.tools 的插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-client

[English](README.md) | 中文

## 概述

`dsh-mcp-client` 让模型把外部 MCP（Model Context Protocol）服务器的工具当作 harness 原生工具调用。每台服务器配置一条记录，其工具便会以稳定名称出现，例如 `mcp__github__create_issue`。可将它用于文件系统、GitHub、数据库、记忆或其他 MCP 工具服务器；默认不启用任何服务器。工具定义会为每次模型请求增加 token；缓慢或崩溃的服务器可能延迟启动，或让工具调用失败直至恢复。挂载 [MCP 资源](../mcp-resources/README.zh.md)可按需发现与读取服务器资源。

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

当模型需要把外部 MCP 服务器的工具当作原生工具调用时，添加 `dsh-mcp-client`。每台服务器一条配置项就是全部设置：给服务器一个简短的唯一名称和一种传输方式，它的工具就会以 `mcp__<serverName>__<tool>` 形式出现。服务器作为本地程序运行时选择 stdio，作为服务运行时选择 Streamable HTTP。如果你已经用其他客户端连接过 MCP 工具服务器，同样的配置行在这里也能用。

### 最小配置

每台服务器添加一条配置项即可，无需其他内容。harness 启动后，服务器的工具会出现在模型的工具列表中。

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `transport` | 必填 | `stdio` 或 `streamable-http` |
| `serverName` | 必填 | 服务器工具名称的 namespace；`[A-Za-z0-9_-]{1,32}`，在一个注册作用域内唯一 |
| `command` / `args` / `env` / `cwd` | — | stdio：可执行文件、参数、合并到清洗过的环境之上的额外环境变量、工作目录 |
| `url` / `headers` | — | streamable-http：端点 URL 与额外请求标头 |
| `toolCallTimeoutMs` | `60,000` | 每次工具调用或资源请求的超时 |
| `failOnStartupError` | `false` | 初始连接或工具同步失败时拒绝插件激活 |
| `reconnect.enabled` | `true` | 连接丢失后自动重新连接 |
| `reconnect.initialDelayMs` | `500` | 首次重连延迟；每次连续失败尝试翻倍 |
| `reconnect.maxDelayMs` | `30,000` | 退避上限；同时是重置尝试预算所需的正常运行时长 |
| `reconnect.maxAttempts` | `10` | 每次中断内连续失败尝试次数上限，超出后放弃 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-mcp-client)是每个受支持字段及其 JSDoc 的穷尽式真源。

启动后，服务器的工具会以 `mcp__<serverName>__<tool>` 形式出现——试着用一条提示词调用其中一个。如果初始连接失败，harness 仍会启动，但该服务器的工具不会出现，并会记录一条错误；设置 `failOnStartupError: true` 可让启动失败改为中止 harness。

### 工具命名与共存

模型看到每个工具都带有稳定的服务器限定名称：`mcp__<serverName>__<rawName>`，例如 `mcp__github__create_issue`——与 Claude Code 和 Codex 使用的命名形态相同。只要服务器保持相同的工具名称，名称就保持不变，因此会话历史与权限规则在重启和重载后仍然有效。两个服务器可以同时提供名为 `search` 的工具，分别以 `mcp__github__search` 和 `mcp__web__search` 共存。

- 发布相同工具名称（例如 `search`）的两个服务器会在各自的 namespace 下共存。
- 两条配置项使用相同的服务器名称时，后加载的一条会在加载时以明确错误失败。
- 服务器在工具列表中两次列出同一工具时，其工具列表会被作为无效列表拒绝，上一组工具保持可用。
- `tools/list` 返回重复的非空续传游标时会立即拒绝本次更新，包括经过空页的循环；上一组工具保持可用，后续更新仍可成功。
- 工具更新与已有工具名称冲突时，该更新会被整体拒绝——绝不会得到该服务器的部分工具集。

### 调用工具与读取结果

模型调用 MCP 工具时，调用会以每次调用超时（默认 60 秒）发往远程服务器，并像其他工具调用一样可以取消。结果按块顺序以普通文本返回；资源链接以文本形式显示名称与 URI。如果服务器报告错误，调用会明确失败——模型不会看到虚假的成功。

当前模型接受图片输入且 harness 启用了附件功能时支持图片；图片会像其他图片一样出现在对话中。不支持图片时——以及服务器返回音频或嵌入资源时——模型会看到清晰的诊断消息，而不是什么都没有。

### 资源访问

挂载 [MCP 资源](../mcp-resources/README.zh.md)后，客户端会在同一 agent 作用域注册配置的服务器名称。三个共享工具分别列出资源分页、列出 URI 模板和读取显式 URI。每次列表调用返回一页，并保留其不透明续传游标。请求使用已初始化的当前连接，携带调用方取消信号与配置的超时，并在连接关闭时中止。不具备 resources 能力的服务器返回空列表并拒绝读取；仅提供资源的服务器无需工具发现即可连接。

### 服务器指令

初始化与工具发现成功后，非空服务器指令会以字面量 `mcp:<serverName>` 提示词段落出现，标题为 `### MCP server: <serverName>`。末尾空白被移除；类似模板的花括号保持不变。`maxInstructionBytes` 限制包含标题的完整 UTF-8 文本，默认上限为 32768 字节；指令超限会在工具发现前使该连接尝试失败。托管启动器在发布前移除已知凭据。当前连接关闭或客户端卸载时，指令会消失；重连后发布新的服务器文本。

### 启动、工具更新与重连

服务器的工具会在 harness 开始首个轮次之前出现。服务器更改工具列表时，模型的工具集会自动更新；更新失败时，上一组工具继续可用。

服务器连接断开时——例如本地服务器进程崩溃——插件会以从 500 ms 起逐次翻倍、上限 30 s 的延迟自动重连，并刷新工具集；重连进度在日志中可见。中断期间最后已知的工具仍会列出，但对它们的调用会失败，直到服务器恢复。连续失败十次后，该服务器的工具会被移除，重连停止，直到你重载配置或重启 harness；服务器持续连接一段时间后，该计数会重置。设置 `reconnect.enabled: false` 可禁用自动重连——此时工具在断开后仍会列出，但调用失败，直到你重载。编辑配置项会在原地重载服务器连接，未变的名称保持不变。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释桥接背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **服务器限定身份。** 每个 MCP 工具都有稳定的身份 `(serverName, rawName)`。namespace 是本地配置，绝不采用远程 `serverInfo.name`——远程名称不可信、在部署间不唯一、且升级时可能变化，这些都不允许静默重命名面向模型的工具。
- **命名是固定约定。** 公开名称是 `(serverName, rawName)` 的纯函数，并满足 DeepSeek 函数名称约定；有损规范化会追加 12 位十六进制 SHA-256 hash，使不同身份绝不会折叠。会话历史与权限规则因此能在 HMR 替换、重新同步和其他服务器变化后保持有效。
- **原始名称是唯一的协议名称。** `tools/call` 始终收到原始名称；公开名称绝不会发给服务器，也绝不会被解析来还原原始名称。
- **要么完整世代，要么没有。** 同步会原子地交换世代：获取失败保留上一世代，注册冲突则回滚整个尝试中的世代。
- **一个规范值，一个投影。** 执行器返回协议完整的规范 `McpResult`；另一个有序投影准备 Native 内容，`finalizeContent` 只在注册表的执行后结果未变时安装它，因此策略块与值替换保持权威。

### 管理观察

包根入口、`./registry` 与 `./invariant` 一同打包。共享运行时 chunk 与入口文件一起发布在 `lib/` 下。`./types` 入口提供适用于 Client 的配置与观察类型，不引入 Host 服务声明。活动连接的 `ConnectionHandle` 应从包根入口导入，其资源请求需要 Host 工具执行权限。

在根作用域 MCP 客户端之前挂载 `@deepseek-ai/dsh-mcp-client/registry`，即可读取 `ctx.mcpRegistry.getSnapshot()` 并订阅变化。Agent 作用域客户端不进入该目录。每条不可变记录标识活动实例、服务器 namespace、传输类型、所有者、生命周期阶段、重试次数以及已提交的公开工具描述。记录不包含可执行配置、端点、环境变量、请求标头或上游原始错误。组合所有权使用实际 Loader 配置项 id 或插件名称；它既不授予 profile 写权限，也不标识来源 patch 层。

`launchMcpClient(ctx, config, options)` 与插件共享 namespace 预留、传输监督器和工具注册。其句柄提供初始结果、状态观察、只执行发现的 `probe(signal)`、当前世代资源请求与等待清理完成的 `dispose()`。启动器通过私有调用参数接收托管所有权和每次尝试的新配置解析器；插件 `Config` 无法声明托管所有权。托管启动器抑制子进程 stderr 和原始传输诊断。其脱敏器移除公开描述与 schema 中的已知凭据；公开工具名称中包含凭据时，发现会被拒绝。

`connecting` 包含初始化与初次发现；`ready` 表示最近一次发现已提交且此后未观察到错误；`backoff` 包含下一次重试时间；`error` 携带固定安全代码；`stopped` 在清理后发布。SDK HTTP 错误会将活动连接标为出错，而不增加另一层重连循环。成功的探测或列表变更同步恢复就绪状态。探测与普通发现串行执行，绝不调用工具；取消会保留上一世代。断开连接的工具会保留在列表中，直到成功替换、停止或重试预算耗尽。 传输关闭超时时，停止状态保留 `close-timeout`，启动器会跨 HMR 保留该 namespace，直到 Host 重启；替代连接无法与尚未确认退出的旧进程重叠。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、`serverName` 预留、激活等待 |
| [`src/connection.ts`](src/connection.ts) | 连接监督器：客户端世代、重连策略、尝试预算、dispose |
| [`src/tools.ts`](src/tools.ts) | 工具桥接：发现、命名、注册交换、执行、图片投影 |
| [`src/transport.ts`](src/transport.ts) | 传输工厂：带清洗环境的 stdio spawn、Streamable HTTP |
| [`src/registry.ts`](src/registry.ts) | 根连接只读目录及受 effect 管理的状态观察 |
| [`src/invariant.ts`](src/invariant.ts) | 在工具分发前验证观察到的工具名称存在于根工具注册表中 |

### 生命周期与同步

`apply` 解析重连策略、在当前注册作用域内预留 `serverName`、启动监督器，并等待初始连接加发现完成。独立 Agent 作用域可以复用相同 namespace，因为其工具与传输彼此隔离；同一作用域内重复会在加载时失败。监督器把所有同步——初始、通知与重连——串行到同一条队列，因此两次同步绝不会交错执行各自的先 dispose 后注册交换。卸载会在 Cordis 等待未完成激活之前开始取消。dispose 会取消待执行的重连、关闭活动客户端、等待进行中的尝试与排队同步完全停稳，然后注销当前世代。

监督器监听 `notifications/tools/list_changed` 并排队一次重新同步；获取阶段失败时保留上一世代注册，注册冲突则回滚本次尝试的世代。每次中断共享一个尝试预算：连续失败达到 `maxAttempts` 次后工具被注销、重连停止；连接存活超过 `maxDelayMs` 会重置预算。

### 工具执行内部细节

工具调用会发送一次未缓存的 `tools/call` 请求，携带原始 MCP 名称、JSON 参数、中止信号与配置的超时；公开名称绝不会发给服务器，也绝不会被解析还原。规范成功值是 `{ content: JsonValue[], structuredContent? }`，为程序化调用方与 PTC mode 调用方保留完整的 MCP JSON 块。受支持且已声明的 `outputSchema` 会验证 `structuredContent`；不受支持的 schema 词汇回退为不受约束的 `JsonValue`。MCP 的 `isError` 结果会在任何图片持久化之前抛出，使注册表产生失败的工具结果。图片批次会先整体解码并校验，再保存任一成员；任何拒绝都会把每张图片投影为诊断文本。

`createMcpToolDefinition(ctx, options)` 允许提供方传入原始 MCP 结果回调，同时复用规范输出校验、持久图片准入与执行后策略保护。回调接收确切的工具执行对象及取消信号；其所有者负责注册、传输生命周期与期限。无效回调结果会在投影前失败。

### 环境清洗（stdio）

子进程环境以子进程 seam 的 `scrubbedParentEnv()` 为基座——删除匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 的环境名称与所有 `DSH_*` 名称——再在其上合并配置的 `env`，因此显式覆盖得以保留。实际 spawn 由 MCP SDK 负责；本包共享清洗定义，而非 spawn 路径。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享工具注册表逐步进入桥接的设计证据与可运行的示例配置。

- [工具子系统参考](../../../docs/subsystems/tools.zh.md)——接收已桥接工具的 `ToolRuntime` 与 `ctx.tools.register()` 约定。
- [MCP 客户端插件 Agent Note](../../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.zh.md)——命名不变式、发现与执行设计、备选方案与后果。
- [规范工具输出约定 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-20-canonical-tool-output-contract.zh.md)——MCP 结果如何映射进规范工具输出约定。
- [第三方记忆 MCP 指南](../../../docs/user/guide/mcp-memory.zh.md)——使用本包的三份记忆服务器 overlay。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-mcp-client)——每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 已发现的 MCP 工具

#### 模型看到什么

初始发现成功后，每个已声明的 MCP 工具都会显示为名为 `mcp__<serverName>__<rawName>`（或其确定性规范化形式）的原生工具，并携带服务器提供的描述与输入 schema。成功的重新同步——包括自动重连后的同步——会替换整个世代；对插件执行 dispose（资源释放）或重连预算耗尽会移除该世代。

#### Token 影响

工具注册期间，工具描述与输入 schema 会进入每次请求；重新同步会替换而非累积 schema，服务器限定名称也会为每个工具定义和调用增加 token。

#### KV Cache 影响

已发现工具集合及其 schema 不变时，工具定义前缀保持稳定。增加、移除、重命名或更改工具的重新同步会替换定义，并可能使从第一个变化的 schema token 起的复用失效；恢复未变列表的重连会生成完全相同的定义，前缀保持稳定。

### 服务器指令文本

#### 模型看到什么

连接存活期间，上述带服务器归属的字面量指令段落会加入后续提示词组装。它遵循客户端注册作用域，并与组装后的提示词一同记录。

#### Token 影响

获准文本会增加提示词 token，大小受配置的字节上限限制。空指令不贡献文本。

#### KV Cache 影响

断开连接会撤销段落；重连或指令变化会改变后续提示词前缀。此前记录的组装结果保留原始文本。

### 工具调用历史与结果

#### 模型看到什么

公开工具名称和 JSON 参数保留在 assistant 历史中。规范值始终为程序化调用方与 PTC mode 调用方保留完整的 MCP JSON 块与可选结构化内容；受支持的图片块在确切路由能力得到证明后，按原始顺序与文本一起投影。被拒绝的图片、音频、嵌入资源、资源链接与未知块继续以有界文本诊断可见；MCP `isError` 会在图片持久化之前拒绝调用。

#### Token 影响

参数、映射后的文本与持久图片引用保留到压缩（compaction）发生时。内联 MCP base64 只存在于执行局部的规范值中，绝不会复制进会话事件；提供方会从附件存储读取经过校验的字节。音频与嵌入资源载荷不会进入模型上下文。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明你无法用本插件做什么、以及何时需要运维注意。它们是当前包约束，不是与其他 MCP 客户端的对比，也不是任务积压。

- **不支持 MCP 提示词模板与资源订阅**——通过 [MCP 资源](../mcp-resources/README.zh.md)显式调用列表与读取操作访问资源。
- **启动与发现超时继承自 MCP SDK**——插件不暴露连接或发现超时；每次 `initialize` 与分页 `tools/list` 请求都使用 SDK 默认的 60 秒请求超时，因此无响应的服务器或 cursor chain 可能延迟激活。dispose 会中止请求，发现会在替换注册前检查取消。
- **重连在传输关闭时触发**——崩溃的 stdio 子进程会触发重连；Streamable HTTP 失败按请求经 SDK 传输自身的恢复机制暴露，因此不可达的 HTTP 服务器会按调用重试，而非由 supervisor 重新 spawn。
- **图片是唯一的持久丰富结果桥接**——PNG、JPEG、WebP 与 GIF 在确切能力得到证明后进入 Native 上下文。音频与嵌入资源载荷仍只存在于执行局部并带明确诊断，资源链接只以文本保留名称与 URI。
- **不强制执行不受支持的 MCP 输出 schema**——已声明 schema 使用 harness 子集之外的词汇时，`structuredContent` 回退为 `JsonValue`。
- **要求基于任务的 MCP 工具在调用时被拒绝**——要求使用基于任务的执行（task-based execution）扩展的工具会抛出异常而非被桥接；该扩展未实现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付行为、限制与既定理由以上文、包代码与所链接的 Agent Note 为准。

- 公开名称算法是由测试固定的 v1 约定；发布后更改会破坏会话历史与权限规则。
- 由 DSH 显式拥有的连接与发现超时是开放的探索方向；每次请求目前使用 SDK 的 60 秒默认值。
- Streamable HTTP 的流恢复仍由 SDK 拥有；显式重连会替换启动器实例。
- 桥接 MCP Prompts 需要 harness 缺少的提示词模板概念。
- 固定的 MCP SDK 仍在演化；上游破坏性变更需要更新桥接。

</details>
