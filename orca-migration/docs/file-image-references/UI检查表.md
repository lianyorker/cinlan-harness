# 文件引用、拖放与图片附件 UI 检查

## 源码可确认的差异

| UI/交互点 | Orca | Harness | 视觉证据 |
|---|---|---|---|
| 引用菜单 | NativeChatComposer 使用 @file/slash hooks 与 agent-aware 文件引用 | 统一 @file/@session 候选、目录 drill、引用 chip 与可取消查询（ui-reference + ui-input-trigger，165 项单测） | 未截图 |
| 拖放和图片 | composer 的 file-drop/attachment hook 与 README 拖文件/图片能力 | DropOverlay 拖放浮层、ComposerAttachments 托盘、file-upload 流式上传、模型视觉限额与多图历史渲染（ui-attachment + file-upload + ui-conversation，713 项单测） | 未截图 |

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

已全绿：@file 引用与目录穿透（20 项单测）、触发器状态机（145 项单测）、流式文件上传与生命周期（19 项单测）、拖放与附件托盘（42 项单测）、InputBar 组合交互（652 项单测）。

截图与操作收据使用 `orca-migration/exports/ui/file-image-references/`；记录 profile、版本、viewport、动作、结果和错误。Orca Electron 仅在明确授权启动后按上游隐藏窗口/CDP 规则验证，不抢用户焦点。

源码来源见 [差异分析.md](差异分析.md)，不要用 mock 截图认定真实操作通过。
