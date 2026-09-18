---
description: "通过经过浏览器身份验证的 API，按时间、提供方和模型查询已记录的 token 用量，并明确标示未知用量和部分结果。"
kind: "package-reference"
---
# 用量控制器

[English](README.md) | 中文

## 摘要

`@deepseek-ai/dsh-api-usage-controller` 让经过身份验证的浏览器客户端读取指定时间区间内的 token 用量。报告包含已知用量的精确小计、提供方/模型分组，以及明确标示的未知或不完整统计。查询覆盖已存储的 Session，不会激活 Agent（智能体）或修改对话日志。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在提供 `typert` 和 `usageQuery` 的 Host 组合中挂载本包。浏览器调用还需要[网关](../gateway/README.zh.md)和经过身份验证的 [Connection](../../client/connection/README.zh.md) 传输层；[用量查询服务](../../session-query/usage-query/README.zh.md)负责存储访问和查询限制。

### 最小配置

在提供上述服务的组合中添加以下配置项：

```yaml
- name: '@deepseek-ai/dsh-api-usage-controller'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| 无 | — | 此控制器没有配置字段；查询限制由用量查询服务负责。 |

调用 `ctx.remote.usage.query(request, signal)`，传入包含起点的 `from` 和不包含终点的 `to` Unix 毫秒时间戳。可选字段 `provider` 和 `model` 用于选择精确的路由标识。成功的 `RemoteResult` 信封中，[UsageQueryResult](src/types.ts) 值保留查询服务的总计、路由分组和覆盖信息；未知 token 数量仍为未知，部分报告仍表示已知用量的小计。

### 身份验证与失败

Connection 在执行控制器或访问用量存储之前拒绝未经身份验证的 HTTP 请求。有效的浏览器 cookie 来自 Connection 的启动令牌交换。取消信号从调用方经查询服务传播至持久化读取。

| Remote 错误代码 | 恢复方式 |
|---|---|
| `usage/invalid-query` | 选择有效的时间区间和路由筛选条件。 |
| `usage/query-timeout` | 选择较短的时间区间。 |
| `usage/query-failed` | 刷新后重试。 |

错误响应包含固定的公开消息和空的详细信息，不包含底层异常、文件路径、对话文本或凭据值。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

Host 服务以 `usageController` 注册，并公开 `usage` Remote 命名空间。带装饰器的 `query` 方法将请求和取消信号传递给 `usageQuery`，并返回相同结果。Loader 移除服务时会撤销其可调用端点；移除查询依赖也会停用控制器。

[控制器源码](src/index.ts)负责错误转换；[浏览器安全的类型导出](src/types.ts)引用查询服务的纯类型入口。[API 测试](tests/api.host.spec.ts)通过 Loader、真实 JSONL 和 SQLite 提供方，以及经过身份验证的 HTTP 分发读取当前格式的持久化日志。本包不发布运行时不变量配套模块，因为控制器没有可能与上述服务产生偏差的独立用量统计或授权状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [用量查询服务](../../session-query/usage-query/README.zh.md)——统计语义与部署限制。
- [Connection](../../client/connection/README.zh.md)——浏览器身份验证与 RPC 传输。
- [Typert 网关](../gateway/README.zh.md)——Remote 分发与生成的绑定。

-----

<a id="model-experience"></a>
## 模型体验

无，因为用量报告只读取统计数据，不注册提示、工具或 Session 事件。

#### KV Cache 影响

没有影响；用量查询不会改变模型请求或对话日志。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

控制器保留底层查询的覆盖限制。

- 提供方统计缺失、读取达到限制或来源不可读都可能产生部分结果；消费方必须显示这些标示，不能将小计呈现为完整用量。
- 直接调用 Host 服务不会验证浏览器身份；浏览器消费方应使用 Connection 拥有的 API 传输层。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
