---
description: "在设置页编辑集成侧边栏终端的启动与即时渲染偏好。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-terminal

[English](README.md) | 中文

## 概述

在设置 → 实验功能 → 终端中配置集成侧边栏终端。页面读取并编辑现有 `dsh-better-sidebar` 命名空间，仅在当前侧边栏主机确认终端可用后启用表单。

## 目录

- [使用本包](#use-this-package)
- [偏好与生效时机](#preferences-and-timing)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

与 Settings、Locale 及可选的侧边栏客户端服务一起挂载。侧边栏主机拥有偏好 Schema 和 PTY 进程。本包提供本地化页面、公开搜索标签与恢复确认，不注册独立的偏好文档。Web 与 Desktop 使用相同的已认证侧边栏终端服务；原生依赖缺失或 Remote 不可用时，表单保持禁用。

保存操作保留首次编辑时的修订号，并且只写入已修改字段。修改使用共享 SettingsScope 队列与冲突恢复。仅在主机接受且原始覆盖值、生效值均匹配时显示成功；未改变的覆盖值不发送写入，也不显示已保存消息。写入被拒绝后，页面展示最新主机值以供检查。「恢复继承的偏好」先请求确认，再仅清除七个终端覆盖字段；其他侧边栏偏好保留。只读或不可用的命名空间无法修改。

<a id="preferences-and-timing"></a>
## 偏好与生效时机

| 偏好 | 默认值与作用 |
|---|---|
| Shell 可执行文件与参数 | 空字符串沿用主机配置。新建的界面终端和代理侧边栏终端在创建时读取，参数按空白字符拆分。 |
| 字体与字号 | 字体留空时使用主题等宽字体；字号默认为 13 px，范围为 9–32 px。已打开视图会更新并重新计算网格尺寸。 |
| 回滚行数 | 默认保留 4,000 行，范围为 0–100,000 行。减少行数会丢弃较早显示的输出。 |
| 光标样式与闪烁 | 默认方块光标并开启闪烁。已打开的 xterm 视图立即更新。 |

主窗口与代理终端使用会话工作目录。悬浮工作区设置可为该窗口的新建界面终端选择已存在的子目录，主机验证其位于会话工作区内。流重连接回仍存活的进程，并保留其已捕获的目录。关闭终端会释放进程；主机重启后，下次连接会创建新进程，无法恢复运行中的命令。核心执行工具的设置由各自模块拥有。

<a id="dev-note"></a>
## 开发备注

[组件与注册测试](tests/)覆盖中英文、可用性限制、修订号约束的修改、恢复确认、写入拒绝及卸载。客户端 Loader 测试组合真实 SettingsScope 提供方，验证冲突恢复和不变值不写入；包内快照固定不可用时的中文页面。[侧边栏 Loader 回归](../ui-better-sidebar/tests/terminal-settings-loader.spec.ts)通过无需 Web 服务的测试配置启动真实的 Settings、工具和侧边栏源代码，在两条 PTY 创建路径上验证已保存的 Shell 选择。原生 PTY 适配器是外部进程测试替身。[渲染测试](../ui-better-sidebar/tests/terminal-preferences.spec.tsx)验证即时消费者与已安装 xterm 的选项修改。本包仅拥有草稿，从 SettingsScope 派生持久化状态，因此不发布运行时 invariant 伴随入口。共享框架见 [Web Client](../../../docs/subsystems/web-client.zh.md)。

<a id="model-experience"></a>
## 模型体验

间接通过现有代理终端工具应用已保存的 Shell 偏好，本页面不增加工具、消息或模型上下文。

#### KV Cache 影响

无直接影响；查看和修改偏好不添加提示词 Token，后续工具结果仍由原工具记录。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 可用性要求已认证的侧边栏终端 Remote 与原生 PTY 依赖正常工作。能力检查不创建终端，也不能证明自定义可执行文件能够启动。
- Shell 参数沿用按空白拆分的方式，不支持用引号包裹含空格的参数。不提供可执行文件发现或独立默认目录偏好。
- 字体名称按浏览器 CSS 字体规则解析；保存名称不会安装字体。
- 不支持在主机关停后恢复进程。
