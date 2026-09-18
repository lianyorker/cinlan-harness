---
description: "供 Host 报告消费者使用的实时与持久 Session 已知 Turn 精确用量汇总。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-query

[English](README.md) | 中文

## 摘要

此 Host 服务在不启动 Agent 的情况下汇总实时和冷 Session 的已记录用量。它复用 token-meter 对已完成 Turn 的核算，包含重试，排除分叉继承的事件，并区分精确的已知总量与缺失的核算信息。它适用于以 Harness Session 历史为数据源的本地用量报告。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发说明](#dev-note)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

将此插件与具体的 [Session Query 提供方](../session-query-sqlite/README.zh.md)一起挂载。在受信任的 Host 代码中调用 `ctx.usageQuery.query(request, signal)`。浏览器客户端通过经过身份验证的[用量控制器](../../api/usage-controller/README.zh.md)访问。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `maxSessions` | 200 | 每次查询最多观察的 Session 数量 |
| `maxEvents` | 200,000 | 允许进入汇总的源事件总数上限，包含继承前缀 |
| `timeoutMs` | 15,000 | 覆盖列表、冷读取和汇总的协作式超时 |
| `maxRangeDays` | 366 | 时间区间的最大天数 |

所有上限都是正整数。查询接受包含起点的 `from` 和不包含终点的 `to` Unix 毫秒时间戳，以及可选的精确 `provider`、`model` 筛选条件。区间归属按 Turn 开始时间确定，因此跨午夜的 Turn 归入开始日期。从 Turn 中途分叉的 Session 将其自有尾部标为未知，并用第一个自有生命周期事件的时间确定区间归属。

完整的空报告包含零个 Turn，且没有 token 总量。提供方明确报告零用量的 Turn 则具有真正的零 token 总量。核算信息不完整的 Turn 会增加 `unknownTurns`，其 token 不会被视为零。已知与未知 Turn 共存时，token 数值仅为已知 Turn 的精确小计。推理 token 属于输出的子集，不会重复累加。只有每个已知 Turn 都报告相应值时，可选的缓存与推理分项才会出现。

提供方和模型分组仅使用规范折叠能够证明的归属粒度。跨多个模型的 Turn 可以保留唯一提供方，但没有唯一模型。失败的重试尝试通常缺少模型归属，其 token 仍计入未筛选的已知小计。精确筛选会排除无法归属的 Turn，并将响应标为部分结果，而不会猜测路由归属。提供方和模型列表描述未筛选的时间区间。

源读取失败或观察数量、事件数量上限阻止纳入数据时，查询返回覆盖计数及稳定的部分结果原因。调用方取消、服务卸载、超时、无效时间区间和不安全的整数汇总会使操作拒绝。结果不再需要时，应取消调用方的请求控制器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

服务通过 `sessionQuery` 读取优先使用实时数据的观察结果，禁用投影计算，并释放每个观察租约。它只处理观察结果的自有事件后缀，按 Turn 分组，再调用 token-meter 的公开 `deriveTurnTokenUsage` 函数。已记录的步骤开始和重试开始事件提供尝试次数；重复的用量样本不会产生额外尝试。

每次请求拥有一个超时控制器，并将调用方与服务生命周期的取消信号传递到底层读取。卸载会取消所有进行中的查询并等待其结束。服务不保存用量账本或报告缓存，也不追加 Session 事件。本包不发布不变量配套入口，因为每份报告都通过 token-meter 的规范 Turn 核算从 Session 观察结果派生用量，没有需要核对的独立维护用量状态。

<a id="dev-note"></a>
### 开发说明

持久化夹具测试覆盖重启、重试、继承历史、实时截面、未知与零的区别、精确筛选、源限制、取消和等待式卸载。控制器包提供 Loader/HTTP 身份验证组合测试。公开浏览器报告类型位于 `./types`，使仅导入类型的消费者无需导入 Host 服务入口。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session Query](../session-query/README.zh.md)负责实时和冷观察及预备日志缓存。
- [Token meter](../../llm/token-meter/README.zh.md)负责完整 Turn 核算和可选提供方分项。
- [用量控制器](../../api/usage-controller/README.zh.md)负责浏览器传输和经过脱敏的查询错误。
- [用量设置](../../client/ui-settings-usage/README.zh.md)负责筛选、呈现和 CSV 下载。

-----

<a id="model-experience"></a>
## 模型体验

无，因为服务仅读取已记录的核算信息，不注册提示词、工具或模型可见事件。

#### KV 缓存影响

无；用量查询不会组装或发送提供方请求。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

报告只覆盖所连接 Host 上保留的 Harness 历史。已删除的 Session 和外部 CLI 或提供方历史不在其中。它不是账单，不提供货币估算，也不会推断缺失的提供方用量。区间包含分别捕获的 Session 观察，而非一次全局数据库事务。

Session 和事件上限约束汇总工作，不约束冷日志解码。现有观察 API 可能先准备完整冷日志，再得知事件数量。取消仍是协作式的；压缩日志帧可能完成解码后才观察到取消。严格的解码前字节或事件准入策略需要 Session Query 与持久化模块提供支持。上限优先选取创建时间最新的 Session，并明确报告遗漏的覆盖范围。
