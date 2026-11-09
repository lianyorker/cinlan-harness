---
description: "内置 REA 逆向分析能力：运行时校验、不可用降级与内置技能注册。"
kind: "package-reference"
---
# @cinlan/security-rea

[English](README.md) | 中文

## 概要
本包把锁定的 `rea-agents` MCP 服务器挂载为 `securityRea` 服务。它只通过配置的 `nodeExecutable` 启动 REA，启动前用该可执行文件的实际版本对 `rea-agents` 的 `engines.node` 范围做校验；不满足时降级为非阻塞的 `disabled`/`unavailable` 状态，不抛错。判定允许启动后，还会把内置 `reverse-engineer-anything` 运行时技能连同中文口语触发词一起注册。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包
在已经提供 `tools` 与 `skills` 服务的组合里挂载它。`nodeExecutable` 用部署方提供的 Node 运行时——security-research 组合包会从传给 Host 的 primary-runtime 目录推导该路径。大白话的逆向请求经由内置技能与 `mcp__rea__*` 工具目录路由；`status()` 和 `doctor()` 用于诊断就绪情况。

<a id="model-experience"></a>
## 模型体验

间接生效：经由 `mcp__rea__*` 工具与内置逆向技能描述，其中带有 逆向分析、反编译、帮我看看这个 exe 是干嘛的 等中文触发词。

#### KV Cache 影响

REA 完整工具目录很大：`rea-agents@6.8.0` 列出 229 个工具，模型可见部分（名称 + 描述 + compact 输入 schema）约 271 KB——**每个请求约多 75k prompt token**。因此本服务在注册前做白名单裁剪：默认 `REA_DEFAULT_TOOL_NAMES` 保留 **62 个静态分析工具**（会话生命周期、原生清单、函数级分析、调用图/引用追踪、制品与格式探针、证据访问、分析师批注），模型可见面降到约 **69.5 KB ≈ 19k token（-74%）**。动态车道（adb、Frida、调试器、live 浏览器/Electron）默认不进模型目录；`Config.additionalTools` 可按需追加放行、`Config.toolAllowlist` 可整体替换默认集。

REA server instructions（约 2.9 KB，≈800 token）仍进系统提示。体积更大的 `outputSchema`（`tools/list` 约 3.2 MB）不进模型请求——且本服务默认以 `REA_MCP_OUTPUT_SCHEMA_PROFILE=off` 启动 REA（`Config.outputSchemaProfile`），这部分字节连子进程 I/O 与宿主内存也省了。以上均为 2026-11-01 对 `rea-agents@6.8.0` 的实测；完整数据、profile 说明与 deferLoading 调研见 `docs/dev/REA原生集成/plan.md` §8。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 运行时缺失或不满足引擎要求时服务为 `unavailable` 并给出大白话提示（"逆向分析需要更新运行时"），产品启动不被阻塞。
- 就绪判定是可执行探测加引擎校验；宿主逆向工具链的可用性由 `doctor()` 单独报告。
- 缺少 `skills` 服务时工具照常挂载，但跳过技能注册。

<a id="dev-note"></a>
### 开发说明

`nodeExecutable` 永远是显式配置的可执行文件——绝不回退到 `process.execPath`，因为 Electron 宿主的 Node 可能不满足 `rea-agents` 的引擎范围。状态与临时文件只落在 CLH 路径下；`.dsh` 位置与透传的 `DSH_*` 变量会被拒绝。
