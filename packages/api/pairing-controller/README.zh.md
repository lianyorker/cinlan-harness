---
description: "仅限可信本地调用的手机直连配对 Remote 管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-pairing-controller

[English](README.md) | 中文

## 概述

pairing Remote 命名空间提供监听器状态、启用与关闭、邀请创建与取消以及设备撤销。生命周期和持久化委托给 [remote-access](../../remote-access/remote-access/README.zh.md)。

## 权限

管理操作只在已认证的可信本地 Gateway 调用中执行。没有已认证调用者的直接调用，以及委托给配对设备的调用，均不能启用监听器、发出邀请或修改设备授权。执行者负责检查权限；在手机界面中隐藏方法不是授权机制。

## 模型体验

无，因为此控制器管理监听器就绪状态和设备授权，不注册模型工具、提示词或 Session 内容。

#### KV Cache 影响

无。配对管理不改变模型历史。

## 已知限制与后续工作

TLS 设置属于 remote-access 部署配置。本控制器不生成证书、不修改信任存储、不开放防火墙，也不提供原生移动构建。

本包不发布 invariant 配套入口：适配器将状态和权限检查委托给注入的生命周期所有者，不保留独立状态。
