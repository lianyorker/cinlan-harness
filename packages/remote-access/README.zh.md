---
description: "现有桌面 Host 的直连配对与设备权限。"
kind: "directory-reference"
---

# 远程访问

[English](README.md) | 中文

## 概述

本组负责显式启用的现有桌面 Host 网络访问。[remote-access 包](./remote-access/README.zh.md)提供 HTTPS 传输、设备授权和限定 Session 的鉴权。本地管理通过 [pairing-controller](../api/pairing-controller/README.zh.md) 提供。

## 职责

[HTTP 服务器子系统](../../docs/subsystems/web-server.zh.md)负责传输载体与 Remote Access 服务参考。桌面端提供更新准入和版本匹配的配对浏览器资源。Session、问题和审批仍由原有包负责。[Web 客户端子系统](../../docs/subsystems/web-client.zh.md)负责共享对话渲染及传输代次。
