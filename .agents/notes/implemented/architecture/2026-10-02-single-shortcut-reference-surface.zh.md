# Agent Note: 统一的快捷键入口

Status: implemented

[English](2026-10-02-single-shortcut-reference-surface.md) | 中文

## Problem

Web 客户端此前提供两个数据彼此独立的快捷键入口。通用设置中的一行打开 `ui-shortcuts` 持有的窗口内快捷键速查，其中列出通过 `shortcuts` 服务注册的全部命令以及只读的固定输入操作。个人分组下另一个由 `ui-keybindings` 持有的 `keybindings` 分区只列出通过较新的 `keyboard` 服务注册的命令。用户打开“快捷键”只看到一条命令，再从通用设置打开速查却看到整份目录，无从判断哪个入口才是权威。

## Decision

`ui-shortcuts` 持有唯一的快捷键速查。其插件注册个人分组的 `keybindings` 设置分区，并由同一份展示组件渲染；同一组件也在 `shell.overlay` 弹窗中渲染，由 `shortcuts.open` 命令（Mod+/）打开。两个入口因此展示完全相同的行与相同的编辑行为。

速查先按固定产品顺序与分组列出窗口内的 `shortcuts` 目录，再以“其他操作”分组列出通过 `keyboard` 服务注册的命令。键盘行保留各自的写入路径：录制、取消绑定、恢复默认分别调用 `keyboard.capture`、`keyboard.setBinding` 和 `keyboard.resetBinding`；只要该分组存在已保存覆盖，就显示一次“恢复全部默认”。窗口内页脚保留原有的恢复全部默认流程与自定义计数。

通用设置不再贡献快捷键行：`ui-shortcuts` 不再注册到 `settings.general.item`。插件在 `settings.section` slot 生命周期内注册分区元数据与可搜索项，因此卸载插件会同时移除页面、搜索项与弹层。

`ui-keybindings` 已删除。`keyboard` 服务及其消费方保持不变。

## Alternatives considered

**保留 `ui-keybindings` 作为页面，并在其中渲染窗口内速查。** 速查组件、行内物理按键录制器和重置确认框都位于 `ui-shortcuts`；功能插件不能导入另一个功能插件的运行时值，这样做必须把整套展示（连同桌面录键桥）搬进 `ui-keybindings`，却带不来任何行为收益。

**保留两个页面，只合并数据。** 一个页面上维护两套持久化 store 的两个编辑器，正是用户反馈的割裂；在两个包中重复联合映射还会让两个入口再次漂移。

**只保留窗口内速查并删除 `keyboard` 行。** 这会丢掉 `floatingWorkspace.toggle` 唯一的编辑器，而该命令正是通过键盘服务注册的。

**把通用设置那一行改成跳转入口。** 那一行本身就是重复项：一个产品概念对应两个入口。移除它只留下一个可查看之处。

## Consequences

现在一个页面覆盖全部可自定义快捷键，Mod+/ 弹层展示的内容与该页面完全一致，用户对比两处会看到同样的内容。窗口内目录仍作为主列表，符合其官方速查的定位。

统一列表并列呈现两种编辑模型：窗口内行打开行内物理按键录制器，键盘行使用自己的录制/取消绑定/恢复默认控件。这种不对称反映了当前组合仍挂载的两套注册表，待其余窗口内 owner 迁移到键盘服务后即消失。

移除 `ui-keybindings` 同时从 Web 应用 bundle 中去掉一个包、一行挂载和一个依赖边。

## Testing

`packages/client/ui-shortcuts/tests/reference.client.spec.tsx` 用同一组 props 渲染页面变体与弹窗，覆盖跨两套注册表的搜索过滤、通过 `keyboard.capture` 的键盘行录制，以及未改动的窗口内编辑流程。`commands.client.spec.ts` 断言组装后的组合注册了 `keybindings` 分区，且不再贡献 `settings.general.item` 行。
