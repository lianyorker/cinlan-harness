---
description: "查看并自定义已挂载操作所有者提供的生效快捷键。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-keybindings

[English](README.md) | 中文

## 概述

快捷键页面展示真实的已注册操作及其生效绑定。可以搜索列表、录制替代组合、取消操作绑定或恢复默认值。没有对应操作的旧记录仍会显示为不可用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将本页面与 [keyboard](../keyboard/README.zh.md)、设置、slot 和语言服务一同挂载。操作所有者注册各自的命令；本页面不自行定义默认值。输入框提交与补全、文件保存/查找/替换以及侧栏显隐会在所属插件挂载时出现。其他插件也可以通过键盘服务贡献有类型的命令。

选择“录制”，在焦点留于页面内时按下组合键。Escape 取消录制。输入法输入与单独的修饰键会被忽略。浏览器保留组合或同一焦点作用域内与其他操作生效绑定冲突的组合会显示说明。保存后下一个按键事件即使用新绑定，无需重新加载。

取消绑定会保存 null。重置会移除所选用户覆盖；恢复所有快捷键默认值会 unset 整个覆盖数组，包括不可用记录。设置加载中、不可用或只读时禁用编辑。写入失败会保留已接受绑定，并提供对同一选择的显式重试。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[页面](src/client/KeybindingsSection.tsx) 消费渲染器绑定的键盘快照与普通命令。录制使用本地捕获处理器，不安装全局按键监听。搜索导航会先清除页面过滤，再显示对应的 `keybinding-{commandId}` 锚点。

[插件](src/client/index.ts) 在设置 slot 的生命周期内注册个人偏好分区、命令搜索项和重置锚点。搜索只索引已注册操作的名称和说明，排除已保存绑定及不可用的用户 id。注册表变化会重新发布元数据；slot 收起或插件释放会移除这些贡献。

本包不发布运行时 invariant 伴随入口：页面直接渲染键盘所有者的快照，仅保留本地搜索、录制与待处理操作状态。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为页面只修改键盘偏好，不改变模型请求、工具或 Session 记录。

#### KV Cache 影响

无。快捷键设置不增加模型输入或 token。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

只有真实消费者注册的操作可以编辑。原生 Shift+Enter 换行继续由 Lexical 持有；已保存的 `conversation.newLine` 覆盖会作为不可用记录保留。录制仅支持单个逻辑组合键，并受键盘所有者的平台保留规则约束。
