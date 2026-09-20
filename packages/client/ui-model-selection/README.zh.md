---
description: "Web GUI 的会话模型选择与新会话默认值，共用一份按提供方分组的目录；供模型路由的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

[English](README.md) | 中文

## 概述

Web GUI 允许用户通过 `/model` 弹窗或 composer 模型控件切换既有会话使用的模型与推理强度。两个界面呈现同一组按提供方分组的选择；所选模型决定可用的推理强度名称与默认值。完整选择从下一次请求开始生效；运行中的步骤保留其启动时的模型与推理强度。如果没有适配器可以服务会话路由，composer 会保持停用，直至路由恢复可用。本插件还向模型设置页贡献新会话默认值。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 `ui-conversation` 及命令包一起挂载本插件；composer 随即在待处理指示器旁显示模型位，`/model` 则以弹窗打开同一份目录。当确切提供方／模型对仍在已公布分组中时，两个表面都显示宿主报告的当前选择；目录行缺席时，可路由的选择保持不变，触发器提示 `Select model`。

### 模型与推理强度

模型按提供方分组。菜单只显示模型与推理强度名称；目录中的说明仍可供其他消费方使用。`/model` 弹窗应用所选模型的默认推理强度；composer 随后可以选择任一已公布的推理强度。适配器没有推理元数据时不显示 Effort 行；不存在任意推理强度输入。

<a id="new-session-defaults"></a>
### 新会话默认值

设置 → 模型在设置服务存在时提供默认模型与推理等级。选择会自动保存到 `agent-default-model` 命名空间，供后续会话使用。更改模型会同时写入提供方与模型，并清除前一路由的推理等级覆盖；恢复继承值会取消三个字段的覆盖，包括与继承值相同的覆盖。此处的更改不会覆盖已有会话的模型选择。在会话内切换模型也会保存后续会话的默认值。

设置不可用或只读时，控件会停用。推理等级仅提供所选路由公布的选项。写入被拒时不会显示已保存；冲突会显示恢复后的 Host 值，重试保存会使用这些值的 revision 重新提交原先的选择。

其他 DSH 实例占用 Session 写入权时，composer 选择器与 `/model` 都显示本地化提示，建议退出其他正在运行的实例后重试。其他选择失败保留诊断错误码与消息。

### 不可路由的会话

当宿主报告没有适配器服务该会话的路由时，本插件注册一个 composer 阻塞块，输入随本插件自己的文案停用；恢复后无需重新加载即清除。首次加载之前或加载失败之后的 `null` 绝不阻断；目录成员关系同样不阻断——一条仍在服务、只是不公布该模型的路由不在分组里，却可用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`ModelDirectoryResolver`（`ctx.modelDirectories`）持有一份 Host 代次级 `ModelCatalogDirectory` 与按会话惰性创建的 `ModelDirectory` 投影。`/model` 弹窗与 composer 模型位经 `session.selectModel` 提交，并共享各会话的目录；已寻址 subagent 会话不公开任一选择器。转发的适配器、设置与凭据失效通知会刷新共享目录。

`ModelDirectory.select()` 返回本次操作的 `RemoteResult<void>`，因此即使后续目录更新改变共享目录错误，每个选择器仍能呈现自身操作的失败。

默认值贡献项经 SettingsScope 绑定 `agent-default-model`，并通过呈现器钩子公开该 scope 与同一份目录。原子变更使用 scope 的 revision 校验、队列与恢复读取。保存确认会比较三个原始用户层字段，包括取消覆盖操作后的字段自有存在性；仅 promise 结束或有效值相同均不能宣告成功。控件与本地化搜索条目共享可选 `settings.models.defaults` slot 的生命周期。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当模型面不够用时阅读以下页面。它们从浏览器表面进入命令弹窗外壳与选择约定。

- [ui-commands](../ui-commands/README.zh.md)——`/model` 贡献项注册进的 popupSelect 外壳。
- [ui-conversation](../ui-conversation/README.zh.md)——声明 composer 的 `conversation.input.model` 位与 composer 阻塞块。
- [dsh-agent-default-model](../../core/agent-default-model/README.zh.md)——为从未选择的会话提供默认模型的默认模型服务。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

间接通过经 `session.selectModel` 提交的会话内选择器，以及更改后续会话所继承模型与推理等级的设置控件生效；宿主在下一次提示词组装边界对完整 `ModelSelection` 创建快照，运行中的步骤保留已组装选择。

#### KV Cache 影响

切换路由可能减少提供方侧后续请求的缓存复用，或使其失效；提示词前缀本身不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前模型表面。它们是当前包约束，不是通用模型路由器对比或任务积压。

- **无逐草稿或已寻址 subagent 选择**——设置编辑共享的后续默认值；会话内选择器要求既有普通会话的 agent，subagent 继续执行不公开独立的模型选择操作。
- **目录名仅供呈现**——选择与持久化使用提供方／模型／推理强度 id；目录查询或确切模型元数据查询失败的提供方以不可选失败行列出，重新加载前保持原样。
- **不能任意输入推理强度**——composer 仅提供确切模型由适配器公布的推理强度；适配器没有推理元数据时不显示 Effort 行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。设置 scope 与共享目录拥有持久化默认值和公布的选项；控件仅持有临时保存反馈。行为测试覆盖写入确认与贡献项释放。
