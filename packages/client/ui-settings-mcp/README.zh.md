---
description: "在原生设置中管理已保存的 MCP 服务器、凭据引用、实时连接状态与已发现的工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

[English](README.md) | 中文

## 概述

在设置 → MCP 中管理当前配置的 MCP 服务器。添加或编辑 stdio 和 Streamable HTTP 配置，启用已保存记录，重新连接受管理服务器，并查看实际工具描述。界面分别显示已保存的启用状态、待应用状态与观测到的连接状态。凭据字段接受变量引用而非秘密值。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

当主机提供当前配置的 MCP 管理能力，浏览器提供设置、本地化、连接与生成的 Remote 服务时，选择此设置扩展。该页面读取真实主机快照，不包含示例服务器条目。

### 组合

此包作为 Cordis 插件条目挂载。Node 入口没有主机行为；浏览器入口向实验分组添加 `mcp` 页面。控制器与管理器负责连接和持久化行为。

```yaml
- name: "@deepseek-ai/dsh-client-ui-settings-mcp"
```

此插件没有配置字段。服务器的期望配置属于 MCP 管理器，不属于此插件条目。

### 编辑与查看服务器

已加载的受管理列表为空时，添加服务器仍然可用。保存会发送完整期望记录及打开草稿时捕获的版本号。取消会丢弃草稿。保存被拒绝后，草稿及其版本号均会保留；发生冲突时，取消并重新打开以编辑当前记录。保存成功表示持久化完成，不表示连接已就绪。持久化完成后仍可能关闭失败；当前快照会显示已保存的期望状态。

表单可编辑词法服务器命名空间、启用开关、传输方式、命令、每行一个原样参数、工作目录、环境变量引用行、端点 URL 与请求头引用行。请求头前缀保留空白，包括 `Bearer ` 的尾部空格。URL 必须使用 HTTP 或 HTTPS，且不能包含用户信息、查询字符串或片段。凭据引用是 `MCP_TOKEN` 等变量名；表单不接受原始环境变量或请求头凭据值。

启用与禁用会修改已保存的期望状态。重新连接针对已启用的受管理记录。刷新工具在已初始化的受管理连接上请求 `tools/list`，不调用工具，也不启动已禁用的服务器。已启用且处于就绪或错误状态的行可使用此按钮；如果该行没有活动的已初始化连接，主机会拒绝请求。组合中的行只读，并显示实际报告的归属。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部机制——点击展开</summary>

[注册入口](src/client/index.ts)在插件生命周期内持有一个 [Remote 数据源](src/client/source.ts)。连接代次变更会取消旧读取和发现请求；卸载会等待其拥有的工作结束。稳定的可观察对象通过框架 hooks 区域发布完整快照。组件仅通过框架提供的 Hook 订阅。[交互存储](src/client/store.ts)独立于主机读取状态保存草稿和移除确认。

设置元数据只包含本地化静态文案和持久页面锚点。服务器名称、端点、引用名称、工具名称及工具描述均不会进入设置搜索索引。Remote 失败映射为固定本地消息；界面不渲染异常或传输文本。[测试](tests/)覆盖草稿保留、异步竞争、真实 SlotRegistry 与元数据生命周期以及组件行为。[可见输出预期](tests/expected/native-states.expected.md)固定无需密钥的空列表、错误与原生服务器输出；组装后的浏览器与主机组合证据由应用集成负责。

此包不发布运行时不变量伴随插件：它负责展示与交互状态，管理器负责可独立观测的期望状态和实时连接之间的关系。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

以下文档说明相关行为的归属。

- [MCP 管理类型](../../mcp/mcp-management/src/types.ts)——已保存记录和完整读取状态。
- [MCP 控制器](../../api/mcp-controller/src/index.ts)——类型化 Remote 操作。
- [Web 客户端插槽](../../../docs/subsystems/slots.zh.md)——注册和框架 Hook。
- [Web 样式](../../../docs/web-styling.zh.md)——语义令牌和原生控件样式。

-----

<a id="model-experience"></a>
## 模型体验

通过 MCP 管理器间接影响模型体验，该管理器会应用这些控件请求的连接变更。

#### KV Cache 影响

此界面不创建提供商请求；可用工具变更的缓存影响由 MCP 管理器负责。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

编辑器管理工具，并保留未提供编辑控件的配置。

- 编辑时原样保留工具超时与重连覆盖值，但表单不提供这些值的控件。省略的值保持省略，使用桥接默认值。
- 未修改参数文本时，现有参数数组保持不变，包括内嵌换行。编辑参数文本采用每行一个参数的格式，无法在单个参数内部编写换行。
- 此处无法编辑或移除由组合持有的连接。刷新工具按钮可用表示可以请求发现；主机会检查连接是否活动。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
