---
description: "基于持久化按主机存储的终端快捷命令读写 Remote"
kind: "package-reference"
---
# @cinlan/api-terminal-quick-commands-controller

[English](README.md) | 中文

## 概要

基于持久化按主机存储的终端快捷命令读写 Remote。适配器把 `terminalQuickCommands` 的 Remote 方法——`list`、`create`、`update`、`remove`——暴露给已认证的 Client 调用方；调用方鉴权由承载层负责，本服务不持有任何 PTY。

## 使用本包

挂载 `ctx.terminalQuickCommandsController`，需要 `typert` 与 `terminalQuickCommands` 两个 provider。`list` 返回绑定到某个执行主机的命令及可寻址主机 id；写入返回已存记录或 wire 安全的失败原因。

## 模型体验

无：Remote 适配器只转发客户端请求，不注册提示词、工具或 Session 内容。

#### KV Cache 影响

无直接影响；被调用的 Remote 方法自己持有模型可见的结果。

## 已知限制与延期工作

- 校验与存储语义全部委托给 `@cinlan/terminal-quick-commands`；本适配器不增加额外规则。
- 没有主机级扇出：调用方只能列出它已经可寻址的主机。
