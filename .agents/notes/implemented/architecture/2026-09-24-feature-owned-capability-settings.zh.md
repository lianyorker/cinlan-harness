# Agent Note：功能所有者的能力设置注册

Status: implemented

[English](2026-09-24-feature-owned-capability-settings.md) | 中文

## 问题

能力设置包呈现浏览器、计算机、移动设备和安全研究域。单一注册 fiber 注入所有 Remote，会让互不相关的页面依赖可选服务，也会让观察器和分区元数据共享整个包的生命周期。

## 决策

`ui-settings-security` 仍是一个 Client 包，并保留共享 locale 与 renderer 约定。根插件只注入 `locale`，并挂载四个子插件：`browser-registration.ts`、`computer-registration.ts`、`mobile-registration.ts` 和 `security-registration.ts`。

每个子插件分别拥有本域的 scope、运行观察器、功能 Remote 调用、设置元数据、分区和图标注册、connection-reset 监听器及清理。`capability-registration.ts` 与 `capability-shared.ts` 提供共享 inventory 和 provider 启停 helper，不导入兄弟功能值。功能之间通过 Cordis service 与 slot 通信。

缺少必需 Remote 时，所属子 fiber 保持 pending 或不可用；不相关的子 fiber 仍正常注册和清理。每个子 fiber 拥有独立 effect 生命周期，其注册会随该子 fiber 一起移除。

## 备选方案

**保留单一的全域注册 fiber。** 不予采纳：一个缺失的可选能力服务可能延迟不相关页面，并耦合独立观察器的生命周期。

**立即拆成四个 npm 包。** 暂缓：当前包仍拥有共享 locale、renderer 边界和产品能力清单；包拆分应在形成独立版本化的公共约定后进行。

**让一个功能导入另一个功能的注册值。** 不予采纳：兄弟功能的运行时导入会隐藏所有权并阻碍独立加载。共享行为继续放在狭窄的基础设施 helper 中。

## 结果

功能文件可以在不先搬动运行时所有权的情况下逐步演化为独立包。每个功能工厂只要求自身所需的输入；`CapabilitySectionInjected` 是这些输入的联合类型，renderer 按能力 id 收窄派生的 `InjectFace` 联合类型。根组装保持精简，不主动读取 inventory 或 preset。

## 验证

`packages/client/ui-settings-security/tests/apply.client.spec.ts` 验证功能注入隔离、注册清理、元数据生命周期和独立操作回调。Loader 组合测试通过测试专用 `cordis.yml` 启动实际 Client 插件，模拟外部 Remote，并验证缺少无关 Remote 时功能注册仍可用。

## 相关决策

本 Note 部分取代[计算机控制设置呈现](../feature/2026-09-12-computer-use-settings-presentation.zh.md)中的注册所有权备选方案。该 Note 仍负责页面呈现和设备就绪决策。[功能所有者登记设置导航元数据](2026-09-17-settings-navigation-metadata.zh.md)负责元数据语义；本 Note 增加子 fiber 所有权与依赖生命周期。
