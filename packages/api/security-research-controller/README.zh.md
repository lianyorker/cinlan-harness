---
description: "通过经过认证的 Remote 管理安全技能资源，并读取 Session 评估状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-security-research-controller

[English](README.md) | 中文

## 概述

在 Settings 中安装、更新、取消和移除安全技能资源。Session 消费者还可以读取安全研究配置，并导出已授权的 Finding 报告。

## 目录

- [使用本包](#use-this-package)
- [资源管理](#resource-management)
- [报告下载](#report-downloads)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

Web 组合包随 Typert 注册表挂载本控制器。安全服务为可选项。`securityResearch/describe` 读取现有服务，不挂载预设、不修改评估授权、不查询漏洞 API，也不启动外部工具。

响应区分 configured、not-configured 和 attention。缺少目标、操作或执行主机时仍为待配置。尚未生效与过期授权保留独立状态。预设损坏、贡献未激活、技能目录为空或发现不完整时不能返回 configured。技能数量排除无关提供方，反映当前全局 security-skills 目录。

响应不包含目标值、主机标识、凭据引用、授权引用、路径、技能正文和原始预设错误。取消请求阻止迟到的成功响应。

<a id="resource-management"></a>
## 资源管理

经过认证的 `securityResearch` Remote 将资源操作交给 [`security-skills/resources`](../../security/security-skills/README.zh.md)。`describeResources` 读取当前状态；`observeResources` 推送完整替换快照，并在消费者暂停时合并进度。manager 缺失时返回 `state: unavailable` 和 `reason: component-missing`；变更操作返回明确的 resources-unavailable 错误。

安装、重装、更新、检查版本、安装内置资源和移除操作返回 manager 已受理的任务状态。受理后由 Host 持有任务：关闭 Settings、断开客户端或卸载本控制器只结束观察，不取消任务。`cancelResource` 要求提供观察到的任务 id，因此迟到的取消不会终止替代任务。manager 卸载负责关闭任务。

manager 拥有已安装资源代次、版本配置、进度、失败和技能注册表可见性，控制器不独立存储这些状态。安装包内资源要求显式选择内置安装；未配置下载来源时下载仍不可用。资源管理不执行已安装的脚本，也不要求评估授权。

<a id="report-downloads"></a>
## 报告下载

经过认证的 securityResearch/exportReport 操作接受活动 Session id 和 json、markdown 或 sarif 格式。它读取同一 Session 的完整 Finding，逐一校验报告目标是否在不可变 Session 授权内，并要求当前 Execution Host 上的 report-download 操作许可。需要审批、排除、未知、过期或撤销的授权不会返回字节。空报告也需要一个允许的授权目标。

report-download 授权通过既有认证 Harness 客户端通道下载，包括经过认证的远程客户端；它不等于任意外发的 data-export 或 external-reporting，后两者仍要求精确网络出口。报告保留 Finding 自由文本和 Artifact 引用，不嵌入 Artifact 内容。报告不执行脱敏，需要授权范围接受 none；下载后的文件没有自动保留期限控制。

maxFindings 默认 2000，maxReportBytes 默认 4194304。超过限制、Session 并发变化、分页游标不前进、取消或缺失持久存储时会拒绝整个报告，不返回部分文件。授权决策使用既有 assessment/operation-decided 事件，并在返回字节前完成 Session 存储检查点；等待后再次校验授权。

<a id="model-experience"></a>
## 模型体验

### 配置状态

#### 模型看到的内容

控制器不注册模型工具或提示词。资源响应保留在 Settings 中；安装后的目录变化由[技能提供方](../../security/security-skills/README.zh.md)持有。报告下载审计事件只记录日志。

#### Token 影响

无；状态响应不加入模型请求。

#### KV Cache 影响

无；状态读取不改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 配置完整不等于运行就绪或动作授权。控制器不验证外部工具、网络连通性、Finding 持久化或所有工具执行路径的策略覆盖。范围编辑使用 Settings 命名空间；插件安装、Finding 浏览及全部 shell/browser/network 强制授权仍需单独实现。

不发布运行时 invariant companion：控制器投影服务持有的状态，仅保留观察者生命周期。


<a id="dev-note"></a>
### 开发备注

状态仅描述配置。执行策略仍由负责效果的消费者持有。
