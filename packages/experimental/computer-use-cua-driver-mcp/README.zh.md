---
description: "通过已安装的 Cua Driver MCP 可执行程序和独占提供者注册，配置实验性本地计算机使用能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp

[English](README.md) | 中文

## 概述

让模型通过已安装的 Cua Driver 操作本地桌面。将本包与 computer-use 服务一同挂载，即可通过 MCP 提供驱动自身的工具描述、参数和结果。安装和桌面权限由 Cua Driver 负责，默认不启用任何驱动。提供者在连接和工具完成关闭前持续占用计算机使用能力；并发 Session 由调用方自行协调。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Cua Driver 已在运行 DSH 的同一台机器上安装并配置好时，选择此提供者。平台设置以[上游安装和权限指南](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/README.md)为准。

本插件不下载驱动。请提供可执行的 `cua-driver`（上游兼容参考为 `0.28.0`）及可访问的已登录图形会话。macOS 通常由具备辅助功能和屏幕录制授权的 `CuaDriver.app` 守护进程处理操作；`args: [mcp, --direct]` 则使用启动主机的权限。Windows 需要对应架构的驱动，并受 UIA/进程完整性限制。Linux 需要相应的 X11 或受支持的 Wayland/AT-SPI/合成器配置；具体操作支持见[上游平台记录](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/docs/action-support.md)。安装成功不代表获得桌面授权。

只挂载一个 Cua Driver 适配器，并先卸载任何已注册的 Cinlan Computer Use Provider。若组合包含 Cinlan 的 `tool-computer-use` 和权限策略，也应在选择 Cua Driver 时停用这些 Consumer；Cua Driver 暴露自身的参数与工具名称，Cinlan 专用权限策略不适用于它。本包不会自动启用，也不会修改 Cinlan 默认组合。

### 最小配置

将以下条目加入已提供 tools 和 system-prompt 服务的组合。截图还需要附件存储，以及声明支持图像输入的模型路由。

```yaml
- name: '@deepseek-ai/dsh-computer-use'
- name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp'
  config:
    command: cua-driver
    args: [mcp]
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `command` | `cua-driver` | 已安装的可执行程序路径或 PATH 命令 |
| `args` | `[mcp]` | 不经过 shell、直接传入的参数 |
| `toolCallTimeoutMs` | MCP 客户端默认值 | 单次调用的超时覆盖值，单位为毫秒 |
| `reconnect` | MCP 客户端策略 | 可选的重连覆盖配置 |

[配置 schema](src/index.ts)定义接受的字段。超时和重连默认值由 [MCP 客户端](../../mcp/mcp-client/README.zh.md)定义。

### 激活与所有权

提供者在连接前以 `cua-driver-mcp` 注册。第二个计算机使用提供者会激活失败，包括本包的另一个实例。初始化或首次工具发现失败会使本条目激活失败，并在清理后释放注册。之后连接断开时，MCP 客户端重连或耗尽尝试次数均保留注册；确认关闭后卸载条目才会释放注册。若 MCP 关闭超时，注册保持占用，必须重启主机才能挂载另一提供者。

模型看到的工具使用固定的 `mcp__cua-driver-mcp__` 命名空间。工具名称、描述、输入模式、规范结果和图像准入遵循现有 [MCP 桥接器](../../mcp/mcp-client/README.zh.md)。本包不额外提供 DSH 操作目录或提供者选择工具。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`src/index.ts`](src/index.ts) 将计算机使用注册和所属 MCP 子插件归入同一个有序副作用。子插件完成清理后才运行注册释放函数，激活失败时也遵循这一顺序。MCP 客户端负责凭据过滤、子进程终止、工具同步、取消和持久化图像投影。

本包不发布运行时不变量伴随插件：提供者没有独立的驱动状态可与注册比较，连接和工具代次由子插件持有。

### 模拟验证

在仓库根目录运行包内测试。测试使用仅返回固定文本和 PNG 字节的本地 stdio fixture，不读取真实桌面，也不发送输入。Loader 组合覆盖持久化截图、重连和失败后的资源清理；生命周期测试覆盖关闭超时后保留占用。真实驱动与平台权限需要单独验证。

```sh
node node_modules/vitest/vitest.mjs run packages/experimental/computer-use-cua-driver-mcp
```

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [计算机使用服务](../../computer-use/computer-use/README.zh.md) — 独占具名注册。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md) — 协议发现、执行和图像行为。
- [Cua Driver](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/README.md) — 上游可执行程序和平台设置。

-----

<a id="model-experience"></a>
## 模型体验

### Cua Driver 工具与截图

#### 模型可见内容

已安装驱动声明的工具描述和输入模式使用 `mcp__cua-driver-mcp__<tool>` 名称呈现。成功调用保留有序文本和已准入截图；不支持图像的路由会收到 MCP 桥接器的诊断文本。工具调用和投影后的结果通过正常执行流程进入 Session 日志。

#### Token 影响

已注册模式进入模型请求，工具参数、文本结果和已准入图像持续占用上下文，直到压缩。规范结果中的内联图像字节不会写入 Session 事件；持久化附件引用标识模型可见图像。

#### KV 缓存影响

工具发现结果不变时，工具定义前缀保持稳定。目录变化可能从第一个变化的模式开始使缓存失效；追加的工具结果保留此前的请求前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

此提供者依赖已安装的驱动及 MCP 桥接器支持的能力。

- 桌面访问需要完成上游安装并取得平台权限；插件激活本身不能证明每个桌面操作都已获准。
- 多个 Session 共享一个桌面。一次运行一个计算机使用工作流，或在外部协调；注册不会串行化 Session 的操作。
- 驱动升级可能改变发现的目录。本提供者不支持运行时驱动切换、专用桌面权限界面或 DSH 操作抽象。
- 启动时限及富结果限制遵循 [MCP 客户端的限制](../../mcp/mcp-client/README.zh.md#known-limitations-and-deferred-work)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
