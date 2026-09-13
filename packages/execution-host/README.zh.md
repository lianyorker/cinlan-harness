---
description: "用于可信 artifact provenance 的 execution-host identity provider。"
kind: "package-group"
---

# execution-host/ — execution-host identity 能力

[English](README.md) | 中文

## 概述

为生成 artifact 的进程发布一个稳定 identity，并由 provider 决定如何采集宿主事实。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`execution-host/`](execution-host/README.zh.md) | provenance 与授权使用的 execution-host identity 约定 |
| [`execution-host-local/`](execution-host-local/README.zh.md) | 提供不可变宿主 identity 事实的本地进程 provider |

<a id="dev-note"></a>
## 开发备注

<details>
<summary>供维护者展开的工作上下文</summary>

该包组没有独立的 subsystem 页面；execution-host 约定由组 README 与包 README 负责。

</details>
