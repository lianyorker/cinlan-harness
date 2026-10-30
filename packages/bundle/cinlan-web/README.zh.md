---
description: "Cinlan Harness fork 的 Cinlan 私有 Web 组合层：把通知、Git、worktree、执行宿主、MCP、语音、用量、安全研发与 Cinlan Design Studio 等组合行移出 dsh-web-app。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-web

[English](README.md) | 中文

Cinlan Harness fork 的 Cinlan 私有 Web 组合层。

## 概述

`dsh-cinlan-web` 是一个纯 patch 的 bundle，收纳了原先散落在 `dsh-web-app`
内的全部 Cinlan 私有组合行。把这些行独立成 bundle 之后，
`packages/bundle/web-app/` 可以只保留 fork 仍需要的挂载点差异，干净地跟踪
upstream `deepseek-ai/deepseek-harness`。

## 使用本包

`web` profile 模板已将该 bundle 列在 `@deepseek-ai/dsh-web-app` 之后；profile
选中它时，`dsh` 会自动解析其 `cordis.patch.yml`。

### 包含内容

- 通知、快捷命令与工作目录相关行。
- Git 源代码管理、sidebar git 与 worktree task 界面。
- Execution host 行（local、targets、binding、runtime、controller）。
- MCP registry、management 与 controller 行。
- 语音听写与 sherpa-onnx 行。
- Usage query 与 usage controller 行。
- Security research controller 与 security skills 行。
- Cinlan Design Studio、移动端隧道宿主以及 Cinlan 设置界面。

## 实现说明

本 bundle 只发布 `cordis.patch.yml`；`src/index.ts` 仅为让 workspace 构建有
产物而存在。每一行都是 `- insert:` 条目，通过本 bundle 的 `dependencies`
解析包名，因此所有被挂载的包都显式列在依赖中。

## 延伸阅读

- `packages/bundle/web-app/cordis.patch.yml` —— 本 bundle 叠加其上的
  upstream 跟踪层。
- `packages/bundle/security-research/` —— Security Research preset bundle。
