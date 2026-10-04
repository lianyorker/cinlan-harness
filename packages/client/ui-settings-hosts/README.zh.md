---
description: "在原生设置中管理已保存的 SSH 主机及其连接细节。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

[English](README.md) | 中文

## 概述

在设置 → 能力与连接 → SSH 远程主机中管理已保存的 SSH 主机。用一个目的地字段添加目标——裸主机、`用户@主机:端口` 或 OpenSSH 别名——再用用户名、端口、身份文件、代理命令、跳板主机、连接复用与连接超时加以细化，然后测试、连接、编辑或删除。导入会从管理 Host 的 OpenSSH Host 条目预填表单，且不写回该文件。已有工作区和会话保留已捕获的执行绑定。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待完善事项](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

将此浏览器插件与设置、语言服务及执行主机 Remote 控制器一起挂载。此包没有配置字段。页面接受显示名称和一个目的地，不收集密钥、原始 URL 或远程命令。

表单只有一个「主机或别名」字段，会把它携带的账户与端口折叠进旁边的字段，因此 `部署@服务器:2222` 会变成别名加目的地细节。别名仍是目的地。表单保存的每个连接字段都追加在连接自带 OpenSSH 选项之后，因此保存的值会覆盖别名解析到的 OpenSSH 配置，未填写的字段则保持该配置不动；表单显示的端口总会被保存，所以别名在 OpenSSH 配置里用的是别的端口时，必须在这里填写该端口——导入会自动填好。

Advanced 里两个控件只记录非默认选择：复用连接保存为显式关闭（因为复用是能力默认值），而连接超时字段把填写的秒数保存为记录里的 `connectTimeoutSeconds`——即 OpenSSH 收到的 `-o ConnectTimeout` 截止时间；留空则记录中不含该字段，沿用插件默认值。测试会拨一次一次性连接且不发布任何状态；卡片直接渲染它的稳定错误码（unreachable、authentication-required、host-key-mismatch、timeout、incompatible）。导入读取管理 Host 的 OpenSSH Host 条目且只预填表单——从不修改该配置文件，保存仍是独立的一次确认。

已连接的目标还会提供「重置远程中继」：它以完全相同的版本再次接纳连接，而所有者通过关闭正在运行的 worker 实例并重拨一个新的来兑现，卡片随后显示替换后的连接。这一替换不需要额外的 Host 操作——对一个已持有连接的目标再次连接，本身就是替换。

保存、删除与连接均使用目标版本。发生冲突时，页面刷新目标列表，同时保留编辑器中的目的地与细化项供用户检查并显式重试。就绪卡片显示 Host 发布的连接状态；目录检查与运行时安装由其他界面拥有，不属于本页。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

apply 闭包展开有类型的 Remote 结果并保留原始错误，向展示组件提供普通回调。私有可观察对象跟随 Host 快照，由渲染器绑定读取钩子。草稿、打开的对话框与操作状态保存在组件本地。元数据提供本地化公共搜索文案与原生锚点；目标值不会进入搜索索引。

不发布 invariant companion：此包仅拥有展示状态，目标状态来自控制器，没有可与目标状态进行独立比较的持久记录。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [设置](../ui-settings/README.zh.md) — 原生导航与搜索元数据。
- [Web 客户端](../../../docs/subsystems/web-client.zh.md) — Remote 通信与展示职责。
- [Slots](../../../docs/subsystems/slots.zh.md) — 渲染器绑定的钩子与回调。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包是浏览器端 UI 插件层，不注册面向模型的内容。

#### KV 缓存影响

无；目标管理不会进入提供方请求。

## 已知限制与待完善事项

<a id="known-limitations-and-deferred-work"></a>

- 管理 Host 必须已配置 SSH 认证与主机密钥信任。执行主机工作进程必须导出至少一个已配置的根目录，不使用当前目录作为默认值。
- 本页只管理已保存的主机。安装或更新执行运行时、检查导出目录，以及「不可用」的会话默认值行都不属于本页：它们的 Remote 方法与 Host 服务仍在，只是这里没有界面调用。
- 参考实现的卡片还提供「结束远程终端」。本页没有任何东西能支撑它：worker 只声明目录检查能力，而本产品的终端会话按所有者归属于管理 Host，因此已保存目标没有可结束的远端终端。该动作**不渲染**，而不是渲染成一个永远不能执行的控制项。
- 私钥口令仍不支持：`test` 与 `connect` 只接受精确的目标版本，且连接以批处理模式运行，没有任何提示可答。页面把 `authentication-required` 报成密钥或智能体的问题，而不是收一个用不上的秘密。
- 该连接固定拨号 `-S none`，因此保存的复用连接选择不会细化它。关闭项仍被记录，因为 SSH 执行能力会为捕获的部署消费它。
- 已保存的连接截止时间存为 `connectTimeoutSeconds`，它就是 OpenSSH 收到的 `-o ConnectTimeout`，因此只约束拨号。参考表单里那对「终端存活」控件没有实现：既没有开关让终端保持存活，也没有字段约束断开后的终端，因为本页名下没有可约束的远端终端。该宽限期由侧边栏终端插件在自己的部署配置里决定。
- 页面说明承诺通过 SSH 提供文件、终端、Git 和工作区；前三项成立，工作区不成立。在消费者使用同一执行环境之前，远程 Workspace 隔离与 worktree-task 创建会被拒绝，且随附远程组合排除了项目指令和文件系统技能发现（见 [execution-binding](../../execution-host/execution-binding/README.zh.md#limitations)）。
- 导入只列出具体的 Host 条目：通配与取反模式、以及 `Match` 块之后的全部关键字都会被跳过，且不跟随 `Include`。

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

包内测试覆盖回调错误保留、目的地拆分与校验、Advanced 折叠及其可选的连接超时、探测及其类型化失败、删除二次确认、导入预填、快照观察、注册清理，以及一条经生成 Remote 编解码器编辑目标的真实 Loader 组合用例。

</details>
