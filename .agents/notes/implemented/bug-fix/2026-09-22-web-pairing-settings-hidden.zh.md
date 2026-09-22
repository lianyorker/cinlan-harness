# Agent Note: Web 隐藏 Desktop 手机配对设置

Status: implemented

[English](2026-09-22-web-pairing-settings-hidden.md) | 中文

## 问题

Web 载体可以使用 loopback URL，因此 Desktop 专用的手机配对页面会错误注册到 Web 设置中，尽管手机端尚未提供。

## 决策

手机配对设置贡献现在同时要求 `dsh-app:` Desktop 载体协议和 loopback Host。配对载体继续由现有 Host 属性排除。

## Alternatives considered

**从 Web bundle 移除配对插件：** 不采用，因为 Desktop 和 Web 共用 bundle，而 Desktop 仍需要该页面。

**仅根据 loopback Host 属性判断 Desktop：** 不采用，因为 localhost Web 页面也会报告 loopback。

## 后果

Desktop 保留手机配对页面，Web 设置不再注册其 section、icon、metadata、observer 或管理调用。载体差异由 loader 测试覆盖。
