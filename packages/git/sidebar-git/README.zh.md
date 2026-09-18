---
description: "手动侧边栏 Git 操作、提交审阅、缓存引用比较与 Session 仓库权限来源。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sidebar-git

[English](README.md) | 中文

## 概述

在侧边栏中查看仓库变更与历史，暂存或取消暂存文件，切换本地分支，并显式执行提交、丢弃、还原提交或 cherry-pick。在提交前审阅完整提交消息和仓库状态。比较使用本地缓存引用，不执行抓取。每个侧边栏操作都从已附加 Session 的权威工作目录选择仓库。

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

将本服务与 Session、Subprocess、Settings 和 [Git settings 命名空间](../git-settings/README.zh.md)一起挂载。[Remote 控制器](../../api/sidebar-git-controller/README.zh.md)与侧边栏 Fetch 路由调用相同操作。调用方提供已附加的 Session id；客户端提供的目录不能替代缺失的 Session 工作目录。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `executable` | `git` | Git 可执行文件名或路径。 |
| `timeoutMs` | `30000` | 每个 Git 子进程的截止时限。 |
| `graceMs` | `1000` | 子进程优雅终止等待时间。 |
| `maxOutputBytes` | `8388608` | 每个输出流及序列化响应的最大字节数。 |
| `maxMessageBytes` | `65536` | 提交消息最大字节数，包括添加的署名。 |
| `defaultLogEntries` | `30` | 默认历史分页大小。 |
| `maxLogEntries` | `500` | 历史分页大小上限。 |

限制值必须为正的安全整数，默认历史分页不能超过上限。输出超限会拒绝操作，不会返回截断的 Git 数据。取消操作和释放服务都会终止并等待其拥有的子进程退出。

### 审阅提交

暂存文件后，准备提交消息以供审阅。消息为空、暂存差异为空、HEAD 分离或索引存在未解决冲突时，准备操作会拒绝。当署名启用时，若消息尚未包含 `Co-authored-by: Cinlan IDE <noreply@cinlan.online>` 尾注，则追加该尾注，并显示完整的最终消息。确认请求携带该消息，以及观察到的 Session 目录、仓库、Git 目录、分支、HEAD 和索引指纹。执行时会拒绝已变更的事实，并要求重新审阅。

Git 通过 stdin 接收已审阅的消息，并使用 `--cleanup=verbatim`。用户钩子、身份和签名配置保持有效。结果返回提交 id 和 Git 实际记录的消息，包括钩子编辑。这些显式用户提交不会改变 Worktree Task 检查点行为。

### 比较已提交变更

启用上游比较时，服务先选择已配置的上游。如果无法选择上游，则报告使用了回退，并依次尝试本地缓存的 `origin/HEAD` 目标、本地 `main` 和本地 `master`。禁用该偏好时，直接使用相同的默认分支顺序。结果固定双方提交 id，并从它们的合并基点比较变更。尚无提交或分离的 HEAD、缺失的默认分支以及无共同历史的情况都会产生明确的不可用原因。比较不会抓取远程引用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

[服务](src/index.ts)从 Session 状态取得仓库权限来源，验证字面路径和版本，按仓库串行化自身的变更操作，并在队列等待结束后再次执行准入检查。暂存、取消暂存、切换分支和提交要求匹配显示的仓库；丢弃和历史变更还要求匹配显示的 HEAD。丢弃从索引恢复单个受跟踪工作树路径，保持索引不变。Git 冲突结果保留为仓库状态，由用户解决。

[子进程拥有者](src/process.ts)使用带 `--literal-pathspecs` 的参数数组，禁用分页器、颜色、文件系统监视器集成和可选读取锁，并移除环境中的仓库重定向。它保留用户钩子和签名策略。[共享请求类型](src/types.ts)在 Fetch 与 Remote 中携带相同事实，不引入客户端选择的工作目录。

不发布不变量伴随插件，因为服务没有独立于 Git 和 Session 状态的持久化缓存。操作执行器负责落实进程生命周期和预检验证。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Git 偏好](../git-settings/README.zh.md)——共享设置与默认值。
- [侧边栏 Git Remote 控制器](../../api/sidebar-git-controller/README.zh.md)——类型化传输与错误码。
- [Worktree Task Git](../../workspace/worktree-task-git/README.zh.md)——托管检出与检查点策略。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验

无，因为本服务仅提供显式侧边栏操作，不添加面向模型的变更工具、回合结束行为或模型输入。

#### KV Cache 影响

无；本服务不组装模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

Git 与周边侧边栏保留以下约束：

- DiffTab 通过共享侧边栏文件系统 Fetch 路由读取未跟踪文件内容。文件内容归该文件系统操作所有，与 Git 状态和 diff 查询分开。
- 本地基线刷新不可用。本服务不执行 fetch、pull、push 或 GitHub API 操作。
- 变更队列只协调本服务。准入检查及其后的 Git 写入与外部 Git 进程之间不构成单一原子事务。
- 署名插入使用 Git 的尾注格式化器保留现有尾注。若配置了尾注命令，或格式设置无法生成标准共同作者尾注，预览会拒绝继续。
- 用户钩子或签名可能拒绝提交。钩子可能编辑消息；返回的消息记录 Git 的实际结果。
