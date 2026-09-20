---
description: "与提供方无关的本地语音模型任务与转写。"
kind: "package-reference"
---
# Voice runtime

[English](README.md) | 中文

## 摘要

`ctx.voice` 服务注册一个本地语音引擎、模型目录，以及提供方拥有的模型管理与转写操作。客户端负责麦克风权限、音频采集与草稿插入。

## 目录

- [使用本包](#use-this-package)
- [任务语义](#task-semantics)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

将 `@deepseek-ai/dsh-voice` 与 [Sherpa 提供方](../voice-sherpa-onnx/README.zh.md) 及[身份验证控制器](../../api/voice-controller/README.zh.md) 一起挂载。本服务没有配置。每个引擎、模型与操作注册都返回释放函数；重复注册会显式失败。缺少提供方操作时以 `VOICE_UNAVAILABLE` 拒绝。

纯类型 `/types` 入口提供浏览器声明。Node `/transport` 入口校验模型、精确任务请求及规范 base64 小端 float32 PCM，限制解码后大小为 16 MiB，且采样值必须有限。

<a id="task-semantics"></a>
## 任务语义

下载、重新安装与更新在接纳时返回带品牌的 Host 任务标识。传输取消仅在接纳前生效；后续断开连接不会取消任务。`modelsList` 返回每个模型的持久资源身份和当前 Host 的最近任务。`modelsCancel` 仅取消并等待匹配的运行中任务。过期标识、其他 Host 的标识或已结束任务均返回 `cancelled: false`。提供方释放时取消并等待自身任务。

资源版本是固定清单的 SHA-256 指纹，并包含脱敏源 URL 和明确的完整性状态。重新安装强制替换；更新比较已安装指纹与固定目录。替换进行中或失败时，已验证的旧代仍保持就绪。提供方负责持久修订检查与识别器租约；[存储语义](../voice-sherpa-onnx/README.zh.md#resource-lifecycle) 规定旧缓存验证与删除行为。

<a id="model-experience"></a>
## 模型体验

### 客户端拥有的结果

#### 模型看到什么

无。转写为客户端草稿返回文本；只有普通提交才会使其对模型可见。

#### Token 影响

客户端提交草稿前没有影响。

#### KV Cache 影响

注册、模型任务与资源状态从不进入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

服务为每段音频返回一个最终转写，不提供增量假设。模型与麦克风偏好属于客户端。不发布 invariant 伴随插件：消费者读取的正是执行注册所有权约束的注册表。

## 开发者说明

[语音决策](../../../.agents/notes/implemented/feature/2026-09-14-voice-dictation-models-and-capture.zh.md) 记录模型完整性与 Host 任务所有权。
