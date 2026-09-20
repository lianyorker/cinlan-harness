---
description: "配置固定 SSH 运行时安装、不可变发布世代和 Host 持有的任务观察。"
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-runtime

[English](README.md) | 中文

## 概述

通过显式 SSH 端点和固定主机密钥安装或更新远程 Harness 运行时。按任务 ID 观察安装，并在 Client 刷新后连接到同一 Host 时恢复保留的观察结果。激活操作为后续执行绑定选择已验证世代，既有 Session 则保留捕获的部署。安装需要完整发布载荷和现有远端 Node 可执行文件。

## 目录

- [使用此包](#use-this-package)
- [任务归属](#task-ownership)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在受支持的 Harness profile 中，将此服务与 [execution-host-targets](../execution-host-targets/README.zh.md) 一起挂载。部署配置选择发布产物；管理请求提供显式端点和远端路径。

端点指定主机、端口、用户名、Host 私钥文件的绝对路径引用，以及小写十六进制 SHA-256 主机密钥指纹。安装不读取个人 SSH 配置，不使用环境中的别名，也不转发 SSH agent。需提供满足 `^22.19.0 || >=24.0.0` 的远端 Node 可执行文件绝对路径、由 SSH 账号拥有的现有规范化私有安装根目录，以及独立的现有工作区；两个目录不能互相包含。远端载荷以 Linux/macOS x64 或 arm64 为目标；Windows 可控制安装，但不是远端载荷目标。

默认选择根据检测到的远端平台和架构读取包内发布索引。部署拥有的产物覆盖配置必须同时提供绝对目录与 manifest（元数据清单）摘要。浏览器请求不能任意选择 Host 上的产物文件。发布索引或目标条目缺失时返回稳定的 `release-unavailable` 分类；无效载荷在激活前验证失败。

[配置 schema](src/config.ts) 定义接受的字段和默认值：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `artifactDirectory` / `manifestSHA256` | 未设置 | 成对的部署产物覆盖配置与精确 manifest 固定摘要。 |
| `operationTimeoutMs` / `shutdownTimeoutMs` | 300000 / 10000 | 总操作期限与取消清理宽限期，单位为毫秒。 |
| `maxManifestBytes` / `maxFileBytes` | 16777216 / 536870912 | manifest 与单个载荷文件的字节上限。 |
| `maxTotalBytes` / `maxFiles` | 4294967296 / 100000 | 完整载荷的字节与文件数量上限。 |
| `maxResponseBytes` / `maxRetainedTasks` | 65536 / 256 | 安装器控制输出字节数与保留的 Host 任务回执数量。 |

所有数值上限均为正安全整数；期限还必须符合 Node 定时器范围。[服务 API](src/index.ts) 与[请求类型](src/types.ts) 定义检测、安装、观察和显式取消。

-----

<a id="task-ownership"></a>
## 任务归属

`start` 捕获安装／更新意图、保存目标的精确 ID／修订号及部署坐标，然后立即返回 Host 签发的 `RuntimeTaskId`。每个目标只允许一个运行中的安装任务。任务回执不包含凭据和执行部署配置。

`get` 与 `follow` 观察该显式 ID。关闭或中止 follow 流只会脱离观察，不会取消任务。Client 刷新后，`listTasks` 恢复同一个运行中 Host 保留的有界任务列表。达到容量上限时淘汰最早的已结算回执；运行中的任务不会被淘汰。

`cancel` 指定一个任务并等待其结果。取消在目标激活提交后到达时，已提交的激活仍为成功。Host dispose（资源释放）会取消并等待所属操作完成。回执保存在内存中：Host 进程重启不会保留任务，也不会恢复未完成的安装。只读 `detect` 拥有独立且可取消的观察生命周期。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[发布产物生成器](scripts/materialize-runtime.ts) 将已安装的生产依赖、对等依赖（peer dependency）及可用可选依赖物化为完整发布树。它选择包声明的文件，固定依赖版本，并为每个目标封存 manifest。生成器在记录源码修订前拒绝有已跟踪或未跟踪变化的工作树。生产构建和匹配的目标系统／PTY 二进制是前提；生成器不安装依赖，也不下载可执行文件。[原生载荷选择器](scripts/native-payload.ts) 使用规范系统预构建验证器，并检查所选 PTY 二进制头。可执行权限由目标元数据决定，不取自控制端文件系统的模式位，Windows 上也遵循此规则。仅凭二进制头不能确认目标 ABI 兼容性。

[产物验证器](src/artifact.ts) 检查固定的 manifest、完整普通文件列表、哈希和大小上限。SSH 认证、连接、channel 和 SFTP 失败使用稳定的 `connection-failed` 分类，且不暴露原始传输诊断；产物与已认证监督程序的失败使用 `verification-failed`。[SSH 传输](src/transport.ts) 重新核对传输字节，并通过 SFTP 上传到操作专属 staging 目录。[远端监督程序](assets/remote-operation.mjs) 验证目标身份和依赖解析，执行部署后的 PTC 代码，检查 helper 身份，并验证经 helper 准备的沙箱允许读取且拒绝写入。存在 node-pty 时，它在 Node 子进程中执行原生 PTY 探测；生产发布生成要求包含该依赖。监督程序随后发布名为 `generations/<manifest SHA-256>` 的不可变目录。发布与目标激活是两个独立操作；陈旧的目标修订号可能留下未使用的完整世代。

目标激活以检查修订号的持久化操作作为提交点。托管激活保留前驱配置，供已捕获的 Session 绑定使用；普通目标编辑会清除保留的授权。既有活动租约继续使用捕获的 helper／PTC 路径和哈希。安装器不替换或回收旧世代，传输丢失也无法证明远端清理完成或重建中断操作的结果。

不发布 invariant 伴随插件：manifest 验证、远端探测和目标修订号检查在消费这些关联的操作处执行约束。[安装决策](../../../.agents/notes/implemented/architecture/2026-09-20-remote-runtime-installation.zh.md)记录理由和验证要求。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [保存的执行目标](../execution-host-targets/README.zh.md)：目标身份与激活持久化。
- [SSH 执行](../../ssh/ssh/README.zh.md)：helper 传输、流与断开语义。
- [不可变 Session 绑定](../../../.agents/notes/implemented/architecture/2026-09-20-immutable-session-execution-binding.zh.md)：捕获的部署与租约归属。

-----

<a id="model-experience"></a>
## 模型体验

### 运行时管理观察

#### 模型看到什么

`executionRuntimes` 服务不添加模型工具、提示词或 Session 内容。部署回执仅用于管理观察；执行消费方拥有其常规模型可见结果。

#### Token 影响

安装不贡献请求 token。消费方负责计算后续执行输出的开销。

#### KV Cache 影响

安装不修改模型请求前缀。Session 执行绑定保留捕获的部署，与管理观察相互独立。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

以下限制影响部署和恢复：

- 真实 Linux/macOS 端点验收需要部署后的 helper、PTC、原生 PTY 和沙箱强制执行证据。仅有 Windows SSH/SFTP fixture（测试前置数据）不能证明 POSIX 执行通过验收。
- 生成器要求匹配的原生二进制，并拒绝冲突的已安装包版本。它不编译其他目标、不升级远端 Node，也不创建账号和安装根目录。
- 世代无限保留；安全垃圾回收需要跨 Host 引用信息。尚未实现跨 Host 重启的任务持久化，也未实现传输丢失后的自动恢复。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文——点击展开</summary>

非权威集成上下文：尚未记录真实 POSIX 验收结果。原生系统／Landlock 载荷仍不完整。集成负责人报告四个 POSIX 目标的已安装 node-pty 预构建产物均具有有效二进制头；ABI 执行仍未验证。集成负责人正在获取 Linux guest，用于完整产物生产和原生验证。

</details>
