---
kind: upgrade-guide
description: "Inspector fetch 采集默认关闭，需要在 profile 或库调用中显式启用。"
---

# 显式启用 Inspector fetch 采集

[English](guide.md) | 中文

## 变更

Inspector 插件 schema、`startInspector()` 库默认值及可选 `inspector-profile` bundle 将 `captureFetch` 从 true 改为 false。启用 bundle 仍会启动高权限本地调试后端，但默认不包装全局 fetch 或采集 Host 网络载荷。只读 Session 检查由原生组合独立提供。已有显式 true 覆盖仍启用采集。

## 迁移

1. 普通 Session 或运行时检查保持采集关闭，打开 Network 面板不会开启采集。
2. 可信网络诊断需要在 `experimental-inspector` profile 行的完整配置中设置 `captureFetch: true`，或传给 `startInspector()`，设置库的初始采集。已加载的 Host 插件实时应用变更，开发者工具采集控件开启前要求风险确认。已保存的 true 在 Host 重启后继续采集，不会再次确认。库调用方可等待 `handle.setCaptureFetch(enabled)`；`close()` 后再启用会失败。Profile 补丁替换完整配置，请保留其他覆盖值。
3. 将采集的 URL、headers 与 body 视为敏感信息，不提供脱敏。关闭 Inspector 会停止其 observer；仅关闭采集不限制调试器代码执行权限。
