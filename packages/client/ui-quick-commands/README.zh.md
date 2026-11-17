---
description: "工作区设置页的终端快捷命令管理卡片"
kind: "package-reference"
---
# @cinlan/client-ui-quick-commands

[English](README.md) | 中文

## 概要

工作区设置页的终端快捷命令管理卡片：纯浏览器侧贡献，基于 `terminalQuickCommands` Remote 渲染按主机的命令列表与新建/编辑/删除表单。

## 使用本包

在提供 `terminalQuickCommands` Remote 的组合里挂载；Host 入口 `apply()` 不增加任何 Host 状态。卡片列出所选执行主机的命令，客户端先做草稿校验以提前反馈，所有读写都走 Remote——Host 对每次变更重新校验。

## 模型体验

无：浏览器侧设置卡片不注册任何模型侧输入。

#### KV Cache 影响

无直接影响；卡片只读写用户终端状态，不组装模型请求。

## 已知限制与延期工作

- 卡片只管理已存列表；把命令下发到终端属于终端界面的职责。
- 草稿校验镜像 Host 规则仅用于提前反馈；Host 的校验才是最终裁决。
