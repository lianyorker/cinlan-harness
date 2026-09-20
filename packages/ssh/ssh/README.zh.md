---
description: "面向组合 POSIX 文件、进程与沙箱提供方的部署者，说明 OpenSSH 连接配置及远端辅助进程生命周期。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ssh

[English](README.md) | 中文

## 概述

`dsh-ssh` 将 Windows、Linux 或 macOS Harness 主机连接到 POSIX SSH 主机上已安装的辅助程序。部署方持有的 OpenSSH 主机别名或显式 SSH 端点提供认证与主机身份；配套的文件系统、子进程和沙箱提供方共享该连接。连接在就绪前验证已安装产物的摘要；辅助程序在连接关闭或租期到期时负责远端清理。

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

在自定义 `dsh` 配置组合中，将本服务与 [`fs-ssh`](../fs-ssh/README.zh.md)、[`subprocess-ssh`](../subprocess-ssh/README.zh.md) 和 [`sandbox-ssh`](../sandbox-ssh/README.zh.md) 组合。主机运行 Harness、模型传输和 Session 存储；远端机器提供文件与进程。headless 配置组合支持这种安排。

### 部署前提

远端辅助程序要求 Linux 或 macOS，SSH 服务器必须允许 Unix 套接字转发。Linux/macOS 客户端可使用已有 OpenSSH 主机别名，并启用连接复用、批处理模式、严格已知主机检查及禁用认证代理转发。Windows 客户端必须配置显式 `endpoint`；该传输使用 SSH2 通道，不创建本地 Unix 套接字或 OpenSSH 主连接。

在远端主机安装已构建的辅助程序及其匹配的运行依赖。Node、辅助程序、引导程序及其依赖必须位于工作区和可写临时目录之外，也必须位于后端会替换的临时目录树之外，例如 bwrap 的私有 `/tmp`；工作区仍可位于 `/tmp` 下。摘要校验在辅助程序启动后发现非预期的已安装产物；它不能保证可写部署文件的执行安全，也不能认证恶意 SSH 主机。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `host` | 省略 | Linux/macOS 上已有的 OpenSSH 主机别名；`host` 与 `endpoint` 必须且只能提供一个 |
| `endpoint` | 省略 | 显式 `host`、`port`、`username`、`privateKeyFile` 与 `hostKeySHA256`；Windows 必填 |
| `node`、`helper`、`workspace` | 必填 | 远端 Node 可执行文件、辅助程序打包入口和默认工作区的绝对路径 |
| `helperHash` | 必填 | 已安装辅助程序入口的小写 SHA-256 |
| `bootstrapPath`、`bootstrapHash` | 省略 | 成对提供的远端 PTC 入口及其小写 SHA-256 |
| `requestTimeoutMs` | `30000` | 连接与管理请求的截止时限，范围为 1 至 2,147,483,647 毫秒 |
| `maxFrameBytes` | `67108864` | 每条 JSON 消息的负载上限，最大为 64 MiB |
| `maxPending` | `128` | 普通未完成请求的数量上限；心跳与有界清理请求使用预留容量 |
| `leaseMs` | `30000` | 辅助进程心跳租期，范围为 3000 至 600000 毫秒 |

显式端点仅读取配置的绝对路径 `privateKeyFile`，文件必须包含未加密私钥。`hostKeySHA256` 为服务器 SSH 公钥字节的 64 位小写十六进制 SHA-256，需通过可信部署渠道取得。SSH2 要求该精确主机密钥及公钥认证，不读取用户 SSH 配置、已知主机文件、默认密钥或认证代理，也不提供交互凭据提示。

使用 PTC 时，配置两个引导字段，并将验证后的 `ctx.ssh.nodeExecutable` 与 `ctx.ssh.bootstrapPath` 传给 [`NodePtcRuntime`](../../ptc-runtime/ptc-runtime-node/README.zh.md)。仅使用文件系统和 Bash 时可以省略这对字段。未配置 PTC 部署时，`bootstrapPath` getter 会拒绝访问。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

专用 SSH exec 通道承载私有管理 RPC。每条程序流使用独立 SSH 通道连接远端 Unix 套接字；OpenSSH 传输持有本地转发套接字，SSH2 则直接打开远端 streamlocal 通道。程序 stdout 无法伪造管理回复，也不会占用控制流的通道窗口；SSH 传输拥塞仍会影响共享连接。

每个流预留项都有一个随机 256 位 TLS 预共享密钥，仅由管理 RPC 传递。TLS 认证两端并保护流中的每个字节；密钥绝不作为流前缀发送。套接字目录为私有目录（`0700`），套接字使用 `0600` 权限。替换可写套接字路径无法冒充端点或获知流密钥；攻击者仍可中断服务或转发不透明的 TLS 记录。

连接释放会等待传输关闭、存在时的转发与取消子进程，以及尚在建立的流结束，再删除本地资源。传输丢失会拒绝待处理操作并使连接失效。辅助进程在 SSH EOF、终止信号或心跳到期时启动托管清理。断连客户端无法确认远端结果；操作不会自动重连或重放。

启动或进程结果失败后，预留项在原生进程范围清空后释放；有界完成缓存保留原始拒绝结果，供后续读取。辅助程序关闭也会等待已在进行的端点与目录清理。

终端启用 shell 活动观察时，根进程退出会保留 reservation 及其剩余工作。活动 RPC 继续访问 provider；明确终止时先等待进程范围完全停稳，再释放端点并记录完成结果。helper 连接卸载和租约到期仍保留原有的终止权限。

辅助程序以 `--disable-sigusr1` 启动，因此同用户进程发送的信号无法开启其 Node 调试器。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [SSH 子系统](../../../docs/subsystems/ssh.zh.md) — 执行坐标、传输语义及生命周期归属。
- [POSIX SSH 决策](../../../.agents/notes/implemented/architecture/2026-09-11-posix-ssh-runtime.zh.md) — 理由、替代方案及必要验证。

-----

<a id="model-experience"></a>
## 模型体验

无，因为主机别名、认证与流能力令牌属于私有部署细节，每项面向模型的操作均由消费方负责。

#### KV Cache 影响

本提供方不贡献请求前缀内容。面向模型的工具与结果由消费方负责。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 不支持 Windows 远端辅助程序、显式端点的加密私钥、自动配置远端环境、重连或重放。本机加密网络测试验证支持 Windows 的客户端、控制子进程及 TLS 通道；完整远端文件系统、进程与沙箱验收仍需显式配置的 Linux 或 macOS 部署。
- Web 和 Desktop 工作区界面的路径仍假定可访问主机文件系统；请使用 headless 或所有消费方都遵守提供方路径语义的自定义组合。execution-host 目标列表保存元数据，不会挂载这些提供方或启用 SSH 执行。
- TLS 流密钥不防御远端操作系统级进程内存检查或调试。文件效果策略保留所选沙箱后端的限制。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本包不发布不变式伴随入口。消息校验及所属文件系统、子进程和沙箱提供方执行可观察的约束；此适配器没有增加可独立观察的状态关系。

</details>
