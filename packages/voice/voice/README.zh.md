# @deepseek-ai/dsh-voice

[English](README.md) | 中文

该 Service Definition 拥有 provider-neutral 的 `ctx.voice` 注册表与本地听写执行面：模型注册、引擎状态、下载/缓存状态、模型移除与转写调度。引擎 Provider 无需 Web 服务器即可注册这些操作；HTTP 与 Typert Remote Consumer 调用同一组回调。Consumer 拥有权限策略、展示与把转写文本插入 composer。

## 引擎与模型注册

只能注册一个引擎（`registerEngine`）：部署不会像在多个 mobile-device Provider 之间选择那样，在运行时于多个互相竞争的本地语音识别后端之间做选择，因此今天不需要可替换的多 provider seam。每个出厂模型各自独立注册（`registerModel`），各自携带自己的下载源、预期大小、编码归档 SHA-256，以及其 encoder/decoder/joiner/tokens 路径在解压后的归档内所遵循的 sherpa-onnx `OnlineRecognizer` 文件布局。

`engineOrUndefined` 让 Consumer 能区分「没有挂载引擎」（组合缺口）与「引擎已挂载但该模型尚未下载」（模型自身的 `VoiceModelStatus`）。`VoiceRuntime` 还暴露 Provider 的管理与转写操作；每个操作接收 `AbortSignal`，Provider 不可用时会显式失败。

## 共享操作

一个 Provider 通过 `registerOperations` 注册 `VoiceOperations`。执行面独立于 HTTP 提供引擎状态、模型列表、下载、删除与转写。移除 Provider 时，先撤销操作入口，再等待取消与清理结束。调用方提供 `AbortSignal`；缺少操作实现时以 `VOICE_UNAVAILABLE` 拒绝。

纯类型 `/types` 入口供浏览器类型消费者使用。Node 的 `/transport` 入口校验模型请求及规范 base64 编码的小端 float32 PCM，在调度前限制解码后大小为 16 MiB 并校验采样值有限。[Voice Controller](../../api/voice-controller/README.zh.md) 与 Provider 的可选 HTTP 适配器共用此校验。

## 模型体验

### Consumer 拥有的结果

#### 模型看到什么

无。该包不贡献任何面向模型的文本；`VoiceRuntime.registerEngine`／`registerModel` 与转写调度在提示词发出之前就已经替换了 composer 键入内容，因此听写输出在模型边界上与打字输入无法区分。

#### Token 影响

无；该 Service Definition 不新增请求或结果 token。

#### KV Cache 影响

无；引擎注册、模型注册与下载/缓存状态从不进入模型请求前缀。

## 已知限制与暂缓事项

不发布 invariant companion：Voice 服务校验引擎、模型与操作的注册，Consumer 读取同一组 registry，不另行维护副本。

- **六个出厂模型** —— 该切片注册了两个来自 GitHub releases 的流式 Zipformer 归档模型和四个来自 HuggingFace 的文件下载模型（英文 Zipformer、双语 Paraformer、Sense Voice、Whisper tiny），经 `hf-mirror.com` 镜像下载。
- **模型偏好归客户端所有** —— 听写界面按浏览器 origin 保存选择；本服务不跨设备同步该偏好。
- **没有流式部分结果 API** —— `VoiceRecognizer.transcribe` 对每段提交的音频只返回一条最终转写；正在进行的语句的增量部分假设不对外暴露。
