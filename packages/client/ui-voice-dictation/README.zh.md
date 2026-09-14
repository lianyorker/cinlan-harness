# @deepseek-ai/dsh-client-ui-voice-dictation

[English](README.md) | 中文

该 Cinlan Web 产品 Consumer 贡献一个统一的语音设置面板，麦克风、引擎与模型行使用一致的间距、分隔线和状态样式。面板列出六个出厂 sherpa-onnx 模型，分别显示下载及安装/解压进度；本地引擎降级时显示修复命令。麦克风授权控件会从浏览器权限或 WebView 持久化回退恢复，且只在获得真实权限拒绝结果后才把该回退改为 denied。该包还在 composer 的 `conversation.input.right` 工具行 slot 中贡献一枚始终可见的麦克风按钮。按钮与全局 Ctrl+Shift+E 共用同一个 DictationController：两者都能开始/停止录音，把音频交给 [`@deepseek-ai/dsh-voice-sherpa-onnx`](../../voice/voice-sherpa-onnx/README.zh.md) 转写，并把结果追加到当前会话草稿。

## 语音设置面板

面板独立读取 `/voice/api/engine.status` 与 `/voice/api/models.list`。麦克风、引擎和模型行使用统一的设置面板间距与分隔线。「引擎」行在原生插件加载成功时显示就绪状态；加载失败时显示 Host 的 `engine-repair.ts` 算出的确切可粘贴修复命令与 allowlist 提示，并提供一键复制按钮。两个出厂「模型」行会持续轮询字节下载与解压阶段、忽略过期响应，并在后续状态刷新失败时保留当前模型行；被拒绝的下载会留在对应模型行。引擎降级不会阻塞模型加载，因为下载与缓存模型不依赖原生模块。

## Ctrl+Shift+E 听写

第一次按 Ctrl+Shift+E 或点击麦克风按钮会请求麦克风访问（`getUserMedia`，禁用浏览器音频处理——不启用回声消除、降噪或自动增益），并通过 `ScriptProcessorNode` 以系统原生采样率采集；来自同一会话的第二次手势会停止录制。发起会话拥有活动录音，其他会话的控件在操作结算前保持禁用。按钮从共享 controller 显示麦克风、停止和转写中三种状态。采集的原始 PCM 经本包线性重采样器重采样为 16kHz 单声道，base64 编码后 POST 给 `/voice/api/transcribe`，目标是 Host 报告的第一个 `ready` 模型。转写结果通过 `ctx.conversation` 追加到草稿——与 `@deepseek-ai/dsh-client-ui-better-sidebar` 的 @-引用使用同一条通道。缺少模型或操作失败时 controller 进入错误状态，不改草稿。插件拆除会使所有待发布结果失效、释放活动轨道，并在麦克风获取或转写结算后才完成 dispose。

## 模型体验

### 仅传输的设置页面

#### 模型看到什么

无。经 `input.for(actx).setDraft(...)` 插入的听写转写文本在模型边界上与打字输入的 composer 文本无法区分；该包不贡献任何自己的提示词、schema 或工具。

#### Token 影响

无；该设置页面与 Ctrl+Shift+E 触发器不新增请求或结果 token。

#### KV Cache 影响

无；模型下载状态、麦克风权限与听写转写从不进入模型请求前缀。

## 已知限制与暂缓事项

- **修复命令运行后不会自动重新检测** —— 「引擎」子分区只在挂载时读取一次 `engine.status`；运行了修复命令的用户必须重新加载设置页面才能看到状态刷新。
- **麦克风权限不跨设备同步** —— 状态以当前 WebView 的 Permissions API 为准；持久化回退只属于当前 WebView origin，本身不能授予操作系统权限。
- **固定的模型选择** —— 听写始终针对 Host 报告的第一个 `ready` 模型；当已下载多个模型时，没有按会话或持久化的模型偏好。
- **部分浏览器上转写可能返回空** —— `ScriptProcessorNode` 采集在某些浏览器/音频驱动组合下可能产生近零振幅样本，导致转写结果为空。迁移到 `AudioWorkletNode` 已列为后续工作。
- **已弃用的 ScriptProcessorNode** —— 当前采集使用已弃用的 `ScriptProcessorNode` API；`AudioWorkletNode` 是现代替代方案，但需要从同源提供单独的 worklet 模块文件。
