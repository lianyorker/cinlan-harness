# 集成终端与 Shell UI 检查

## 源码可确认的差异

| UI/交互点 | Orca | Harness | 视觉证据 |
|---|---|---|---|
| Tab 与恢复 | terminal pane 的 split/tab、运行态和恢复 UI | 右侧栏多 terminal tab、Dockkit 浮动/停靠与 Host controller 生命周期管理；支持独立会话恢复、退出码展示与关闭确认，LLM turn 取消不误杀独立终端 | 未截图 |
| 渲染和 Shell 设置 | WebGL、字体、光标、Windows/WSL shell、setup script | 独立终端设置页（Shell、参数、字体、字号、Scrollback、光标样式与闪烁）；自动适配主题配色与终端容器尺寸，快捷命令菜单与快速启动集成 | 未截图 |

## 尚需运行的检查

以下是验收要求，不表示当前产品已具备所有状态或已经通过。

| 检查维度 | 验收要求 | 当前证据 |
|---|---|---|
| 入口与布局 | 用实际 Web/Desktop profile 检查入口可达性、分组、返回路径及 tab/panel 所有者 | source/profile，待运行 |
| 控件与数据 | 控件值来自正确 Host/scope，写入后真实 readback，未知结果不报成功 | 待运行 |
| 加载与空状态 | 区分 loading、真正为空、未安装、服务不可用和只读，不闪出错误的空列表 | 待运行 |
| 错误与恢复 | 明确失败原因、重试/取消与危险操作确认；拒绝后保留草稿 | 待运行 |
| 生命周期 | 切换 Session/Host、关闭页面、重连、重启后状态和资源释放正确 | 待运行 |
| 二开隔离 | 按 [CLH 隔离规则](../提示词使用规则.md#clh-isolation) 检查本功能显示标识、数据 owner 与官方并存；不适用项说明原因 | 待运行，未证明隔离 |
| 主题与本地化 | 明暗主题、zh/en、长标签和错误文案；使用 Harness locale/tokens | 待截图 |
| 响应布局 | 1440x900、1024x768、390x844 和 200% zoom；内容不溢出或遮挡 | 待截图 |
| 键盘与可访问性 | tab 顺序、焦点恢复、aria label、图标 tooltip 和 disabled 原因 | 待运行 |

## 专项验收

已完成：ui-sidebar-terminal 77 项单测全绿、ui-settings-terminal 单测全绿、PTY 断线重连与退出码覆盖。

截图与操作收据使用 `orca-migration/exports/ui/terminal/`；记录 profile、版本、viewport、动作、结果和错误。Orca Electron 仅在明确授权启动后按上游隐藏窗口/CDP 规则验证，不抢用户焦点。

源码来源见 [差异分析.md](差异分析.md)，不要用 mock 截图认定真实操作通过。
