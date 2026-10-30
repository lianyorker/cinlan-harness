---
kind: upgrade-guide
description: 移除独立 Design 开始页入口，Design 快捷键改为打开 Browser 设计检查。
---

# Browser 设计入口

[English](guide.md) | 中文

## 变更

右侧 Sidebar 开始页提供 Browser，不再分别展示 Browser 与 Cinlan Design。`design.new` 命令和 `Ctrl+Alt+D`（macOS 为 `Cmd+Alt+D`）新建 Browser tab 并进入设计检查模式。仅启用 Design 而未启用 Browser 的 profile 无法使用此快捷键。已有 `cinlan-design` tab 和 `cinlan.sidebar-design.v1` 数据继续注册；已保存视口与视觉图钉不会被迁移或删除。

## 迁移

1. 自定义 profile 若禁用了 `ui-sidebar-browser`，请先启用该 entry，再使用 `design.new`。保留 `ui-cinlan-design`，以提供体检与设计方向控件。
2. 从开始页打开 Browser 后选择设计检查，或使用 Design 快捷键。设计风格库是其后的独立模式。右上角选择器打开批注编辑框；保存保留草稿，工具栏计数打开已保存记录，点击经过验证的当前页面标记可再次编辑。确认所有模式复用同一个 Browser 页面。
3. 需要持久化图钉时保留已有 Design tab。Browser 使用独立的 `cinlan.browser-pins.v1` 保存新批注，不导入这些图钉；不要为移除重复开始页入口而删除其 store。
