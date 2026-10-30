# Agent Note: 实时全文搜索准入

Status: implemented

[English](2026-10-19-content-search-admission.md) | 中文

## Problem

全文搜索观察 Session 内容并拥有派生索引。用户需要停止这些请求，而不停止精确历史读取或销毁索引；用户关闭准入后，旧排队请求也不能返回结果。

## Decision

[SQLite 查询服务](../../../../packages/session-query/session-query-sqlite/README.zh.md)拥有默认启用的实时配置 `searchEnabled`。部署的 `openAt: never` 保持优先。在规范化前、排队工作前、打开索引后及对账后的准入检查拒绝关闭或已失效请求。实时字段提交时递增版本，因此立即重开也不能接纳旧请求。已有对账可能完成，不删除索引或 Session 数据。精确读取、过滤与追踪保持既有行为。

通用设置使用既有已接受值、带版本检查的表单，并与自动标题共用布尔控件。命名空间撤回时移除控件与搜索锚点。不增加 Session 事件、模式版本或模型工具。

## Alternatives considered

实时修改 `openAt` 会混合生命周期与准入。移除整个查询服务会破坏精确读取。每次切换关闭或删除索引会引入不必要的资源归属和数据丢失影响。只在提交时检查会让排队请求在关闭后返回。

## Consequences

此设置不是数据清除或调用方授权。同步 SQLite 语句不能中断。所属测试覆盖关闭时不打开索引、服务生命周期不变、部署优先级、两种搜索范围的排队请求、快速关开、profile 持久化与冷启动、已接受 UI 回读、只读输入、失败和索引保留。不据此认定浏览器视觉或跨平台验收通过。
