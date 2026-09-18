---
description: "通过经过身份验证的 Web 与桌面 Remote 管理本地语音模型并转写音频。"
kind: "package-reference"
---
# Voice Controller

[English](README.md) | 中文

## 摘要

`@deepseek-ai/dsh-api-voice-controller` 向 Web 与 Desktop 客户端提供本地引擎状态、模型资源与转写。两种通道调用相同的 Provider 操作；Desktop 不需要 HTTP 服务器。转写返回可编辑草稿的文本，不会提交消息。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将此 Controller 与 `typert`、[`voice`](../../voice/voice/README.zh.md) 一起挂载。[Sherpa Provider](../../voice/voice-sherpa-onnx/README.zh.md) 提供原生识别与模型管理。应用提供经过身份验证的 [Connection](../../client/connection/README.zh.md) 与 [Gateway](../gateway/README.zh.md) 通道。此 Controller 没有配置字段。

```yaml
- name: '@deepseek-ai/dsh-api-voice-controller'
```

生成的 `ctx.remote.voice` 方法返回 `RemoteResult` 信封。可选的 `AbortSignal` 作为最后一个参数传入；仅在 `ok` 为 true 时显示成功。

| 方法 | 输入 | 成功值 |
|---|---|---|
| `engineStatus(signal?)` | 无 | 原生模块可用状态或降级修复指引 |
| `modelsList(signal?)` | 无 | 含当前缓存状态的 `{ models }` |
| `modelsDownload(request, signal?)` | `{ modelId }` | 安装完成后的 `{ cacheDir }` |
| `modelsRemove(request, signal?)` | `{ modelId }` | 模型工作与删除结算后的 `{}` |
| `transcribe(request, signal?)` | `{ modelId, pcm16kMonoBase64 }` | `{ text }` |

PCM 为 16 kHz 单声道、有限 float32 采样的小端字节，使用规范 base64 编码，解码后最多 16 MiB。Controller 与可选旧 HTTP 适配器共用校验。模型标识必须来自可用清单，转写前模型必须就绪。

无效请求、未知模型、缺少文件、模型正在删除、Provider 不可用及操作失败分别使用 `voice/invalid-request`、`voice/model-unknown`、`voice/model-not-ready`、`voice/model-busy`、`voice/unavailable` 和 `voice/operation-failed`。取消沿通道传播。Provider 的 `VoiceError` 代码保留在错误详情中；非预期异常使用固定公开消息。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

Host 服务为 `voiceController`，Remote 命名空间为 `voice`。Controller 拥有请求解码与错误转换；Provider 拥有下载、缓存状态和识别器清理。移除 Provider 时先撤销操作，再等待取消；移除 Controller 时撤销其端点。

[组合测试](tests/composition.spec.ts) 启动真实 Loader 条目，覆盖无 `webServer` 的 Desktop Fetch 通道、经过身份验证的 HTTP、可选旧 HTTP 的行为一致性、取消及 Provider/Controller 重载。仅控制外部原生识别与下载输入。不发布 invariant 伴随插件，因为此适配器没有独立于 Provider 和通道的资源状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Voice 定义](../../voice/voice/README.zh.md) — 与 Provider 无关的操作和类型。
- [Sherpa Provider](../../voice/voice-sherpa-onnx/README.zh.md) — 模型下载与原生识别。
- [听写界面](../../client/ui-voice-dictation/README.zh.md) — 采集、偏好与草稿插入。

-----

<a id="model-experience"></a>
## 模型体验

无，因为语音操作返回客户端数据，不发送消息或增加模型上下文。

#### KV Cache 影响

用户通过普通会话流程提交产生的草稿前，没有影响。

## 已知限制与暂缓事项
<a id="known-limitations-and-deferred-work"></a>

- 原生推理采用协作取消：取消会阻止结果返回，拆除会等待识别器调用结算后再释放它。
- 麦克风权限与采集仍由客户端负责。引擎可用性取决于本地原生模块和已下载的模型文件。
