---
description: "在 Web Settings 中管理 Worktree Task 默认值、审查变更并执行显式生命周期操作。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-worktree-task

[English](README.md) | 中文

## 概述

从已注册工作区创建任务，编辑后续任务的默认值，并在回收 checkout 前审查变更。每个任务保留其捕获的起始位置与 setup/cleanup 程序。loopback Settings 页面支持显式激活、休眠、归档和安全删除，并显示 Host 错误与保留分支的结果。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将插件与 Locale、Settings、Remote 和 Workspace UI 适配器一起挂载。创建表单选择已注册工作区，以该工作区目录初始化来源路径草稿。省略起始 ref 时使用已保存的 Provider 默认值，初始为 `HEAD`。可选工单链接属于任务元数据，不写入工单 Provider。首次成功加载任务列表前禁用创建。刷新失败时保留此前已加载的记录，并显示 Host 错误；创建被拒绝后保留草稿。

**新任务默认值**通过一次带 revision 检查的操作保存基线 ref、相对子目录及 setup/cleanup 程序。每项参数分别输入，不解析 shell 命令。可执行文件为空且没有参数表示禁用该程序。保存从不执行程序或修改既有任务。冲突保留草稿；再次保存前可用**放弃草稿并重新读取**加载当前 Host 值。

**审查**显示捕获的基线、已跟踪文件差异、未跟踪文件名、捕获的程序与清理收据。它不会激活任务或执行程序。差异按字面文本显示，不包含未跟踪文件内容。刷新会取代待处理读取。

休眠、归档和删除要求确认。休眠不执行 cleanup。归档和删除执行捕获的 cleanup，除非它已经成功；已结算的失败会保留 checkout 供审查，并允许显式重试。未结算收据阻止进一步修改。删除请求遇到未合并分支时，保留已归档记录供审查。浏览器取消不能证明回滚；重试中断的修改前应刷新权威记录。

页面使用原生行和稳定搜索锚点。本地化元数据包含标签与说明，不包含任务记录、路径或当前默认值。搜索会先打开隐藏的创建表单或策略说明再定位目标。相关注册随 slot 声明或插件一起移除。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器 Worktree Task Settings 页面不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无直接影响；任务管理不增加模型请求或 prompt 前缀。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

任务操作依赖所选 Host 组合。

- 可选的 Worktree Task row 在默认 Web 组合中仍未挂载。loopback Host 必须提供完整服务、Remote 和 UI 路径。
- 受管根目录与活动 checkout 配额属于部署配置。分支前缀属于 Git 设置；没有独立的任务命名模板。
- 审查不提供合并、cherry-pick 或完成事件自动化。页面使用显式刷新，不订阅任务生命周期事件。
- Cleanup 无法保证外部副作用恰好发生一次。收据记录结算是否确定；崩溃后的未结算 claim 没有 UI 恢复入口。

不发布 runtime invariant companion，因为页面只保留本地交互状态，并重新加载权威 Remote 结果。

<a id="dev-note"></a>
### 开发备注

Cordis 服务留在注册模块中，并将类型化 locale 和回调传入组件。当前组件、控制器与真实 Web 验收证据及剩余验证记录在[验收状态](../../../.agents/plans/settings-native-acceptance-status.md)。
