# 主题、字体与界面外观 UI 检查

## 源码可确认的差异

| UI/交互点 | Orca | Harness | 视觉证据 |
|---|---|---|---|
| 主题与字号控件 | System/Dark/Light、语言与界面选项 | ui-theme 通过 settings.general.item 插槽注入 AppearanceRow（系统/明亮/暗黑）与 FontSizeRow（阶梯字号），HTML 挂载前通过 boot-theme 预设防止主题闪烁 | 未截图 |
| 窗口与桌面偏好 | AppearanceWindowSidebarSection 混合窗口缩放、侧栏开关与应用图标 | 严格解耦 Web CSS 设计令牌与 Electron 桌面原生层，桌面窗口缩放与拖拽由 apps/desktop 原生适配管理，侧栏由 ui-sidebar 响应式折叠状态机管理 | 未截图 |

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

已全绿：主题注册与插槽挂载（9 项单测）、外观行选择交互（2 项单测）、字号行步进交互（3 项单测）。

截图与操作收据使用 `artifacts/orca-migration/exports/ui/appearance-theme/`；记录 profile、版本、viewport、动作、结果和错误。Orca Electron 仅在明确授权启动后按上游隐藏窗口/CDP 规则验证，不抢用户焦点。

源码来源见 [差异分析.md](差异分析.md)，不要用 mock 截图认定真实操作通过。
