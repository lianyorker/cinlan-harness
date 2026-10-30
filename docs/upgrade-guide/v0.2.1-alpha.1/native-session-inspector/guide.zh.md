---
kind: upgrade-guide
description: "只读 Session Inspector 迁入原生客户端包，不再依赖高权限调试组合包。"
---

# 原生只读 Session Inspector

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-experimental-session-inspector` 晋升为 `packages/client/ui-session-inspector` 下的 `@deepseek-ai/dsh-client-ui-session-inspector`。Web 与 Desktop 以 `session-inspector` 组合一次只读插件，共享开发者工具偏好控制其 Sidebar 入口及拾取器生命周期。可选 `inspector-profile` bundle 仅挂载高权限 NodeJS Inspector，不再加载另一份只读插件。

现有 `session-inspector-log` tab 类型及历史实现 ID 保持不变，以保留已保存 Sidebar 布局。不改变 Session 事件或数据格式。原始检查仍不脱敏，但不启动调试端点或网络采集。

## 迁移

1. 将直接依赖、导入和自定义插件行中的实验 Session Inspector 包名替换为 `@deepseek-ai/dsh-client-ui-session-inspector`。已组合当前 Web bundle 的 profile 不要重复添加插件行。
2. 使用「设置 → 数据与高级 → 开发者工具」显示或隐藏只读检查入口。在右侧 Sidebar 打开会话数据诊断，确认原始数据与对话分组可检查当前 Session。关闭偏好会移除入口并取消拾取。
3. 除非明确需要高权限运行时调试，否则保持 `inspector-profile` 停用。移除该可选 bundle 不会移除原生 Session 检查。网络采集仍需单独明确请求。
