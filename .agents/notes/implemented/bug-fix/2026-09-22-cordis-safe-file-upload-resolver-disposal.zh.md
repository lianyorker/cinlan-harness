# Agent Note: Cordis 安全的 FileUploads resolver 释放

Status: implemented

[English](2026-09-22-cordis-safe-file-upload-resolver-disposal.md) | 中文

## 问题

FileUploads 允许一个活动的 Agent resolver。Session Controller 拥有该注册，因为上传准入期间 resolver 可能物化一个休眠的普通 Agent。

Cordis traceable service 方法会创建调用方绑定的 shadow receiver。receiver 读取函数值属性时可能包装该函数，因此比较 this.agentResolver 与原始函数的 disposer 即使执行也可能失败。随后禁用再启用 Session Controller 时，新的注册会看到旧 resolver 并被拒绝。

[通用文件上传决策](../feature/2026-08-26-generic-file-upload.zh.md)拥有传输、暂存、凭证和 Session 准入语义。本记录拥有注册身份与释放规则。

## 决策

FileUploads 保存一个包含 resolver 函数的对象注册。第二个活动对象注册会被拒绝。disposer 只在槽中仍是同一个注册对象时清空它，因此 Cordis 的函数包装不会改变比较身份。

活动 Agent 查找失败后，resolver 执行从保存的注册对象中读取函数。Session Controller 继续拥有创建和释放注册的 effect；FileUploads 不保留第二套生命周期，也不静默替换活动 resolver。

## 备选方案

**通过 Cordis 内部比较函数。** 读取 original-service symbol 或拆开 traceable 函数会让 FileUploads 依赖 vendor proxy 细节，并且函数身份仍可能被另一个包装器改变。

**替换活动 resolver。** 覆盖槽位会掩盖 effect 顺序或释放泄漏，并可能把上传路由到错误的 Session owner。

**允许 resolver 列表。** 多个休眠 Agent resolver 会使 owner 与查找顺序含糊。一个 effect 作用域的 resolver 仍是所需关联。

## 后果

Session Controller 可以卸载再启用而不会由旧 resolver 阻止发布。resolver 仍只有一个 owner，释放对创建它的注册对象保持幂等。公开的上传与凭证行为不变。

## 验证

Host 生命周期回归测试通过 Cordis 挂载真实 FileUploads 服务，经由 traceable service proxy 调用注册，释放第一个注册后再接纳第二个。Windows 到 Debian 的 SSH acceptance 也在真实 Loader 组合中禁用并重新启用 Session Controller，然后执行冷恢复、文件访问、PTC、终端清理和 teardown。
