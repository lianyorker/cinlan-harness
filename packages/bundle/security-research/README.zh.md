---
description: "安全研发 profile 组合层：为 dsh profile 提供授权评估范围、持久 Findings、证据 Artifact、漏洞查询、Skills 与工作流指导。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-security-research

[English](README.md) | 中文

## 概述

本组合包为基于 base 的 dsh profile 添加安全研发表层。它挂载安全工作所需的证据、评估、Finding、漏洞知识库、技能与工作流提供方。默认范围不包含目标或操作。可选 assessment-scope-tool-policy Consumer 会在默认 shell、网络和 Browser 模型工具产生效果前检查范围；集合外的 Consumer 仍需自己的守卫。使用 `dsh plugin --profile <name> add @deepseek-ai/dsh-security-research` 添加。

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

### 安装到 profile

将此层添加到现有 profile，然后重启应用，使 profile patch 重新协调：

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-security-research
dsh plugin --profile <name> remove @deepseek-ai/dsh-security-research
```

随附的 `security-research` profile 会在 `dsh-base` 与 `dsh-web-app` 之后包含此组合包。自定义 profile 必须先包含 base 层。

### 你得到什么

此层在 $DSH_HOME/artifacts/v1 挂载本地持久化 Artifact 存储、本地 Execution Host 身份、评估范围与 Session 绑定、持久 Finding 工具、NVD/OSV 漏洞查询、内置 Security Skills 提供方以及安全工作流提示。组合包在预设注册表存在时贡献随包的 `security-research` Agent 预设。该预设在编码组装上增加研究 persona 与作用域内的 Security Skills。profile 全局安全提供方与工具仍然共享。只有名单包含该预设时，Settings 才显示安全研究；通用 Web profile 不会仅因 CLI 安装依赖而获得它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本组合包是一份静态 Loader patch。插入列表先提供提供方，再提供消费者；只有拥有独立观察的包才发布 invariant companion。评估行从空的授权 grant 开始；后续 profile patch 可以替换完整配置，加入操作者的目标、操作、证据策略与 Execution Host 身份。后续层会整体替换行配置。

组合行见 [`cordis.patch.yml`](cordis.patch.yml)，包载体见 [`src/index.ts`](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Profile 组合](../../boot/app-boot/README.zh.md)——profile 发现与组合包分层。
- [Finding 服务](../../security/finding/README.zh.md)——持久 Finding 数据与状态转换。
- [Security Skills](../../security/security-skills/README.zh.md)——内置技能发现。

-----

<a id="model-experience"></a>
## 模型体验

间接通过插入的 Finding、漏洞、Skill 与工作流包，以及可选研究预设的 persona、作用域内技能目录和编码组装产生影响。

#### KV Cache 影响

组合包本身不直接添加提示前缀。工作流提示与工具分别负责自己的提示和工具 schema 影响；选择研究预设会改变其 persona 前缀与作用域内技能目录，不改变 Host 持有的模型路由。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 随附的评估 grant 有意保持为空。操作者必须在后续 patch 中加入授权目标、操作、主机身份与证据策略。范围服务仅约束实际调用它的消费者；shell 与网络执行适配器仍需接入强制执行策略。
- 本地 Artifact 字节与元数据在 Host 重启后保留。保留标签不会自动触发删除；加密与引用感知清理尚未实现。原内存 Artifact 无法在所属进程退出后恢复。
- NVD 与 OSV 请求需要网络访问，并受上游速率限制影响。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

组合包负责安装；安全包仍然可以作为独立 provider 与 consumer 测试。

</details>

不发布 runtime invariant companion，因为本组合包组合提供方和消费者，不拥有单独的可变投影。
