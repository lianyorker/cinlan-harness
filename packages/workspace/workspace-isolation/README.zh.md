---
description: "按 Session 管理工作目录隔离的服务定义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-isolation

[English](README.md) | 中文

## 概述

此服务定义让 Consumer 按 Session 获取、检查、比较、集成、保留和恢复隔离工作目录。Provider 决定 checkout 路径并验证每项生命周期操作；Consumer 只使用租约标识，不提交任意 repository、branch 或删除路径。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

挂载具体 Provider，而不是直接实例化抽象服务。Git 实现见 [workspace-isolation-git](../workspace-isolation-git/README.zh.md)。Consumer 使用 ensure 或 acquire 获取可用路径；sourceFor 只把匹配租约的 Session id 和精确 cwd 映射到源 Workspace。

Client-safe 类型消费者可从 `@deepseek-ai/dsh-workspace-isolation/types` 导入 Provider-neutral 词汇；该子路径不产生 runtime service 或 Host augmentation。

<a id="understand-the-implementation"></a>
## 理解实现

find 与 list 返回租约快照；activate 物化已有租约，hibernate 回收 checkout 并保留分支，inspect 与 compare 返回受限的审查数据。merge 与 cherryPick 通过已记录的 source checkout 集成，exportPatch 返回内容但不接受目标路径，teardown 则在未合并分支必须持久保留时返回 removed 或 review。准入、集成、清理与孤儿发现由 Provider 负责。

注册表通过 sourceFor 校验受管 checkout 的来源，不依赖 Session 事件正文。无 Provider 的组合按普通 cwd 校验工作区成员。

<a id="model-experience"></a>
## 模型体验

### Session 工作目录

#### 模型看到的内容

本包不添加提示词。Consumer 使用租约的 `checkoutPath` 作为 Session cwd 时，普通工作目录上下文反映该路径。

#### Token 影响

本包没有直接 token 成本。

#### KV Cache 影响

固定 Session cwd 不因租约休眠和恢复而改变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本服务不直接决定新 Session 是否隔离；Consumer 必须显式执行准入与生命周期操作。
- Patch text 不包含 active untracked 文件；comparison 与 export 会报告该遗漏。
- Git 孤儿扫描只覆盖持久租约记录涉及的仓库，不能发现完全没有记录的仓库。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

休眠与显式 teardown 必须保持区分；保留来源映射不意味着允许任意路径清理。

</details>

不发布 runtime invariant companion，因为具体 Provider 拥有租约持久化与精确路径验证。
