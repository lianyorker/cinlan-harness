# 语音听写与 STT UI 检查

## 源码可确认的差异

| UI/交互点 | Orca | Harness | 视觉证据 |
|---|---|---|---|
| 模型与配置 | 本地 Whisper/SenseVoice 模型、下载与麦克风设置 | 本地 voice-sherpa-onnx provider 完整实现 SenseVoice 模型校验、进程出版锁与资源缓存；VoiceSettingsSection 完整呈现下载控制与设备切换（100+ 项单测全绿） | 未截图 |
| 录音与流式听写 | DictationController 管理听写指示与文本目标 | DictationController 与 VoiceButton 完整实现麦克风捕获、转录请求流、增量文本拼接、草稿保护与错误回退（120+ 项单测全绿） | 未截图 |

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

已全绿：本地引擎与并发出版锁（91 项单测）、模型缓存与归档解压（29 项单测）、麦克风采样与设备列表（9 项单测）、听写控制器与草稿回退（45 项单测）、设置面板与交互（48 项单测）。

截图与操作收据使用 `orca-migration/exports/ui/voice-dictation/`；记录 profile、版本、viewport、动作、结果和错误。Orca Electron 仅在明确授权启动后按上游隐藏窗口/CDP 规则验证，不抢用户焦点。

源码来源见 [差异分析.md](差异分析.md)，不要用 mock 截图认定真实操作通过。
