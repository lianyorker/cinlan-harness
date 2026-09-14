---
description: "Host settings namespace for desktop notification preferences."
kind: "package-reference"
---

# @deepseek-ai/dsh-notifications

[English](README.md) | 中文

## 概述

本包注册 `notifications` Settings namespace，保存桌面通知开关、智能体完成通知、终端响铃通知、通知声音和专注时抑制选项。浏览器显示和通知投递由 `dsh-client-ui-notifications` 负责。

## 使用

```yaml
- name: '@deepseek-ai/dsh-settings-file'
- name: '@deepseek-ai/dsh-notifications'
```

默认值全部关闭，声音为 `system`。客户端通过 `ctx.settingsScope` 读取并写入该 namespace。

## 模型体验

无。本包不改变模型提示词或工具结果。

## 已知限制与延期工作

本包不直接调用操作系统通知 API；具体桌面载体由客户端运行环境负责。
