---
description: "将 Workspace 和 Session 绑定到同一个具有租约的本地或官方 SSH 执行环境。"
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-binding

[English](README.md) | 中文

## 概述

本服务保留 Session 选定的文件系统、子进程、沙箱、Shell、Git、PTY 和 PTC provider。控制端 Host 继续拥有 Agent 循环、模型传输、权限与持久 Session。远程连接不会成为第二个 Session 写入者，也不会回退到本地执行。

## 目录

- [使用本包](#use-this-package)
- [租约与准入所有权](#ownership)
- [模型体验](#model-experience)
- [已知限制与后续工作](#limitations)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将本服务与 Session 查询引擎和投影注册表一起挂载。仅限本地的组合不需要保存的目标注册表；任何准入 SSH 选择的组合都必须挂载该注册表，缺失时准入会失败。从已配置的目标捕获执行快照，再使用该快照创建 [Workspace](../../workspace/workspace/README.zh.md)。没有执行选择的既有 Workspace 和 Session 使用本地环境。远程路径由远程文件系统规范化，不依赖控制端操作系统。

SSH 目标需要带固定 Host 密钥的显式端点、由 Host 持有的私钥文件引用，以及远端 Node、helper、工作区和 PTC bootstrap 的绝对路径。helper 和 bootstrap 都必须提供摘要。[SSH provider](../../ssh/ssh/README.zh.md)验证已安装的部署；本包不上传凭据，也不复制本地工作区。

| 配置 | 默认值 | 用途 |
|---|---|---|
| sandboxMode | read-only | 远程文件副作用的默认策略，优先级低于 Session 策略覆盖 |
| connectionTimeoutMs | 30000 | SSH 管理请求期限 |
| shellTimeoutMs / shellMaxTimeoutMs | 120000 / 600000 | 单次 Shell 的默认和最长持续时间 |
| maxOutputBytes / maxSpillBytes | 1048576 / 67108864 | Shell 输出与保留的溢出数据上限；Git 使用输出上限 |
| graceMs | 3000 | 进程终止宽限时间 |
| gitExecutable / gitMaxLogEntries | git / 1000 | 远程 Git 查找与历史记录上限 |
| shellPath | /bin/bash | 远程交互式 Shell 可执行文件 |

<a id="ownership"></a>
## 租约与准入所有权

消费者为捕获的绑定和目录获取租约，或按 Session 身份解析租约。租约提供同一个 provider 上下文、规范目录、远程平台、连接实例标识与生命周期信号。保留的进程持续持有租约，直到实际清理完成。释放租约具有幂等性；最后一个持有者等待 provider 销毁完成。消费者通过 `ctx.get(name)` 严格查找上下文服务，拒绝缺失的服务，并对每个文件、命令和终端操作都使用这些已捕获的 provider。

Agent setup 在消费者之前挂载选定的执行 provider，并持有已保存目标的授权预留，直至同步发布提交完成。在此期间发生竞争的普通目标编辑与移除会返回 `conflict`；提交或回滚释放预留后，调用方可以重试。在对应 Agent 进入公开注册表之前，按 Session id 的查找会拒绝待发布的准入，包括已经可读的持久日志。冷查找在每次 await 后验证准入代次和身份；准入变化时，它会重新查找或保留已发布 Agent 的租约，绝不把过期的空观察值当成本地环境。不可变的执行事件记录部署身份，不含凭据路径。恢复和分叉保留该事件；编辑保存的目标不能移动运行中的 Agent。既有活动 Session 租约保留准入时的环境。托管运行时激活保留显式前驱部署以供恢复；普通目标编辑使历史选择失效。断开的环境拒绝工作，直到旧生命周期被释放；不会通过切换 provider 修复连接。

远程文件系统策略、Shell 默认值、PTC、Git、终端注册表和预设消费者挂载在 Agent 拥有的作用域内。冷 Session 操作在该租约拥有的私有作用域中捕获记录的策略。本地预设保留共享的常驻组合。[Agent 预设所有者](../../preset/agent-presets/README.zh.md)控制平台相关行、子代理继承与预设变更。发布 invariant 比较持久选择与对应 Agent 准入时的 provider 环境。

<a id="model-experience"></a>
## 模型体验

本包不注册模型工具。工具可用性和执行说明由选定的预设及其 provider 提供。执行选择是持久 Session 事件与客户端投影，不增加系统提示前缀。文件、命令和 PTC 程序使用选定的执行目录与策略。

#### KV Cache effect

不增加稳定提示文本。现有 provider 说明和已记录的运行时上下文决定提示变化；重放保留 Session 的执行选择。

<a id="limitations"></a>
## 已知限制与后续工作

远程执行需要预先安装兼容的 Linux 或 macOS 部署。Windows 控制端使用显式 SSH2 端点；不支持 Windows 远程端点。运行时安装与升级属于独立部署操作。连接丢失后，远程清理结果可能在 helper 租约到期前无法确认；进程回执不能跨重连存活。

在消费者使用同一执行环境之前，远程 Workspace 隔离与 worktree-task 创建会被拒绝。使用控制端 Node 路径 API 构造项目路径的预设消费者需要显式远程支持；支持缺失时，随附远程组合排除项目指令和文件系统技能发现。自定义预设仍是可信部署代码，必须使用成对的执行 provider。真实 SSH 部署、已渲染终端和跨机器 PTC 验收需要显式配置的端点；受控传输 fixture 不构成这些证据。

<a id="dev-note"></a>
## 开发备注

[execution-host 子系统](../../../docs/subsystems/execution-host.zh.md)拥有 API 参考。[绑定决策](../../../.agents/notes/implemented/architecture/2026-09-20-immutable-session-execution-binding.zh.md)记录所有权与迁移依据。Loader 测试保留真实目标存储、Agent 准入和官方执行 provider，仅控制外部 SSH 对端；它们区分本地与远程根目录，并覆盖租约丢失、过期发布和持久选择。
