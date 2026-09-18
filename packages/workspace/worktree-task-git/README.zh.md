---
description: "具备有界 checkout 生命周期操作的 Git Worktree Task 提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-worktree-task-git

[English](README.md) | 中文

## 概述
本提供方使用 Git worktree 和 Harness 存储域实现 Worktree Task 生命周期操作。它串行化变更、限制 active checkout 数量、跨提供方重启保留 task 记录，并且只清理由自身拥有的路径。Session 绑定让 Remote 和 task 消费者使用 task id 定位任务，而不会获得任意文件系统权限。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将提供方与 `storageDomain` 和 `subprocess` 提供方一起挂载为 `ctx.worktreeTask`。配置其受管 checkout 根目录（默认 `<DSH_HOME>/worktree-tasks/v1`）、活动 checkout 上限和子进程限制；每个创建请求提供源仓库路径。

创建要求源仓库干净：已暂存、未暂存和未跟踪变更均会导致拒绝。创建操作规范化仓库与源路径，并在创建任务前记录仓库根目录、请求的基线引用和解析后的基线提交。

[Git 偏好](../../git/git-settings/README.zh.md)仅应用于新任务分支。无前缀模式创建 `dsh/task/<uuid>`。自定义模式添加非空字面值，必要时补充分隔斜杠。Git 用户名模式依次读取仓库本地的 `github.user`、`user.username`；不会读取 `user.name`、全局或包含配置文件，也不会查询网络身份。用户名缺失或无效时操作失败，并提示设置本地配置或更改前缀模式。

Git 在容量驱逐或 worktree 变更前使用 `check-ref-format --branch` 验证带前缀的分支名。自定义值无效时操作失败，不会休眠已有任务。Settings 服务缺失或 Git 命名空间未注册时显式解析共享默认值。设置变更不会重命名已记录分支，包括重新激活或提供方重启后的分支。

创建操作不会抓取或快进本地基线，即使已保存的基线刷新偏好为 true。提供方检查点提交保留其自身的消息、署名和禁用签名策略，包括 `--no-gpg-sign`。

带 revision 的默认值选择起始 ref、受管根下的相对目录，以及参数数组分离的可选 setup/cleanup 程序。创建操作解析并捕获这些程序，在任务发布前直接于所属 checkout 中执行 setup。保存默认值不执行程序，重新激活从不重复 setup。修改只影响未来任务。绝对路径、上级跳转、链接及与已预留 checkout 重叠的目标都会在容量回收前被拒绝。创建、绑定、激活和程序执行都要求工作目录存在于 checkout 内，所有权检查还会校验其受管祖先目录。

显式归档和删除在 checkpoint 与 checkout 回收前执行捕获的 cleanup；休眠、容量回收和启动恢复都不执行它。非活动任务可能为此显式清理而重新激活。执行前持久化 running claim，回收前持久化成功收据。先归档再删除不会重复 cleanup。安全删除被拒绝时，未合并分支保持已归档状态。

已结算的 cleanup 失败会保留 checkout，并允许显式重试；重试可能重复外部副作用。崩溃、进程退出未知或成功收据写入失败会留下未结算 claim 并阻止重跑；操作员必须先检查 checkout 和外部系统再恢复。失败和未结算 cleanup 的 checkout 不参与自动回收。任务删除后，清理收据仍保留在 Provider 存储域中；既有已归档任务不会补执行 cleanup。

Git 和生命周期程序共用受管子进程执行器的逐流 `maxOutputBytes`、`commandTimeoutMs`、`graceMs`、取消，以及命令和进程树退出等待。非零退出、输出截断、取消和超时均会拒绝，包括超时后以零退出。创建失败且结算已知时，回滚会核对新的 worktree 与分支，仅删除属于本任务的分配；这包括 Git add 完成后发生的取消。结算未知时保留它们，并报告分配的 task id、分支和路径，供操作员检查。回滚拒绝无关目录占用，会报告失败，且无法撤销外部副作用。

<a id="model-experience"></a>
## 模型体验

间接通过 Worktree Task Remote 和 Settings 消费者产生影响。

#### KV Cache 影响

无直接影响；只有选择纳入它的消费者才会把 Git checkout 状态传给模型。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 提供方需要 Git 可执行文件和可写的 task storage root。
- 提供方记录和 checkout 清理只在配置的 Host 上有效，不是分布式 lease 服务。路径检查不会锁住目录以阻止外部并发替换。任务发布前的 Host 崩溃没有持久化创建日志负责恢复。
- Hook 使用 Host 子进程 Provider 的权限执行。收据不能让外部副作用恰好发生一次，也没有自动恢复逻辑清除未结算 claim。
- 只读审查返回有界的已跟踪文件差异、未跟踪文件名、捕获的程序与清理收据。它不整合分支或激活 checkout。

不发布 runtime invariant companion，因为提供方的权威 task 状态通过服务方法观察，而不是通过独立 invariant 流。

<a id="dev-note"></a>
### 开发备注

提供方拥有子进程取消和清理；调用方必须使用 task id 和生命周期方法，不要重建路径。当前验收证据与剩余验证记录在[验收状态](../../../.agents/plans/settings-native-acceptance-status.md)。
