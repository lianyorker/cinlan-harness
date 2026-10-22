# Agent Note: 浮动工作区拥有独立辅助 Session

Status: implemented

[English](2026-10-21-floating-auxiliary-session.md) | 中文

## 问题

跟随主 Session 的面板只是同一会话的第二个视图，无法提供独立草稿对话，也不能避免改变或争用用户当前的选择。

## 决策

[浮动工作区](../../../../packages/client/ui-floating-workspace/src/client/index.ts)会为浮动面板和每个右侧栏侧边聊天页签创建独立 Host Session。若当前挂载主 Session 存在，则辅助 Session 沿用其工作目录；每个辅助会话持有自己的 `SessionReference`，不会更改主导航。浮动面板在关闭后重开时复用会话；关闭侧边聊天页签时释放其引用。插件卸载时释放面板引用。创建错误会保留在对应界面中，并提供明确重试操作。

## 考虑过的替代方案

**将面板绑定到选中的主 Session。** 拒绝，因为用户在面板发送的内容会写入它本应辅助的主对话。

**每次打开都创建第二个 Session。** 拒绝，因为关闭后重开会丢失草稿上下文，并在 Host 会话列表留下重复空白会话。

**Fork 主 Session。** 拒绝，因为辅助对话不应继承主会话 transcript 或模型上下文；它只继承工作目录。

## 结果

面板使用独立 Session，并拥有独立模型、权限与历史。关闭面板后 Session 仍保留在 Host 目录中；Client 引用只持续到功能卸载。未分组会话会依据继承的工作目录进行分组。

## 验证

runtime 测试覆盖浮动面板的单次创建、关闭重开复用、引用释放和创建失败后的重试。侧边聊天测试覆盖独立 Session 绑定、关闭页签时释放和失败重试；注册测试覆盖从当前挂载 Session 选取工作目录及页签命名。面板级 Loader 检查还应验证 Host 创建新 Session 时不会替换已选中的主 Session；Desktop Electron 创建入口尚未验证。
