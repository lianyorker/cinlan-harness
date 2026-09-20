---
description: "在原生设置中管理已保存的 SSH 执行主机，并检查其导出的目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

[English](README.md) | 中文

## 概述

在设置 → 实验 → 执行主机中管理已保存的 SSH 目标。添加名称和现有 OpenSSH 别名后，显式连接并检查导出的目录。配置固定服务器指纹的显式 SSH 端点，可以检测、安装或更新执行运行时。当前本机 Host 始终是只读的进程记录。已有工作区和会话保留已捕获的执行绑定。

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

将此浏览器插件与设置、语言服务及执行主机 Remote 控制器一起挂载。此包没有配置字段。页面接受显示名称和 SSH 别名；别名引用管理 Host 上现有的 OpenSSH 配置与认证信息，不收集密钥、原始 URL 或远程命令。

运行时设置接受主机名、端口、用户名、服务器密钥 SHA256 指纹、管理 Host 上的私钥文件引用，以及远程 Node、安装根目录和工作区的绝对路径。凭据内容保留在 Host。已有的私有安装根目录必须由 SSH 账户拥有，并位于工作区之外。部署选择发布产物；浏览器不能选择可执行载荷。已接纳的安装由 Host 持有，离开设置或断开连接后仍继续运行。刷新可恢复保留的任务回执，显式取消仅针对一个精确的任务 ID。任务回执仅在 Host 服务生命周期内保留，不跨 Host 进程重启。

保存、删除与连接均使用目标版本。发生冲突时，页面刷新目标列表，同时保留编辑器中的名称和别名供用户检查并显式重试。连接就绪要求工作进程握手成功，并成功检查一个导出根目录。目录检查器接受一个导出根目录和相对路径，显示返回的条目，并标明截断的结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

apply 闭包展开有类型的 Remote 结果并保留原始错误，向展示组件提供普通回调。私有可观察对象跟随 Host 快照，由渲染器绑定读取钩子。表单与检查结果保存在组件本地。元数据提供本地化公共搜索文案与原生锚点；目标值不会进入搜索索引。

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

无；目标管理与目录检查不会进入提供方请求。

## 已知限制与待完善事项

<a id="known-limitations-and-deferred-work"></a>

- 创建工作区时选择执行位置。全局会话默认值、运行中的 Host 切换和任务隔离偏好不可用；页面不保存这些行的偏好。
- 管理 Host 必须已配置 SSH 认证与主机密钥信任。执行主机工作进程必须导出至少一个已配置的根目录，不使用当前目录作为默认值。
- 检查为只读操作，受工作进程导出根目录的限制。已保存的目标 ID 标识配置，当前 Host 与工作进程 Host ID 标识进程来源。

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

包内测试覆盖回调错误保留、原生表单行为、快照观察及注册清理。

</details>
