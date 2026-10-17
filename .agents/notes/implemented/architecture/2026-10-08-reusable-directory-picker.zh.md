# Agent Note: 可复用的组合目录选择器

Status: implemented

[English](2026-10-08-reusable-directory-picker.md) | 中文

## Problem

SDK 设置需要选择文件夹，但不创建工作区。直接调用 Host 原生选择 Remote 无法打开浏览组合，也绕过了 Desktop preload bridge。

## Decision

组合中的原生或浏览客户端注册由 `ui-workspace` 声明的 root 作用域 `directory.picker` Factory。调用方传入现有 `DirectoryFlowOwnerProps` 并接纳返回路径。定义不依赖工作区子 slot 的声明，复用同一选择组件及注入回调。只有一个选择器定义处于活动状态；Cordis effect 在插件销毁时移除定义。

## Alternatives considered

并行的设置选择器会重复目录浏览与平台路由。在调用方增加选择器类型分支，会使每个调用方耦合到组合细节。复用工作区接纳流程则会创建无关的工作区对象。

## Consequences

SDK 设置使用所选组合，不直接调用原生选择器。缺少选择器组合时仍可手动输入。每次渲染自行持有取消及结果处理；销毁原生实例后忽略最终 OS 结果，不关闭 OS 对话框。验证覆盖独立 Factory 注册、销毁、Desktop bridge 路由、浏览取消与选择，以及 SDK 设置持久化。
