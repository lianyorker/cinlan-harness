---
description: "按会话管理终端生命周期操作的 Host Remote 控制器。"
kind: "package-reference"
---
# @deepseek-ai/dsh-api-terminal-controller

[English](README.md) | 中文

## 概述
本包通过生成的 Host 与浏览器 Remote face 暴露按会话隔离的终端。Web 客户端可以列出、启动、发送输入、读取输出、刷新和关闭终端，但不会获得进程句柄。控制器把终端所有权留在 Host 服务中；提供方缺失时返回类型化错误。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将控制器与 Typert Gateway 和 ctx.terminals 提供方一起挂载。挂载 dsh-api-remotes，把生成的 Remote face 投影到浏览器。Remote 接受不透明的终端会话 id，并把取消请求传递给提供方操作。

<a id="model-experience"></a>
## 模型体验

无，因为终端 Remote 控制器不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；终端管理不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 控制器暴露已有终端会话，不提供持久终端 transcript 存储。
- 输出保留和进程限制仍由终端提供方负责。

不发布 runtime invariant companion，因为控制器只是终端服务的无状态 Remote 投影。

<a id="dev-note"></a>
### 开发备注

Typert 会生成 Host 和 Remote 声明；请编辑 src/index.ts 和 src/types.ts，不要编辑生成文件。
