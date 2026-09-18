---
description: "共享 Git 偏好、持久化命名空间所有权和浏览器安全的 schema 导入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-settings

[English](README.md) | 中文

## 概述

一次保存 Git 偏好，即可用于 Worktree Task 分支命名与源代码控制。偏好通过现有 Settings 提供方在 UI 重新加载和 Host 重启后保留。消费方可以导入 schema 和类型而不加载 Host 插件。本地基线刷新仍不可用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将本插件与 Settings 提供方一起挂载。本插件没有配置字段；它只注册一次持久化的 `git-source-control` 命名空间。

```yaml
- name: '@deepseek-ai/dsh-git-settings'
```

[Git 偏好页面](../../client/ui-git-settings/README.zh.md)编辑用户层。六个字段及其默认值如下：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `branchPrefix` | `none` | 新 Worktree Task 分支使用 `git-username`、`custom` 或 `none`。 |
| `branchPrefixCustom` | `''` | 选择自定义模式时使用的字面前缀。 |
| `refreshLocalBaseRefOnWorktreeCreate` | `false` | 无运行时消费方的已保存值；只支持显示和重置。 |
| `sourceControlGroupOrder` | `changes-first` | `changes-first`、`staged-first` 或 `untracked-first`。 |
| `compareAgainstUpstream` | `false` | 在源代码控制中请求与上游比较。 |
| `enableGitHubAttribution` | `false` | 为用户在源代码控制中创建的提交添加署名。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

Host 入口将注册与释放交给 Settings。`./settings-schema` 导出仅包含命名空间常量和 schema；`./types` 仅包含类型。浏览器客户端通过现有 SettingsScope 服务绑定命名空间。Host 消费方读取已注册的值；服务或命名空间缺失时，Worktree Task 创建操作显式解析 schema 默认值。

[Schema](src/settings-schema.ts)拥有默认值，[类型](src/types.ts)拥有字段声明，[Host 入口](src/index.ts)拥有注册。不发布运行时不变量伴随插件：本包不拥有可与 Settings 已解析命名空间产生偏差的独立状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Settings 服务](../../settings/settings/README.zh.md)——持久化与命名空间生命周期。
- [Git 偏好页面](../../client/ui-git-settings/README.zh.md)——编辑与重置行为。
- [Git Worktree Task](../../workspace/worktree-task-git/README.zh.md)——分支命名与验证。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验

间接通过 Worktree Task 和源代码控制对共享 Git 偏好的消费产生影响。

#### KV Cache 影响

无；本包不组装模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

消费方决定偏好的适用范围：

- 本地基线刷新没有运行时实现；已保存值仍可读取和重置。
- 分支前缀仅影响新建 Worktree Task。Git 在创建时验证与仓库相关的分支名。
- 署名适用于显式的源代码控制提交，不改变 Worktree Task 检查点签名或提交行为。
