---
description: "面向模型的 Responder 与 ntlmrelayx 监听器工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-listeners

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `responder_capture` 与 `ntlm_relay` 工具。每个工具把外部监听器作为通用后台作业经 `ctx.jobs` 运行：调用立即返回作业 id，捕获输出流式写入作业环形缓冲（用 `job_output` 读取、`job_kill` 停止），监听窗口到期、作业终止或所有者销毁都会结束会话。本地 bind 是监听面；中继目标是唯一的外发方向。授权由上游 `assessment-scope-tool-policy` 强制执行：工具名必须列入该策略的 `exploitTools`，`target_id` 必须匹配授权目标，且映射的 `exploit-execution` 动作需要授权——列入 `approvalRequiredActions` 的授权会把每次调用转为审批提示。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local`）、带注册器（如 `@deepseek-ai/dsh-jobs-local`）的 `@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-tool-jobs`（`job_output`/`job_kill` 工具），以及配置了包含两个工具名的 `exploitTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`Responder` 与 `ntlmrelayx` 可执行文件必须能在执行主机 PATH 上解析（或经 config 命令指定）；两者都需要原始套接字权限（root/管理员）。将 `config.maxListenMs` 设为部署可接受的会话时长上限。

<a id="model-experience"></a>
## 模型体验

### responder_capture 与 ntlm_relay 工具模式

#### 模型看到什么

模型收到生成的 [`responder_capture` 模式](../../../docs/tool-catalog.zh.md#cinlantool-listeners)（以及同包的 `ntlm_relay` 模式）：`target_id`（必填授权目标）、一个必填的监听器特定参数（Responder 的 `interface`、ntlm_relay 的中继目标 scheme）、受 `maxListenMs` 约束的可选 `listen_window_ms`。调用立即返回 `{ jobId, listenWindowMs }`。

#### Token 影响

这些工具向模型工具上下文追加两条描述与 JSON 模式；捕获输出按作业注册器的环形缓冲约束、经 `job_output` 读取，不受调用结果限制。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装且有特权的 Responder 与 ntlmrelayx 二进制；各工具在可执行文件缺失时给出明确错误。
- 监听器会话属利用执行：部署应把 `exploit-execution` 列入授权的 `approvalRequiredActions`，使每次投毒或中继调用都需审批。
- 捕获的 hash（Responder）与中继认证事件（ntlmrelayx）以原始形式流入作业环形缓冲；hash 值按 `full` 保留以供授权 evidence policy 下的离线破解，与 `secrets_dump` 一致。
- Responder 投毒影响所选接口的整个广播段；请把授权目标限定在被评估网络。
- 超出单一授权目标之外的 ntlmrelayx 中继目标、SOCKS 模式链、多协议中继图均延后。

<a id="dev-note"></a>
### 开发注记

保持工具名、`listen_window_ms` 参数名、固定的 `-smb2support` 中继标志与 `exploitTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
