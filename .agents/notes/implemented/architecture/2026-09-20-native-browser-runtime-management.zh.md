# Agent Note: 原生浏览器运行时管理

Status: implemented

[English](2026-09-20-native-browser-runtime-management.md) | 中文

## Problem

插件启用不代表浏览器可执行文件存在，列出页面又会启动持久上下文。组件下载需要支持取消与修复，不能破坏可用浏览器，也不能依赖 Settings 视图生命周期。

## Decision

Playwright 包拥有独立运行时服务及现有原生 Provider。状态分别报告文件存在、Provider 启用与上下文状态。经过认证的 Browser controller 提供检测、安装、重新安装、移除、精确任务取消及显式关闭上下文。插件管理仍是唯一启用状态来源；组件安装不启动浏览器，也不授权模型工具。

安装器来自精确固定的 Playwright 包，复用其平台注册信息、维护中的 CLI、上游 URL、解压与完成标记。子进程独立环境指定应用私有 generation 目录。重新安装仅在完成后提交当前 generation 文件；失败或取消保留旧 generation。Provider 为有头和无头 Chromium 显式解析已提交可执行文件。系统 Chrome 与 Edge 仍是不受组件管理的替代选项。

任务属于 Host，离开视图或断开 Remote 不会取消。取消定位一个品牌化任务 id，并等待进程范围终止与暂存清理。终态在清理后发布。共享文件系统租约阻止其他 Host 在浏览器上下文或组件操作使用同一运行时目录时进入。Profile 与二进制分离，移除后仍保留。

## Alternatives considered

**通过列出页面判断就绪。** 这会启动浏览器，且无法区分插件启用与文件存在。

**调用系统浏览器安装器或随意选择最新 Chromium 压缩包。** 系统安装器修改外部软件，任意版本可能与固定 Playwright 驱动不匹配。维护中的固定安装器负责平台与版本选择。

**修复时覆盖当前缓存。** 解压被打断可能破坏唯一可用可执行文件。私有 generation 保留它，直到当前文件提交。

**让 Remote 请求生命周期持有安装。** 导航与重新连接会取消已授权的 Host 工作；显式任务取消明确表达该操作。

## Consequences

文件存在与完成标记不证明可执行文件完整性或启动成功。安装器进度描述当前压缩包，辅助下载可能重新计数。已完成旧 generation 保留到显式移除。Host 重启不恢复任务；异常退出可能遗留租约，需管理员核验后手动恢复。损坏的当前 generation 元数据明确报错，可通过显式移除组件恢复；Settings 错误视图尚未提供该恢复入口。

[原生浏览器操作决策](../feature/2026-09-13-native-browser-operations.zh.md)继续负责 Cookie、传输与 profile 隔离。本记录增加组件所有权，不替代那些理由。Web 侧栏 iframe 保持独立 Cookie、页面标识与登录状态。

## Verification

Loader/controller 测试覆盖不启动浏览器的检测、Remote 断开不取消、精确任务取消、进程静默退出及重新安装失败保留。文件系统测试覆盖跨管理器租约、提交顺序、符号链接安全移除及 profile 保留。可选真实 Loader 测试以隔离 profile 验证系统或托管 Chromium、本机回环导航、观察、关闭上下文与清理。官方下载安装依赖上游 URL 可达；需要代理时显式使用合法现有代理。
