---
description: "面向一个本机 Host profile 的持久化 UTC 自动任务与普通 Agent 执行。"
kind: "reference"
---

# 自动任务

[English](README.md) | 中文

## 摘要

本包管理定期任务定义、独占调度与持久化运行记录，通过公开 Agent 工厂创建普通工作区 Session。新定义默认禁用，保存定义不会发起模型请求。

## 目录

- [配置](#configuration)
- [调度](#scheduling)
- [执行与恢复](#execution-and-recovery)
- [持久化](#persistence)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

默认导出为 `AutomationRuntime`，注册于 `ctx.automationRuntime`。所有配置字段均为必填，由 Web bundle 明确提供部署策略。 管理通过 Host 服务和设置 API 提供；本包不注册面向模型的工具。

| 字段 | 含义 |
|---|---|
| `profile` | 与 `ctx.get('dshProfileName')` 一致的实际启动 profile，不回退到目录或默认 profile。 |
| `clockCheckIntervalMs` | 检查实际时钟的最大毫秒间隔，须为正整数。 |
| `maxStartLatenessMs` | 计划 UTC 时刻后的允许启动窗口，单位毫秒，须为正整数。 |

保存输入必须包含已有本地 Workspace id 与规范 Host 路径。草稿解析及每次执行复核都会在访问路径前拒绝非本地绑定，即使该路径在 Host 上也存在。其他保存内容包括Agent preset id、模型提供方与 id、可选思考强度、权限 preset id 及解析后的沙箱与审批值、提示词和计划。编辑器将当前默认值复制为明确值，后续默认值变化不会改写任务。preset id 使用当前磁盘组合，不会冻结文件。

<a id="scheduling"></a>
## 调度

计划支持每小时指定分钟、每天指定 UTC 时分，或每周指定星期的 UTC 时分。固定版本的 `cron-parser` 计算明确的 UTC 时刻。不接受自定义 cron、RRULE、本地时钟规则或远程路由。

夏令时只影响本地显示。每日和每周任务保持 UTC 时间；两次每小时执行可能显示相同本地时分但偏移量不同。计时器重新检查实际时钟，不回退已保存的游标。

启动、重新启用及修改计划会跳过错过的时间并选择未来 UTC 时刻。运行期间超过配置启动窗口的计划也会跳过。错过的时间不会成为队列或虚构的完成记录。已有活动运行时，计划执行记录 `skipped-overlap`，手动运行返回忙碌。

禁用时仍可手动运行，不会启用任务或移动计划游标。请求标识支持跨重启去重。暂停只停止后续启动，不取消当前工作。取消使用普通 Agent 取消机制并等待清理。删除非活动任务仍保留记录；活动任务不可删除。

<a id="execution-and-recovery"></a>
## 执行与恢复

在调用 `agents.create` 前，一个 SQLite 事务先提交不可变输入、预分配 Session 与消息 id、执行认领及后续游标。组合了 `executionBindings` 时，未发布阶段先准备显式本地绑定，再挂载公开 Agent preset；绑定提交与最后的 Workspace 检查在 Agent 发布前同步执行。Session 记录 `kind: local` 的 `execution/bound`。未组合此可选服务的 profile 保留普通 Agent 设置流程。设置阶段重新核对工作区及权限，并应用固定权限与模型选择。Workspace 服务关联 Session，`followup` 接收带插件来源的已记录提示词。审批、提问、工具和沙箱遵循普通 Agent 行为；自动任务不会标记工作区可信或授予额外权限。

| 状态 | 记录依据 |
|---|---|
| `starting` | 认领已提交，尚未确认提示词执行。 |
| `running` / `stopping` | Agent 已为提示词准备就绪，或正在取消。 |
| `completed` / `failed` / `cancelled` | 对应提示词轮次已结束并持久化，或派发前已确定失败；原因区分具体结果。 |
| `skipped-overlap` | 已有其他活动运行，因此跳过本次计划。 |
| `interrupted` / `ambiguous` | 缺少确定执行或完成依据，产生的效果可能未知。 |

运行时通过 `agent/inbox/claimed` 关联消息 id，并读取对应轮次的 `turn/end`。仅凭空闲无法证明结果。发布最终结果前会持久化 Session 并释放 Agent，取消并等待剩余工作结束；持久化对话仍可读取。后续人工轮次不会改写结果。

崩溃或 Host 关闭时未完成最终持久化后，可通过只读 Session 依据确定已知结果。否则，未完成的启动变为含糊状态，未完成的运行或停止变为中断状态，并暂停任务供检查。不会自动恢复或重放任何执行；明确发起的新运行属于新的调用。

<a id="persistence"></a>
## 持久化

状态位于规范 Harness home 下的 `automations/<profile>/state.sqlite3`，独立 `owner.sqlite3` 位于同一私有目录。身份由规范 home 与实际 profile 组成，不依赖安装或 Desktop 暂存路径。模式版本单调递增，并拒绝不同的已记录作用域。

所有者在整个生命周期中持有 `BEGIN IMMEDIATE`，忙碌等待为零。第二个进程报告不可用，不恢复或派发工作。仅 SQLite busy 表示争用，其余失败均为错误。不对所有权文件进行过期、抢占、替换或删除。关闭时先等待工作结束再释放事务；进程死亡会释放操作系统锁。数据写入使用另一数据库。

唯一索引保护计划 UTC 时刻、手动请求标识与活动运行互斥。提交失败不会派发 Agent，快照通知仅在提交后发出。记录支持分页且删除后保留。不发布 invariant 伴随入口：修改时的 SQLite 约束保护记录，已认领但未发布的工作可明确恢复。独立进程测试验证争用与崩溃释放，而非检查进程内服务是否存在。

<a id="model-experience"></a>
## 模型体验

### 上下文注入

#### 模型看到的内容

保存的 `AutomationSpec.prompt` 原样作为已记录的 `user` 消息进入新 Session，来源为 `automation` 插件，形式为 `notice`。摘要标识任务。自动化不添加隐藏提示词或新的 Session 格式。

#### Token 影响

每次调用都会将已保存的提示词加入新 Session。其文本及提供方渲染的通知元数据会贡献输入 token，并保留在该 Session 历史中。

#### KV Cache 影响

每次调用创建独立 Session，请求前缀由所配置的 Agent 组合负责。自动化不改写该 Session 中已有的消息。提示词文本变化会改变 user 消息 token，preset 或模型变化可能改变可复用前缀或提供方路由；缓存是否可用仍由提供方决定。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

本机 Host 必须保持运行。本包不会启动系统守护进程、唤醒休眠计算机、远程路由、复用 Session、将重叠任务入队或补跑错过的任务。尚未实现本地时间规则、保留期限控件及自动任务专属通知偏好。

Workspace 记录目前在各进程内缓存，作用于整个 Harness home。记录中的准确 Workspace 与 Session id 标识每次调用；本包不会让其他并发 Host 工作区写入具备事务性。SQLite 所有权要求受支持且具有有效系统锁的本地文件系统。完成状态描述已记录 Agent 轮次，并非对业务目标的独立验证。
