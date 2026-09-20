---
description: "Web 客户端中的逐回合文件改动卡片、逐文件差异审阅和可点击产物引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deliverables

[English](README.md) | 中文

## 概述

审阅已完成回合改动的文件，并查看每个文件已记录的前后差异。卡片显示行数统计；安装 better-sidebar 时在其中打开审阅 tab，否则使用 sidebar-right。显式 `present` 声明为当前源文件添加交付卡片，包括通过 shell 创建的文件。原有产物文件行和行内代码链接继续打开文件。二进制文件、超大捕获和过期记录均显示明确状态。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [继续探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

已完成回合的改动卡片列出 [workspace-changes](../../deliverables/workspace-changes/README.zh.md) 记录的文件。点击标题打开第一个比较；点击文件行使用该文件在摘要中的原始索引。超过三个文件时折叠。审阅支持文件切换、统一或并排显示、换行，以及通过侧栏现有导航打开完整文件。

交付卡片直接重放 `deliverables/presented`，无需文件修改调用。卡片主体通过 better-sidebar 预览，并携带当前查看的 Session ID 与已知 cwd；菜单使用默认应用打开，或在 Host 文件管理器中定位源文件。`GET /api/present.host` 提供 Host 能力。`POST /api/present.open` 只接受 Session、事件、文件索引及动作；它解析持久声明，通过 SessionFS 拒绝非普通文件和末级符号链接，并在原生启动前确认提供方与 Host 指向同一文件。读取声明不会激活 Agent。编辑会改变打开的内容，移动或删除源文件会使其不可用；不保存独立副本。

同时挂载 workspace-changes 和本插件。Host 通过 Connection Fetch 注册经过身份验证的 `GET /api/changes.summary` 和 `GET /api/changes.diff` 路由。请求仅指定 Session、通知事件序号和原始文件索引，不指定 Host 文件路径；摘要不包含 cwd 和私有快照 id。

安装 better-sidebar 时，审阅通过其公开 tab 和文件导航 API 打开。后备实现注册 `sidebar.right.pane.tab` 内容和 tab 定义。新卡片使用新增的 `conversation.chat.turnCards` 列表；现有 `conversation.chat.turnTail` chain 和产物文件行保留原有行为。Settings 样式和 Desktop 传输仍由现有包负责。

比较内容保留到 Host 重启或 Session 销毁。仅保留事件无法重建过期差异。摘要缺失时隐藏卡片；打开的审阅区分缺失记录和可重试读取错误。二进制或超大捕获没有文本差异，超过 10,000 行时显示截断提示。

### 原有产物文件行和提及

产物文件行和收尾正文提及继续使用精确路径或唯一 basename 词表。它们使用原有的 `conversation.chat.turnTail` chain，并与改动文件卡片相互独立。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

浏览器半部按回合关联 `workspace/changes` 通知，包括结束消息之后追加的通知。Host 路由只接受经过校验的 Session、事件序号和文件索引坐标；不接受请求指定的文件系统路径，摘要响应也不包含 cwd 和私有快照 id。

可选的 better-sidebar 集成仅调用公开的 tab 和文件导航方法。后备实现注册 `sidebar.right.pane.tab` 内容和 tab 定义。切换文件会取消未完成读取，插件销毁会等待自身请求结束，比较最多渲染 10,000 行。

运行时不变量：无。本包验证 Host 响应并从会话数据派生卡片，不拥有可能独立偏离的运行时关系。

</details>

-----

<a id="further-exploration"></a>
## 继续探索

继续阅读以下页面，了解记录器、聊天卡片组合和侧栏导航。

- [工作区改动](../../deliverables/workspace-changes/README.zh.md)——捕获上限、比较服务和活动 Session 生命周期。
- [ui-conversation](../ui-conversation/README.zh.md)——聊天回合卡片和 tail 渲染。
- [右侧栏](../ui-sidebar-right/README.zh.md)——后备 tab 导航。
- [Better-sidebar 扩展 API](../ui-better-sidebar/AGENTS.md)——可选 tab 注册。

-----

<a id="model-experience"></a>
## 模型体验

### 可点击文件引用指引

#### 模型看到的内容

一段固定提示词要求模型在最终回复中点名成功创建或修改的主要文件，并将这些文件以及正文中提到的其他本轮变更文件写成采用精确路径或唯一 basename 的 Markdown 行内代码，例如 `out/report.html`。

#### Token 影响

加载本包时增加一段固定提示词；不增加工具 schema、工具结果或按回合变化的上下文。

#### KV Cache 影响

该段落在本包挂载期间始终以 first-party 顺序 9000 保持静态，因此留在可复用的提示词前缀中，不会随回合改变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定当前改动卡片和比较服务：

- **比较内容只保留在活动 Host Session 中**——Host 重启或 Session 销毁后，仅保留事件也无法重建差异。
- **摘要或比较缺失时不猜测路径**——摘要缺失会隐藏卡片，已打开的审阅会区分缺失记录和可重试读取错误。
- **二进制或超大捕获没有文本差异**——超过 10,000 行的比较显示截断提示。
- **行内文件提及只认精确路径或唯一 basename**——产出路径与显式交付路径使用同一套匹配规则。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

本实现选择性适配官方 `b784e586ef`（回合改动）和 `8225e18d70`（逐文件审阅），并保留 `2440937459`、`974d0271c0`、`4233590de6` 的捕获上限、Windows 行为和 Git 配置隔离修复。集成使用本地侧栏 API，不引入 Session references 或替换 slots 系统，也不修改 Settings 样式。

</details>

**运行时不变量：** 不发布运行时不变量伴生入口，因为 UI 从已记录事件和源文件读取结果派生卡片，不独立持有持久状态。提示词、slot、字典、事件定义和可选服务注册均由 effect 管理，并随插件生命周期释放。
