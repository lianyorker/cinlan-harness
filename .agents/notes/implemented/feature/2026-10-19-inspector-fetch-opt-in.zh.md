# Agent Note: 显式 Inspector fetch 采集

Status: implemented

[English](2026-10-19-inspector-fetch-opt-in.md) | 中文

## Problem

启用运行时诊断会隐式采集完整 fetch URL、headers 与 body，包括凭据。Session 数据检查和调试器启用都不等于用户有意保留网络载荷。

## Decision

[Inspector 库与插件](../../../../packages/experimental/inspector/README.zh.md#host-fetch-capture)及可选 Inspector bundle 将 `captureFetch` 默认设为 false，仅明确设为 true 才安装 fetch observer。不采集的 Worker 保持当前全局 fetch 函数不变，源码发布与调试仍可用。显式采集保留既有未脱敏字段、上限、取消和清理行为。

此决策部分替代 [Session Inspector 决策](2026-09-24-session-inspector.zh.md)的隐式采集选择；数据归属、导航和运行时传输仍有效。Bundle 保持实验状态且默认关闭。本变更不向稳定组合增加调试器或新设置。

## Alternatives considered

隐藏 Network 面板不会阻止观察。将普通代码视图可见性等同采集同意，会把安全敏感行为交给展示偏好。临时部分脱敏可能暗示无法覆盖任意 URL 与 body 中敏感信息的保证。

## Consequences

网络诊断需要明确的 profile 或库选项并重新加载插件。关闭采集不移除调试器求值权限，本地调试端点仍有高权限。测试使用合成本地流量和真实 Worker 验证默认及显式 false 不采集、显式 true 完整采集、全局 fetch 恢复、Loader 组合、回滚及清理。不据此认定稳定晋升或浏览器视觉验收通过。
