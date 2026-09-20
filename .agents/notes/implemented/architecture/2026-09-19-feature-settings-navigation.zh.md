# Agent Note: 功能设置导航保留原生属主

Status: implemented

[English](2026-09-19-feature-settings-navigation.md) | 中文

## 问题

单一的「侧边卡片」目录按渲染包把无关功能归在一起。寻找文件、任务、侧边对话、Git、浏览器或终端的用户需要以该功能命名的入口。在此目录内重建原生表单还会让同一偏好拥有多个编辑器，带来保存行为分歧的风险。

## 决策

每个可见功能都有独立的 Settings 菜单入口。[导航映射](../../../../reports/design/cinlan-feature-navigation.md#settings-destinations)记录内置入口。文件页拥有文件预览器控件；工作区布局页仅包含共享布局偏好。每个可见第三方页签描述符都有独立页面，标识为 `feature:` 加上描述符 id。隐藏的计划、差异与审阅描述符仍是运行时面板，不成为菜单项。

[Settings 外壳](../../../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx)为所选分区渲染通用键控 `settings.section.extension` slot。此新增 Settings API 用于组合页面内容，不改变 `ctx.betterSidebar` 的公开方法。[better-sidebar 注册表](../../../../packages/client/ui-better-sidebar/src/client/settings-navigation.tsx)提供功能页面、元数据，以及位于既有 Git、浏览器和终端分区 id 下的扩展。其原生表单继续拥有各自字段。注册项遵循描述符生命周期；外壳不持有针对具体功能的路由表。

功能导航保留已保存的键名、命名空间、序列化方式，以及属主的保存与重置行为。侧栏偏好仍位于 `dsh-better-sidebar`，描述符自有值仍位于 `pluginSettings[descriptorId]`。运行时面板与 `ctx.betterSidebar` 服务 API 继续供其消费方使用。

[选择性集成决策](2026-09-19-selective-upstream-integration-preserves-product-ownership.zh.md)继续保护全页外壳、CSS、主题 token、原生控件与公开 API，但不冻结菜单入口。[设置元数据](2026-09-17-settings-navigation-metadata.zh.md)与[原生设置](2026-09-17-native-settings-runtime-consumers.zh.md)决策继续拥有导航与持久化规则。Cinlan 的独立产品方向与 Linear.app 视觉参考属于[未来设计背景](../../../../reports/design/cinlan-feature-navigation.md#dev-note)，并不授权当前重设计外壳。

## 曾考虑的替代方案

**把所有功能留在「侧边卡片」目录中。** 这要求用户按实现包导航，无法让每个功能都有独立菜单入口。

**在功能卡片中复制原生表单。** 同一字段的独立编辑器更容易产生不同的校验、保存与重置行为。键控扩展把附加控件放在既有属主表单旁边。

**把未来视觉参考用于此次导航变更。** Cinlan 的未来产品身份需要独立设计决策。在此替换外壳 CSS 或主题 token，会把该决策与功能发现混在一起。

## 后果

用户可以直接找到各个功能，已安装插件同时保留运行时集成与已保存偏好。代价是导航条目增加，描述符属主需要维护注册项。隐藏的运行时描述符不会产生空设置页。所需回归证据覆盖注册与 dispose（资源释放）、原生表单组合，以及保持不变的偏好请求内容；组装后的 Web 与 Desktop 验收独立于文档验证。
