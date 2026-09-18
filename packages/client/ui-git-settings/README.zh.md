---
description: "原生 Git 偏好页面、持久化反馈与运行时消费方限制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-settings

[English](README.md) | 中文

## 概述

在开发设置组中配置新 Worktree Task 的分支前缀，以及源代码控制的分组顺序、上游比较和提交署名。页面编辑由 [Git settings](../../git/git-settings/README.zh.md) 拥有的持久化 `git-source-control` 命名空间。本地基线刷新不可用；已保存值仍可显示和重置。

## 目录

- [使用本包](#use-this-package)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

选择分支前缀模式与源代码控制分组顺序，或更改上游比较和署名。禁用的基线刷新开关保留已保存状态；重置会移除用户覆盖。自定义前缀文本在点击保存前保留在本地；保存被拒绝时保留草稿。保存使用开始编辑时的版本进行并发检查，放弃修改则显示最新 Host 值。自定义字段始终可见，但在非自定义模式下禁用。重置会移除显式用户覆盖，即使该覆盖等于继承值。只读与内存模式连接不能写入。

设置搜索索引六个字段的本地化标签与描述。每条结果定位到对应行；已保存的前缀及其他当前值不会进入索引。

<a id="implementation"></a>
## 实现

渲染器通过标准注入钩子绑定命名空间快照。写入与重置使用操作读取的版本进行并发检查，只有权威回读确认了请求值或覆盖移除，才会报告成功。SettingsScope 变更操作完成本身不代表持久化成功。页面在保存时禁用并发控件，仅在成功保存或重置后清除自定义草稿。

`settings.section` 贡献、开发组元数据和六条搜索描述共享一个 `slots.inject` 生命周期。分区 id 保持为 `git-source-control`，顺序为 36。[设置域](../ui-settings/README.zh.md)拥有传输与持久化；[操作模块](src/client/settings-operations.ts)拥有本页面的确认结果回调。

不发布运行时不变量伴随插件：页面从设置作用域派生实时值，不拥有独立的持久化投影。

<a id="model-experience"></a>
## 模型体验

间接通过本页面编辑的 Worktree Task 和源代码控制偏好产生影响。

#### KV Cache 影响

无；本包不组装提供方请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

页面说明每个偏好的运行时适用范围：

| 偏好 | 运行时行为 |
| --- | --- |
| `branchPrefix`、`branchPrefixCustom` | [Worktree Task 创建](../../workspace/worktree-task-git/README.zh.md)将选定前缀添加到 `dsh/task/<uuid>` 前。用户名模式不提供虚构预览；创建时读取仓库本地配置。 |
| `refreshLocalBaseRefOnWorktreeCreate` | 不可用。创建操作不会抓取或快进本地基线引用。 |
| `sourceControlGroupOrder` | 排列源代码控制变更分组。 |
| `compareAgainstUpstream` | 在源代码控制中选择与上游比较；上游不可用时会提示。 |
| `enableGitHubAttribution` | 为显式源代码控制提交添加署名，不影响 Worktree Task 检查点、Pull Request 或 Issue。 |

视觉参考中的自动命名、签署、AI（人工智能）提交信息和提交语言字段在这里没有对应设置或操作。此页面不提供这些字段。
