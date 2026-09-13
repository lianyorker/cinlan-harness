---
description: "为 review、terminal、task、browser 和规范文件工具提供右侧栏贡献。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-right-sidebar

[English](README.md) | 中文

## 概述
本插件向生产右侧栏贡献 Review、Terminal、Tasks 和 Browser 页面。规范的 Files 页面仍由 ui-sidebar-files 拥有。现有 sidebar header-corner owner 渲染一个集成工具菜单，使 Files、Review、Terminal、Tasks 和 Browser 在触发按钮所属的 session 中打开。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将插件与 ui-sidebar-right、ui-sidebar-files、locale、官方 Remote 组合和相关 Host 控制器一起挂载。贡献 slot 使用按 session 注入，并返回类型化的加载、错误、空结果和变更状态。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器侧栏贡献不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；侧栏管理不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 浏览器内容受限于已挂载的 Host Remote namespace，不创建任意进程或文件系统权限。
- 受限 Browser 页面只接受经过验证的 HTTP(S) URL，不提供跨源 DOM 访问。

不发布 runtime invariant companion，因为本包拥有浏览器组件状态，而 sidebar 所有权和生命周期由 ui-sidebar-right 执行。

<a id="dev-note"></a>
### 开发备注

不要注册第二个 conversation.session.header.corner 贡献者；添加右上角工具时扩展现有 ExpandButton owner。
