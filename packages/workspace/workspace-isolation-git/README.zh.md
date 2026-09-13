---
description: "受管 Git worktree 租约、休眠、恢复和清理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-isolation-git

[English](README.md) | 中文

## 概述

此 Provider 为干净的 Git 工作区创建受管 worktree，并把租约与 Session 关联。休眠保留分支和 staged 及非忽略修改的检查点，同时回收 checkout。Inspection、受限 comparison、merge、cherry-pick、patch export 和安全 teardown 都只操作 Provider 拥有的 lease state。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

Cinlan profile 挂载此 Provider；单独组合需要 agents、storageDomain 和 subprocess。新租约拒绝包含 staged、unstaged 或 untracked 修改的源工作区。Consumer 使用 acquire 保护工作中的租约，工作停止后释放 reservation。

<a id="understand-the-implementation"></a>
## 理解实现

租约存放在 storageDomain。默认根目录为 <DSH_HOME>/worktrees/v1，Git 命令名为 git，活动 checkout 上限为 4，每个输出流上限为 1048576 字节，命令超时为 120000 ms，终止宽限为 2000 ms。这些值可分别通过 root/dshHome、executable、maxActiveCheckouts、maxOutputBytes、commandTimeoutMs、graceMs 配置。

休眠前验证 Git 注册与持久租约一致，以禁用 hooks、filters、签名和交互凭据的方式提交检查点。容量回收不会触碰有活动 Agent 或 reservation 的租约。merge 与 cherryPick 要求 source checkout 干净并 checkout 已记录的 base branch，且会 abort 检测到的 conflict state。teardown 只有在 ancestry 证明已经集成后才使用非强制 branch deletion；否则保留带 `reviewState: 'branch-retained'` 的 hibernated lease。

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

- 被忽略文件不写入检查点，会随回收的 checkout 消失。Active untracked 文件不进入 patch text，但会进入之后的 hibernation checkpoint。
- cherryPick 会创建不同的 commit identity，因此安全 teardown 通常会保留原受管分支供显式审查。
- Git 孤儿扫描只覆盖持久租约记录涉及的仓库，不能发现完全没有记录的仓库。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

休眠与显式 teardown 必须保持区分；保留来源映射不意味着允许任意路径清理。

</details>

不发布 runtime invariant companion，因为租约操作会在修改 checkout 前验证 Git 注册记录和路径归属。
