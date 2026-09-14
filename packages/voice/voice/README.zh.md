# @deepseek-ai/dsh-voice

[English](README.md) | 中文

该 Service Definition 拥有 provider-neutral 的 `ctx.voice` 注册表与执行面：模型注册、下载/缓存状态投影，以及转写调度。引擎 Provider 拥有原生绑定加载（平台原生插件缺失时降级）、模型文件加载与推理；Consumer 拥有麦克风采集、权限弹窗、设置页模型列表以及把转写文本插入 composer。

## 引擎与模型注册

只能注册一个引擎（`registerEngine`）：部署不会像在多个 mobile-device Provider 之间选择那样，在运行时于多个互相竞争的本地语音识别后端之间做选择，因此今天不需要可替换的多 provider seam。每个出厂模型各自独立注册（`registerModel`），各自携带自己的下载源、预期大小、编码归档 SHA-256，以及其 encoder/decoder/joiner/tokens 路径在解压后的归档内所遵循的 sherpa-onnx `OnlineRecognizer` 文件布局。

`engineOrUndefined` 让 Consumer 能区分「没有挂载引擎」（组合缺口——设置页应显示缺失能力的引导）与「引擎已挂载但该模型尚未下载」（模型自身的 `VoiceModelStatus`）。

## 模型体验

### Consumer 拥有的结果

#### 模型看到什么

无。该包不贡献任何面向模型的文本；`VoiceRuntime.registerEngine`／`registerModel` 与转写调度在提示词发出之前就已经替换了 composer 键入内容，因此听写输出在模型边界上与打字输入无法区分。

#### Token 影响

无；该 Service Definition 不新增请求或结果 token。

#### KV Cache 影响

无；引擎注册、模型注册与下载/缓存状态从不进入模型请求前缀。

## 已知限制与暂缓事项

- **六个出厂模型** —— 该切片注册了两个来自 GitHub releases 的流式 Zipformer 归档模型和四个来自 HuggingFace 的文件下载模型（英文 Zipformer、双语 Paraformer、Sense Voice、Whisper tiny），经 `hf-mirror.com` 镜像下载。
- **没有持久化的模型偏好记录** —— 上次选择的模型不会持久化；每个会话都从设置页的默认选择开始。
- **没有流式部分结果 API** —— `VoiceRecognizer.transcribe` 对每段提交的音频只返回一条最终转写；正在进行的语句的增量部分假设不对外暴露。
