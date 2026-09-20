---
description: "默认请求审批的可选原生 Cua Driver 桌面工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-computer-use

[English](README.md) | 中文

## 概述

向显式选择的 profile 添加原生 Cua Driver 桌面工具。每次原生调用默认请求审批。SDK 在 Harness 主机进程内运行，要求主机具备桌面权限并处于已登录的图形会话中。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 [dsh-base](../base/README.zh.md) 之后组合此可选 profile patch 层。未明确引用本 bundle 的 profile 不会获得桌面输入能力。Profile 安装和层顺序由 [app-boot](../../boot/app-boot/README.zh.md#profiles) 负责。

[Patch](cordis.patch.yml) 在[电脑操作服务](../../computer-use/computer-use/README.zh.md)上选择 `cua-driver-native`，挂载[原生 Cua Driver Provider](../../experimental/computer-use-cua-driver-native/README.zh.md)，并为[权限策略](../../computer-use/computer-use-permission-policy/README.zh.md)配置 `native: ask`。本层只有这三个条目。CUA 发布发现的上游工具；本层既不包含 Orca Provider，也不包含 `tool-computer-use`。

后续 profile patch 可替换完整的 `computer-use-permission-policy` 条目配置，将 `native` 设为 `allow`、`ask` 或 `deny`。`computer-use-cua-driver-native` 条目没有 Provider 配置字段。切换 Provider 必须卸载当前 Provider，并等待其拥有的工作关闭。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本 bundle 只负责组合。服务负责独占注册，Provider 负责 SDK 发现与生命周期就绪状态，策略检查每次 `cua_driver_native__*` 执行，包括未来的上游新增工具。[架构决策](../../../.agents/notes/implemented/architecture/2026-09-20-native-cua-readiness-and-policy.zh.md)说明为何就绪状态与授权保持独立。

不发布 runtime invariant companion：本层声明配置条目，不保留可独立比较的运行时状态。

</details>

<a id="model-experience"></a>
## 模型体验

### 原生桌面工具

#### 模型看到的内容

模型收到发现的 `cua_driver_native__*` 工具和[原生 Provider 指导文本](../../experimental/computer-use-cua-driver-native/README.zh.md#model-experience)。审批和拒绝文本归权限策略所有。本 bundle 不增加自身的模型文本。

#### Token 影响

发现的 schema 与原生指导文本贡献请求 token。文本、无障碍观察和获准接纳的截图附件增加随操作变化的结果 token。

#### KV Cache 影响

固定的目录和指导文本保持请求前缀。更换 Provider 或发现的目录可能减少前缀复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- Profile 必须提供 tools、system-prompt 和 approval 服务。截图需要附件存储和声明图像输入的模型路由。
- 没有 approval answerer 的 profile 无法批准默认的 `ask` 调用。
- SDK 通过平台可选依赖随包分发。原生库位置、许可和主机要求由 Provider 负责；目录就绪不证明 GUI 动作或打包加载成功。
- 桌面控制共享主机进程和桌面。本层不添加原生客户端外壳，不按 Session 预留窗口，也不提供移动设备能力。

### 开发备注

Profile 安装与受控 GUI smoke 验证由集成任务负责；此次文档更新不宣称这两项结果。
