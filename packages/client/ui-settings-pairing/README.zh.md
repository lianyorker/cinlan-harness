---
description: "在桌面设置中为手机浏览器明确选择授权会话，并撤销设备访问权限。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-pairing

[English](README.md) | 中文

## 概要

在桌面设置 → 手机配对中连接手机浏览器。选择一个或多个会话，并明确授予每项附加操作权限；默认选中读取权限。将配对链接、邀请 ID 和一次性验证码复制给目标设备。在同一页面查看设备权限和到期时间、撤销设备授权或禁用 HTTPS 访问。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在受信任的桌面客户端组合中，将此贡献与设置、本地化、生成的配对 Remote 命名空间以及现有会话控制器一起挂载。本插件没有配置字段。HTTPS 提供者必须保持挂载，Loader 条目启用，监听器配置初始禁用，启用按钮才能调用它。手机组合必须省略此页面；即使加载了插件，已配对载体也会阻止页面注册。

在主机的 [remote-access 提供者](../../remote-access/remote-access/README.zh.md)中配置 HTTPS。页面显示提供者报告的真实配置缺项，绝不创建证书、建立信任或更改 CORS。不可用或已禁用的监听器不能创建邀请。操作失败时显示本地化恢复提示，并要求先刷新状态再创建邀请。

创建邀请前，逐项选择准确的会话。发送消息、停止任务、回答问题和决定审批分别授权。配对链接不包含验证码；邀请 ID 和验证码可以单独复制，剪贴板访问失败时仍可选中文本。取消或本地到期会移除显示的邀请。配对后刷新以加载新设备；撤销授权后会自动刷新设备列表。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

apply 闭包拥有身份稳定的观察源，以及调用官方生成 Remote 方法的串行管理回调。渲染器将该源与现有会话列表绑定为私有钩子。会话选择和权限草稿保留在组件本地。邀请仅保存在内存中，到期时不发送网络写入，且不会进入日志、设置元数据或持久浏览器存储。

独立分区使用稳定 ID `phone-pairing` 和本地化命名空间 `settings.pairing`。设置元数据只包含公开的本地化标签。槽声明、字典、观察计时器和待处理请求随插件销毁。本包不发布不变量伴随模块，因为 UI 没有可与权威提供者对比的独立持久记录。

[Loader 测试](tests/loader.client.spec.tsx)使用真实 Remote 编解码器、ClientSessions、设置、本地化和生产槽渲染器。外部 RPC 提供者明确为测试夹具，不能证明真实 HTTPS、浏览器信任或移动平台行为。[观察器测试](tests/observation.client.spec.ts)覆盖到期、重复请求、取消被拒绝和销毁期间的迟到结果。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [设置](../ui-settings/README.zh.md)——导航与本地化搜索元数据。
- [Web 客户端](../../../docs/subsystems/web-client.zh.md)——生成的 Remote 与数据归属。
- [同主机手机配对](../../../.agents/notes/implemented/architecture/2026-09-20-same-host-phone-pairing.zh.md)——传输权限和设备授权。

-----

<a id="model-experience"></a>
## 模型体验

无；本包是浏览器侧 UI 插件层，不注册任何面向模型的内容。

#### KV 缓存影响

无；配对管理不会进入提供者请求，也不会自动发送消息。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- HTTPS 证书、私钥、访问地址和手机信任由部署方负责。启用操作不会修复缺失配置。
- 设备变化在刷新或撤销授权后加载；API 不提供设备订阅或邀请已使用通知。
- 不包含二维码生成。此浏览器页面不提供已签名的 Android 或 iOS 应用或安装程序。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

桌面组合负责人独立验证组合后的浏览器与真实 HTTPS 配对流程，不将外部 RPC 夹具视为该验证。

</details>
