---
description: "读取指定 Gitee 仓库 Issue 的只读 Provider。"
kind: "package-reference"
---

# @cinlan/work-items-gitee

[English](README.md) | 中文

## 概述

此 Provider 通过 REST API v5 提供一个已配置 Gitee 仓库的 Issue。仅支持有界 list 和 get 请求；本包不提供外部写入。

## 使用此包

将 Provider 与 `credentials`、`workItems` 一起挂载。通过 `owner` 和 `repository` 配置 Gitee 仓库路径。缺少仓库配置时 Provider 不可用。Work Items 服务可设置 `provider: gitee` 显式选择；挂载多个 Provider 时，也可通过请求的 `source: gitee` 选择。

| 配置 | 行为 |
|---|---|
| `owner` | 仓库拥有者；Provider 可用所必需。 |
| `repository` | 仓库名称；Provider 可用所必需。 |
| `credentialRef` | 每次请求解析的凭据引用，默认 `GITEE_TOKEN`。 |
| `timeoutMs` | 单次请求超时为 1–120000 毫秒，默认 30000。 |
| `maxItems` | 单页上限为 1–100 条，默认 50。 |

Provider 使用固定的 `https://gitee.com` API origin，通过 `Authorization` header 发送 token，拒绝重定向，将响应体限制为 2 MB，并校验 Issue URL 与配置仓库及工单号一致。调用方取消、请求超时和插件释放都会中止进行中的读取。

## 模型体验

Work Items 工具可使用标准化字段列出和读取 Gitee Issue。查询过滤仅作用于已获取页面的标题和正文。Provider 不提供 board、评论或写入。

#### KV Cache 影响

此 Provider 不注册模型请求前缀，也不替换已有请求 token。

## 已知限制与后续工作

- 每个 Provider 实例只服务一个已配置仓库。
- 列表和查询过滤每次仅处理一个有界 API 页面；分页游标为十进制页码。
- Gitee 集成预检和仓库发现不属于此 Provider。

## 开发备注

Provider 负责 Gitee 响应校验和固定 origin 的 REST 请求。Work Items 服务负责 Provider 选择与标准化读取；此 Provider 不注册 mutation writer。
