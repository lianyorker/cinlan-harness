# Agent Note: 选择性集成上游时保留产品所有权

Status: implemented

[English](2026-09-19-selective-upstream-integration-preserves-product-ownership.md) | 中文

## 问题

官方 v0.1.6-alpha.2 在增加核心修复与插件管理的同时，也采用了与 Cinlan 不同的产品选择。整体替换产品组合会把有用的运行时变更与 Settings 重设计、Desktop 安装所有权、侧栏 API 变更，以及不同的模型或委派默认值绑定在一起。

## 决策

通过既有产品属主集成选定的核心修复与能力。Settings 保留全页外壳、CSS、语义主题 token、分组导航、搜索与原生控件。功能属主继续负责持久化与保存反馈：`SettingsScope.mutate(): Promise<boolean>` 报告 Host 接受结果，仅有匹配的读回值不能证明保存成功。[导航](2026-09-17-settings-navigation-metadata.zh.md)与[原生设置](2026-09-17-native-settings-runtime-consumers.zh.md)决策继续有效。[功能设置导航决策](2026-09-19-feature-settings-navigation.zh.md)在这些外壳与持久化保护范围内拥有各个菜单入口。

插件管理位于既有 Plugins 设置页签内。其 Host 服务要求真实、由启动器提供的 `ProfileContext`，不会根据路径推断 profile 的可写所有权。执行端在取得锁或修改文件之前，以 `management-required` 拒绝 Desktop 包与组合修改。配置行修改要求[能力集成决策](2026-09-20-official-capabilities-preserve-cinlan-architecture.zh.md)所述的显式 Desktop Host 适配器。Desktop 按[所有权决策](2026-08-25-electron-desktop-packaging-and-updates.zh.md)保留 `dsh-app://`、framed pipes、私有 pnpm，以及独占的暂存、健康检查、激活和恢复事务。隐藏浏览器控件不能替代执行端强制检查。

better-sidebar API 与既有消费者保留其公开行为。计划预览与文件变更审阅通过可选消费者注册，两项功能都不要求替换侧栏。新增的 `conversation.chat.turnCards` 列表与 `conversation.chat.turnTail` 链并存，独立卡片不争用其选择器。既有[页签导航](2026-09-05-sidebar-tab-types-and-navigation.zh.md)与 [worktree/侧栏安全](../feature/2026-09-10-worktree-sidebar-security-integration.zh.md)决策保留各自的所有权与授权规则。

subagent 运行时的 `maxActiveSubagents` 默认值为 `8`，并保留本地 `maxDepth` 默认值 `3`。显式部署值优先；没有深度覆盖的工具在每次委派时解析共享设置。[人设、过滤与深度决策](../feature/2026-07-12-subagent-persona-tool-filter-and-depth.zh.md)保留提供方与绝对深度保证。

Chat Completions 仍是默认协议，Messages 是显式选项。新增图像支持用于请求准备，不引入另一种持久图像格式或跨 Session 持久化迁移。既有网关、已配置模型列表与[图像请求管线](../feature/2026-08-20-unified-image-request-pipeline.zh.md)保留各自属主。

## 曾考虑的替代方案

**用官方版本替换产品组合。** 这会让采用独立核心修复同时改变 Settings、Desktop 传输与安装、侧栏集成以及既定默认值。这些选择需要各自的产品决策。

**允许 Web 插件管理器拥有 Desktop 包事务。** 共享 profile 路径不会转移 Desktop 的事务所有权。并发包写入者可能绕过其暂存验证与恢复，因此即使在自定义组合中，服务也拒绝此路径。

**要求单一侧栏实现，或让所有卡片复用尾部选择器。** 可选消费者保留既有侧栏 API，而独立卡片列表让已提交计划和文件变更与尾部链并存。

## 后果

Cinlan 获得选定修复与插件管理器，同时保留其 Settings 和 Desktop 行为。集成需要显式适配与 profile 检查，而不是让版本标识决定产品默认值。保留的笔记继续拥有各自详细依据；既有 subagent 决策仅改变深度设置的解析方式。未来集成在改变默认值、公开 API 或修改路径之前，必须检查这些相同属主。
