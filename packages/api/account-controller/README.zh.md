---
description: "通过 Remote 提供不含机密的账户授权状态、调用方持有的 prompt 流与本地凭据删除。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-account-controller

[English](README.md) | 中文

## 概述

`account` Remote 命名空间向账户设置公开已注册授权流程，但不公开凭据记录。它列出方法与本地配置状态，只向发起尝试的调用方路由 notice 和 prompt 元数据，通过单向命令接收答案，并删除本地凭据记录而不声称已在签发方吊销。

## 目录

- [使用 Remote](#use-the-remote)
- [安全与生命周期](#security-and-lifetime)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-the-remote"></a>
## 使用 Remote

`snapshot` 返回已注册授权流程的完整列表。`watch` 会立即产生该无机密视图，随后合并 flow 注册、进行中状态与凭据存在状态变化。每个 flow 包含凭据键、provider 标签、方法、进行中状态，以及本地记录是否存在、类型与可写性。它绝不包含记录 payload。

`authorize` 打开一条由调用界面持有的流。第一帧提供带品牌的尝试与方法标识；后续帧携带 provider notice、prompt 元数据、prompt 撤回以及带判别字段的结算结果。只有不含 URL 凭据的绝对 HTTP(S) 链接才能随 notice 过线。故障使用固定分类，而不使用上游异常文本。

使用活动尝试与 prompt 标识调用 `answer`。文本与 secret 答案直接交给正在等待的授权 flow，绝不会进入快照、流帧、控制器日志或保留的尝试视图。使用尝试标识调用 `cancel`，只撤回该调用方持有的操作。

`deleteCredential` 接受属于已注册 flow 的键。它会在完整的本地读取和删除期间持有 authorization service 的每键独占保留，因此直接授权调用方和控制器尝试都不能在删除等待时启动；它也保留控制器的早期进行中检查，并拒绝只读记录。成功结果报告本地记录此前是否存在，并把 `issuerRevoked` 固定为 `false`：此操作不会调用签发方。

<a id="security-and-lifetime"></a>
## 安全与生命周期

控制器依赖 `typert`、`authorization` 与 `credentials`。授权注册表订阅和凭据更新事件驱动完整替换快照。按序列化后的 UTF-8 JSON 计算，完整快照最多为 256 KiB，每个授权帧最多为 64 KiB。暂停的 watcher 不积累历史；每个授权队列最多保留 32 帧，Client 则独立保留最多 16 条 notice。只有 notice 帧可以被丢弃；若控制帧无法满足任一限制，授权会被取消，其流以 `account/output-limit` 失败。

调用方取消或控制器卸载会中止其持有的授权。Prompt 取消会组合尝试 signal 与 flow 提供的 prompt signal，因此 provider 即使省略 prompt 自有 signal 也无法让控制器一直等待。授权服务会保留凭据键，直到 flow runner 实际结算；因此，即使不合作 flow 的调用方已经收到取消结果，本地删除与替代尝试仍会被阻止。控制器卸载会直接拆除暂停的 watch 监听、关闭授权尝试、拒绝等待中的 prompt，并等待自身的 `runAttempt` 工作；授权服务保留的 provider runner 不属于控制器。生成的 `./typert` 和 `./remote` 入口发布 Host 描述与 Client 命名空间。

此控制器没有独立于授权和凭据服务的持久化投影，因此不发布不变量伴随插件。

<a id="further-exploration"></a>
## 进一步探索

- [凭据子系统](../../../docs/subsystems/credentials.zh.md)——凭据键、记录存储与授权 flow 所有权。
- [授权 seam](../../credentials/authorization/README.zh.md)——provider 注册、人工交互与结算。
- [API Gateway 参考](../../../docs/api-gateway.zh.md)——Remote 生成与调用。

<a id="model-experience"></a>
## 模型体验

无。账户授权与本地凭据管理是配置期操作，其 notice、prompt 与状态不会进入模型请求。

#### KV Cache 影响

不失效；此控制器不会向请求前缀添加内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 删除本地凭据无法吊销签发方的凭据或账户访问权限。需要时，用户必须在签发方处吊销。
- 这里只列出当前已注册的授权 flow。已卸载 provider 遗留的孤儿记录不会出现在此设置视图中。
- 尝试属于当前进程与调用方。重新加载发起页面会取消流，之后必须重新发起授权。

<a id="dev-note"></a>
### 开发备注

此控制器没有独立的持久化投影；它观察的状态关系由授权与凭据服务负责，因此不发布运行时不变量伴随插件。
