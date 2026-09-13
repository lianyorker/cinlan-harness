---
description: "面向证据、报告和录制内容的 artifact metadata 与存储 provider。"
kind: "package-group"
---

# artifact/ — 持久 artifact 能力家族

[English](README.md) | 中文

## 概述

定义带 scope 的 artifact reference，并通过可互换 provider 保存不可变的证据字节。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`artifact/`](artifact/README.zh.md) | Artifact metadata、授权、provenance、retention 与 redaction 类型 |
| [`artifact-memory/`](artifact-memory/README.zh.md) | 已发布 artifact object 的进程内 provider |
| [`artifact-local/`](artifact-local/README.zh.md) | 提供带 scope、可验证且有界读写的文件系统 provider |

<a id="dev-note"></a>
## 开发备注

<details>
<summary>供维护者展开的工作上下文</summary>

该包组没有独立的 subsystem 页面；artifact 约定由组 README 与包 README 负责。

</details>
