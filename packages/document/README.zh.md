---
description: "用于已授权工作区预览的 Host 文档转换包映射。"
kind: "package-group"
---

# document/——文档转换

[English](README.md) | 中文

## 概述

本组为工作区预览提供 Host 文档转换。Office 转换器生成受限、可缓存的 PDF 结果，不修改源文件。Workspace Files 负责 Session 授权；转换器负责排队任务、取消与输出字节。包 README 说明支持的格式、限制与原生引擎要求。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | 服务 |
|---|---|---|
| [office-to-pdf](office-to-pdf/README.zh.md) | 将已授权的 Office 源文件转换为供预览使用的 PDF | `ctx.officeToPdf` |

-----

<a id="related-documentation"></a>
## 相关文档

- [工作区子系统](../../docs/subsystems/workspace.zh.md)——工作区服务与 Office 转换 API。
- [Workspace Files](../api/workspace-files/README.zh.md)——本地 Session 授权与受限源文件读取。
- [配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-office-to-pdf)——转换器支持的配置字段。

<a id="dev-note"></a>
## 开发备注

无。
