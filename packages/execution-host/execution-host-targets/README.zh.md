---
description: "保存 OpenSSH 别名，并携带进程来源检查导出的远程目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-host-targets

[English](README.md) | 中文

## 概述

本插件拥有已保存的 SSH 目标及其活动连接。它通过 Host 的 OpenSSH 配置认证，启动目标的固定 execution-host profile，并在发布就绪状态前完成一次真实的导出根目录检查。已保存目标的身份与进程来源保持独立。目录检查携带当前连接代次和远程 worker 身份。

## 目录

- [使用本包](#use-this-package)
- [连接所有权](#connection-ownership)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将此服务与 `storageDomain`、本地 subprocess 提供方和 `executionHost` 一同挂载。[Remote 控制器](../../api/execution-host-controller/README.zh.md)为原生设置消费此服务。每条已保存记录包含显示名称和一个具体的 OpenSSH 别名。OpenSSH 配置及其本地 agent 负责认证；已保存记录不包含凭据值或可执行命令。

远程机器需要 [worker profile](../../bundle/execution-host-app/README.zh.md) 和显式配置的导出根目录。空根目录列表产生 `roots-unconfigured`。连接使用批量认证、严格的已知主机验证，不转发 agent、不创建转发监听器或共享控制套接字，并使用固定命令 `dsh --profile execution-host`。连接前须在 Host 的 OpenSSH 配置中验证信任与认证。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `sshExecutable` | `ssh` | Host 管理的 OpenSSH 可执行程序或绝对路径。 |
| `sshConfigFile` | 未设置 | 可选的 Host 配置文件；否则 OpenSSH 使用其常规配置。 |
| `connectTimeoutMs` | `15000` | 可执行程序查找和 worker 协商的截止时间。 |
| `operationTimeoutMs` | `30000` | 启动须确认的取消流程前的检查截止时间。 |
| `shutdownTimeoutMs` | `5000` | 确认截止时间及本地终止宽限期。 |
| `maxFrameBytes` | `262144` | UTF-8 协议帧的最大字节数。 |
| `maxDiagnosticBytes` | `8192` | 本地保留的 SSH 诊断尾部大小。 |
| `maxTargets` | `100` | 可持久化保存的目标数量上限。 |
| `maxConcurrentInspections` | `16` | 每个连接的并行检查上限。 |

超时值必须处于 Node 定时器范围内；检查超时加上两次关闭时限也必须符合该范围。保存前会验证名称和别名。更新或移除目标要求精确匹配保存的修订号，并先等待其连接工作结算。重新打开注册表时，保存的记录均恢复为未连接状态。

<a id="connection-ownership"></a>
## 连接所有权

就绪观察值包含协商的 worker 身份、导出根目录和连接代次。重连创建新代次。请求若指定旧代次、不同的 worker 进程身份或未导出的根目录，会被拒绝。远程相对路径始终在 worker 的文件系统中处理；`executionHost.current()` 继续描述管理连接的 Host 进程。

取消会显式请求 worker，并等待结算确认和原始结果。无法获取确认时返回 `outcome-unconfirmed`。断开连接先撤销就绪状态，再等待已接纳工作结算；方法返回表示本地清理完成。协议丢失会撤销就绪状态并立即启动清理。目标插件销毁会等待自身工作；整个 Host 关闭时，subprocess 提供方可能先于远程确认关闭，此时结果报告为未确认。

持久化 domain 为 `execution_host_targets`；连接观察值保持临时状态。不发布 invariant companion：持久化记录在接纳时验证，每个临时观察值由单一连接生命周期拥有，不存在独立投影。

<a id="model-experience"></a>
## 模型体验

无，因为本插件不注册 Agent 工具、提示词或 Session 事件。

#### KV Cache 影响

无；已保存目标的元数据和目录检查不会进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

仅支持远程目录元数据检查。不提供远程 Workspace 或 Session 授权、默认 Session 路由、切换确认偏好、任务隔离、任意执行、文件编辑或自动安装 worker。[Worker 的文件系统限制](../execution-host-worker/README.zh.md#known-limitations-and-deferred-work)同样适用。SSH 认证和主机信任必须在浏览器之外配置。

<a id="dev-note"></a>
### 开发备注

[真实 SSH 测试](tests/targets.spec.ts)使用独立的密钥、已知主机文件、端口、存储和 Loader worker 组合。它们覆盖认证拒绝、独立目标根目录、取消结算、重连代次、协议丢失和卸载接纳。临时 Windows 密钥 ACL 仅允许其所有者访问；POSIX fixture 使用 0600 模式。
