---
description: "Notifications Settings page and browser notification delivery."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-notifications

[English](README.md) | 中文

## 概述

本包在设置中提供“通知”分区：全局通知、智能体完成、终端响铃、通知声音和专注时抑制。回环浏览器将选择写入 `notifications` Settings namespace，并在 Agent 从运行变为空闲时调用浏览器系统通知 API。测试按钮从当前用户手势触发通知权限请求。

## 使用

```yaml
- name: '@deepseek-ai/dsh-notifications'
- name: '@deepseek-ai/dsh-client-ui-notifications'
```

包通过 `settings.section` 注册页面，不修改设置外壳。通知运行时监听 `api-session/status`，只在观察到 `running -> idle` 时发送一次完成通知。

## 模型体验

无。本包不进入模型请求或 KV cache。

## 已知限制与延期工作

终端响铃事件需要终端提供方发布对应的浏览器事件后才会投递；当前页面只保存该开关。自定义声音文件只在当前浏览器生命周期内可播放，文件名会持久化以便显示。
