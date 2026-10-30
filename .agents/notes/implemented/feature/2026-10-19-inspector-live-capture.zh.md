# Agent Note: 实时 Inspector 采集请求

Status: implemented

[English](2026-10-19-inspector-live-capture.md) | 中文

## Problem

通过插件重载修改采集会替换调试 Worker 和浏览器端点。UI 设置不能在未明确确认时开启敏感采集，也不能把持久化意图与已应用的运行状态混淆。

## Decision

[Inspector 参考](../../../../packages/experimental/inspector/README.zh.md#host-fetch-capture)拥有实时采集引用与可等待的句柄操作。采集变更围绕单一 observer 所有者串行处理；关闭恢复 fetch 并等待旧观测结清，Worker 身份和保留记录不变。每次安装 observer 使用独立请求 ID 命名空间，避免 Worker 保留存储中的冲突。已停止包装器引用委托原 fetch，晚到响应和错误不再发布观测，也不取消应用自己的请求。关闭实例会拒绝待处理的开启动作，等待采集清理后释放 Worker。安装失败拒绝句柄操作且允许重试。Host 插件记录异步应用失败，不把保存配置宣称为运行状态。

既有开发者工具分区只消费通用设置命名空间，不导入实验运行时值。每次 UI 开启动作都要求新的敏感数据确认，后端撤回或只读时关闭确认，经带版本检查的表单写入。持久化 true 在 Host 重启后继续采集，不再次确认。该偏好及 UI 均不挂载缺失的调试后端。[默认关闭决策](2026-10-19-inspector-fetch-opt-in.zh.md)继续有效，本变更新增实时消费者，不改变调试权限或实验隔离。

## Alternatives considered

重新挂载会丢失端点并要求浏览器重连。把保存值当成活动状态会隐藏应用失败。确认框不约束程序性 profile 写入，后者仍是显式配置操作。关闭时删除已保留诊断会增加无关数据擦除行为。

## Consequences

关闭停止观察，不撤销对已保留敏感内容的访问或调试求值。测试覆盖真实 Worker 分时段采集、默认关闭、串行变更、安装失败重试、关闭竞态、同 fiber Loader 更新、profile 冷启动、确认取消与失效、只读状态和已接受值 UI 反馈。浏览器视觉与稳定产品晋升仍需单独完成。
