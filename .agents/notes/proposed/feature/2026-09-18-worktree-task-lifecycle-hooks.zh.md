# Agent Note: Worktree Task 捕获的程序与清理收据

Status: proposed

[English](2026-09-18-worktree-task-lifecycle-hooks.md) | 中文

## Problem

设置页面暴露已保存的任务程序前，需要执行 owner、明确触发时机和恢复规则。任意 cleanup 可能影响 checkout 之外的系统。响应丢失后重复执行，或者在后代进程退出前回收目录，都可能扩大这些影响。

## Proposal

任务 Provider 在创建时捕获已校验的默认值：起始 ref、约束在根内的相对目录，以及已解析的可执行文件/参数数组。经过身份验证的默认值操作通过 revision 检查接受配置。单次生命周期请求仍只接受 task id，不能替换命令或 checkout 路径。保存不执行程序，也不重写既有任务。

Setup 在任务发布前执行。Cleanup 只由显式归档或删除触发，休眠、容量回收和启动恢复从不触发。Provider 在执行前持久化 running claim，等待整个进程树退出，并在 checkpoint 或回收前持久化成功结果。已归档任务可以安全删除而不重复 cleanup。保留的未合并分支保持已归档状态。

已知且已结算的失败保留 checkout 并允许显式重试。崩溃、退出未知或成功写入失败会留下未结算 claim 并阻止重跑。失败和未结算 cleanup 的 checkout 不参与自动回收。收据在任务删除后保留。既有已归档任务不补执行程序。没有针对未结算 claim 的自动恢复。

独立的 `cleanup_receipts` 表使用现有第一版 KV domain，不改变已发布 Session 数据。兼容性要求通过 JSON 和 SQLite Provider 打开真实的旧版 tasks-only domain，再保存和重新打开新增表。只读任务审查返回有界变更、捕获的程序和收据状态，不激活 checkout。

本提案部分取代 [Web 组合记录](../../implemented/feature/2026-09-10-worktree-sidebar-security-integration.zh.md)中禁止浏览器配置程序的限制。该记录仍保留默认组合、生命周期 id 所有权、侧边栏及安全决策。[设置所有权记录](../../implemented/architecture/2026-09-17-native-settings-runtime-consumers.zh.md)仍拥有功能本地默认值和接受写入的规则。此改动不完整取代任何 implemented 记录，也没有因此符合归档条件的记录。

## Alternatives considered

**每次回收都运行 cleanup。** 容量和重启维护不代表显式请求任意外部副作用。Cleanup 属于用户选择的任务终结。

**重试任何未收到确认的 cleanup。** 缺少成功响应不能证明外部副作用未发生。持久化 claim 优先要求人工检查，避免自动重复。

**将程序文本作为 shell 命令。** 分离 executable 和 argv 能保留精确参数，让 shell 解释成为显式程序选择。生命周期调用不能替换已捕获的程序。

**声称恰好执行一次。** 本地收据不能与任意外部副作用原子提交。已知失败后的重试可能重复副作用；未知结果会阻止执行，不声称成功或安全。

## Acceptance criteria

- 默认值通过真实 Web 组合保存和重载；过期 revision 被拒绝，未来默认值和既有启动事实都不受影响。
- Setup 在所属 checkout 内接收精确 argv，只在成功后发布任务，激活后不重复；回滚等待进程树退出。程序执行和任务发布时，工作目录必须存在于 checkout 内；重叠预留在容量回收前被拒绝。
- 真实 Git add 完成后取消，仅核对并回滚属于本任务的分配。结算未知时保留分配并给出具体恢复诊断；替换进去的无关目录在回滚中保留。
- 归档/删除 cleanup 在持久成功后去重，保留失败 checkout，并在结算未知或成功写入失败后拒绝重跑。
- JSON 和 SQLite 的第一版 tasks-only 数据无损打开，收据跨删除与重启保留。
- 真实 Web 审查显示已跟踪差异和未跟踪文件名而不修改；休眠跳过 cleanup，归档显示收据。
- 生成的 Remote 声明、Host/Client 类型检查、定向行为测试及组合 Web/Electron 验收通过。当前执行状态归[验收记录](../../../plans/settings-native-acceptance-status.md)所有。

## Risks

程序使用 Host 子进程 Provider 的权限运行，可能修改外部系统。已结算失败后的显式重试可能重复副作用。未结算收据需要在此 UI 之外由操作员恢复，并占用保留 checkout 的容量。文件系统检查只反映检查时刻，外部替换可能与之竞争；发布前的 Host 硬崩溃没有持久化创建日志负责恢复。当前验证证据与剩余验收工作归[验收记录](../../../plans/settings-native-acceptance-status.md)所有；全部验收条件满足前，本记录保持 proposed。
