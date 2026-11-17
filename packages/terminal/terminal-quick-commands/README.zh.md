---
description: "按主机持久化的终端快捷命令，带校验与按主机读取"
kind: "package-reference"
---
# @cinlan/terminal-quick-commands

[English](README.md) | 中文

## 概要

按主机持久化的终端快捷命令：本服务持有已存记录及其校验；执行命令属于接收它的终端，本服务自身绝不执行任何命令。所有读取都按执行主机限域——已缓存的列表不能在其他主机上回放。

## 使用本包

挂载 `ctx.terminalQuickCommands`，需要 `storageDomain` provider。`list(hostId)` 按时间先后返回该主机的命令；`create`/`update`/`remove` 经一条串行队列变更并向已注册监听器发送按主机的变更通知。草稿写入前先经 `validateDraft` 校验。

## 模型体验

无：本服务不注册提示词、工具或 Session 事件；快捷命令是用户终端状态，不是模型输入。

#### KV Cache 影响

无直接影响；已存命令只有在终端消费者选择纳入时才进入模型请求。

## 已知限制与延期工作

- 执行不在本包范围：把已存命令下发到 PTY 是接收终端的职责。
- 列表按设计按主机限域；没有跨主机聚合视图。
