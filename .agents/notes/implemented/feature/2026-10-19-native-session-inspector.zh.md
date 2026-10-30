# Agent Note: 原生只读 Session 检查

Status: implemented

[English](2026-10-19-native-session-inspector.md) | 中文

## Problem

读取已加载的 Session 日志和 Chat 结构不需要 Node 调试端点或网络采集。经同一可选组合包提供这些能力，会将普通只读诊断绑定到高权限运行时访问，并重复开发者可见性控制。

## Decision

[只读检查器](../../../../packages/client/ui-session-inspector/README.zh.md)属于 `packages/client/ui-session-inspector`，发布名为 `@deepseek-ai/dsh-client-ui-session-inspector`。Web 与 Desktop 组合一次，共享开发者工具偏好控制 tab 和拾取器可见性。高权限 Inspector bundle 不再插入或安装另一份只读插件。Node 调试和 fetch 采集仍是显式安装的实验能力。

稳定包保留现有 `session-inspector-log` 类型及历史实现 ID，使已保存 Sidebar tab 继续解析。Host discovery 入口不执行操作，消费已加载 Session/Chat 来源，不增加模型输入或持久事件，不导入实验运行时。此决策部分替代 [Session Inspector 决策](2026-09-24-session-inspector.zh.md)的包归属与可选组合选择；其数据、导航和交互决策继续有效。

## Alternatives considered

给稳定 bundle 增加实验依赖违反产品隔离。只隐藏可选 bundle 而不加载替代实现会留下失效入口。修改保存的 tab 身份会引入不必要的布局迁移。为原始日志查看自动启动高权限调试，会授予无关权限。

## Consequences

原始加载数据仍不脱敏，沿用已有已鉴权 Session 访问。可见性偏好不是数据授权策略。关闭时释放作用域 tab 与活动拾取器，快速变更串行处理并恢复单个注册。所属测试覆盖这些生命周期、Loader 加载/卸载、tab 身份保留、分页、对象导航及表格行为，稳定打包检查实验输入隔离。浏览器快照和实际视觉验收仍需独立证据。
