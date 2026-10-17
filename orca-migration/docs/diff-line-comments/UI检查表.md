# Diff 行评论与发送 Agent UI 检查

## 源码可确认的差异

| UI/交互点 | Orca | Harness | 视觉证据 |
|---|---|---|---|
| 行定位与编辑 | DiffViewer 提供行定位、onAddLineComment 和内联评论装饰器 | ReviewBody 提供统一 Diff 解析、old/new 行号双栏对齐、行级 + 评论触发、草稿维护与增删操作 | 未截图 |
| 发回 Agent | README 描述将 diff line comments 结构化发回 agent | ReviewBody 定义 DiffLineComment 结构，支持单条及全部发送，联动 remote.session.prompt 发回 Agent 上下文 | 未截图 |

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

已完成：ReviewBody 单元测试（diff 差异解析、行号定位、评论增删、单条及批量发送 Agent 回调，共 13 项测试）。

截图与操作收据使用 `orca-migration/exports/ui/diff-line-comments/`；记录 profile、版本、viewport、动作、结果和错误。Orca Electron 仅在明确授权启动后按上游隐藏窗口/CDP 规则验证，不抢用户焦点。

源码来源见 [差异分析.md](差异分析.md)，不要用 mock 截图认定真实操作通过。
