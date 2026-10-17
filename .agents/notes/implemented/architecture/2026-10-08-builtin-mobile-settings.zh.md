# Agent Note: 内置移动设置与 operator 资源管理

Status: implemented

[English](2026-10-08-builtin-mobile-settings.md) | 中文

## Problem

Mobile Emulator 页面需要已挂载的偏好所有者和原生资源服务。仅有设置页面而缺少对应能力组合时，无法持久化 SDK 选择或发现设备。资源下载和镜像进程也需要实际调用身份，而非可选的旧版 Gateway 访问元数据。

## Decision

Web 和 Desktop 使用一次现有 Mobile Device 组合包。能力保留 SDK 与默认设备偏好的实时 Config 引用；Settings 负责 profile patch 持久化。Provider 启用、检查偏好、模型操作审批、资源安装和镜像准入仍是独立决策。控制器只接受 Connection operator 的有效 Remote invocation 发起的资源操作。

## Alternatives considered

在 Web 组合包中重复 Mobile Device 条目会与已经选择独立组合包的 profile 冲突。并行设置存储会使原生 ADB 和 SDK 检查读取不同的值。将缺少 Remote 身份视为本地调用，会允许未经准入的调用管理原生进程。

## Consequences

标准 Web 组合包列表在重启时获得该能力；自定义列表保留，需要显式选择。组合包不会自动启动模拟器或下载资源。直接 Host 管理使用资源服务，而非要求认证的控制器。Settings 在输入失焦时保存，通过[共享选择器](2026-10-08-reusable-directory-picker.zh.md)接纳 SDK 目录。原生目录对话框与已连接设备验收仍依赖硬件；浏览器测试覆盖浏览对话框、实时 profile 持久化与响应式布局。
