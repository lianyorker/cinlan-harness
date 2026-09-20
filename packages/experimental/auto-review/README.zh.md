---
description: "可选的实验性授权审查，在原生与 PTC 内层工具调用前使用当前智能体的模型检查权限。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-auto-review

[English](README.md) | 中文

## 概述

安装此可选 bundle，可在会话权限选择器中启用自动审查（Auto review）。当前智能体的模型会在每个受支持的工具调用以完全权限执行之前审查该调用。用户选择 Auto 之前，现有会话与未来会话默认值均不变。此功能是实验性的，可能放行不安全操作或拒绝有用操作，并额外消耗 token。

AutoReview 是需要外部安装并显式启用的 bundle。参考发行版的可选 bundle 列表只有 AgentTeam，没有 AutoReview；该列表与本移植均不表示 AutoReview 在标准配置中启用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装与配置

使用已构建或打包的 0.1.6-alpha.2 版公开实验软件包以及兼容的 dsh profile。安装或移除外部层之前先停止 profile，完成后重新启动。在仓库根目录，CLI 安装形式如下：

```sh
dsh plugin --profile web add ./packages/experimental/auto-review
```

软件包清单声明了 `dsh.bundle.patch`。profile 管理器会追加 [cordis.patch.yml](cordis.patch.yml)，将此插件插入为 `auto-review` 条目。手工组合 profile 时，等价的 Host 条目如下：

```yaml
- id: auto-review
  name: '@deepseek-ai/dsh-experimental-auto-review'
```

profile 必须已经提供 LLM、Session、工具、会话投影与权限预设服务，以及这些预设所需的具备沙箱能力的 shell 和审批服务。配置中的 `danger-full-access` 预设必须解析为 `danger-full-access` 沙箱和 `never` 审批，否则选择或恢复 Auto 会失败。真实运行还需要当前 provider 与模型的凭据；mock 验证不需要凭据。

在编辑器或 `/permission` 选择器中选择 `自动审查 (EXP)` 并确认风险对话框。直接输入显式命令 `/permission auto` 会直接切换。Auto 不会出现在 General 设置或未来会话默认值中。移除外部层：

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-experimental-auto-review
```

### 审查决策

低风险项目操作会被放行。不可逆更改、外部写入与安全设置更改等中风险操作，要求当前人类或直接父智能体明确授权操作、目标和范围。敏感信息外传始终被拒绝。响应格式错误、缺少已记录调用事实、provider 失败或权限冲突均会拒绝执行，绝不会回退到人工审批或静默执行。

进程内子智能体在 fork seed 与策略覆盖之后继承委派时的 Auto 或完全权限标识。已有子智能体权限限制和后续工具检查继续有效。其他进程后端保留自己的授权体系。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

此 bundle 复用[权限服务](../../interaction/permission-presets/README.zh.md)与[工具流水线](../../core/tools/README.zh.md)，不提供独立审批服务、设置命名空间或开发者工具审查角色。模型请求包含五部分：固定策略、cwd、带来源的项目约束、经过筛选的带来源历史与待执行操作。助手文本、思考、工具结果及无来源系统消息均不能授予权限。

原生审查读取已记录请求的 schema。PTC 审查使用冻结的绑定 schema，它仅通过执行元数据传递。拒绝会持久化结构化错误名称、代码和可选原始原因；主模型只接收不含该原因的固定拒绝消息。无需更改 Session 格式或重新生成已提交 fixture。

销毁会关闭准入、中止待定审查，并等待结束后才移除钩子。遵循参考实现，移除时存活的 Auto 会话会切换到完全权限；如果希望保留受限策略，请在移除层之前先选择受限预设。没有活动审查器时，已持久化的 Auto 会话无法恢复。[决策记录](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.zh.md)说明权限与生命周期的设计依据。

不发布运行时不变式伴生模块：此 effect 负责准入、审查登记、取消与清理，没有可能独立偏离的观测；权限、工具和 Session 服务继续负责各自的不变式关系。mock 测试覆盖权限、取消、委派与销毁；Loader 组合使用脚本化模型验证真实智能体循环。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 工具授权审查

#### 模型看到什么

不会向主智能体添加工具或提示。被拒绝的原生或 PTC 内层调用报告 `Auto review rejected tool "<name>"; its body was not executed`，不暴露审查器原始诊断。外层 `run_code` 不接受审查。

#### Token 影响

每次被审查的调用使用保留的 Session 上下文和待执行动作发送独立模型请求。审查器输出不进入主智能体历史；拒绝会增加普通失败工具结果。

#### KV Cache 影响

主智能体提示词和工具前缀保持不变。每次审查请求包含当前保留历史及提议调用，因此前缀复用取决于所选提供方和共享请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Auto 使用完全权限，不是确定性的安全屏障。外层 `run_code` 中直接执行的 JavaScript 操作会绕过内层工具审查。
- 权限目录可用性随集成注册和卸载更新。仅启动时应用的 profile 仍在重启后应用已安装包的变化。
- 原始原因保留为持久化的结构化元数据；继续使用普通工具错误呈现，不提供专用拒绝卡片。
- 审查器同步读取保留的 Session 历史。压缩检查点可以保留事实，但不会继承被删除指令的授权能力。
- 源码 Loader 和 mock 测试不认证真实模型决策、registry 发布或外部 profile 安装。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
