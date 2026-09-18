---
description: "本地语音转写 Service Definition 与 sherpa-onnx Provider 包。"
kind: "package-group"
---

# voice/ — 本地语音转写

[English](README.md) | 中文

## 概述

`voice/` 包族负责本地语音转写的引擎、模型与共享操作接口，以及 sherpa-onnx Provider。麦克风采集和经过认证的 Remote 投影属于相应的消费包。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

<a id="packages"></a>
## 包

| 包 | 作用 |
|---|---|
| [`voice/`](voice/README.zh.md) | 引擎／模型注册与可取消的模型／转写操作 Service Definition |
| [`voice-sherpa-onnx/`](voice-sherpa-onnx/README.zh.md) | 本地引擎 Provider、模型缓存／下载生命周期与识别 |

<a id="related-documentation"></a>
## 相关文档

- [Voice 子系统参考](../../docs/subsystems/voice.zh.md) — 模型定义、操作结果、引擎接口与 Cordis API。
- [Voice Controller](../api/voice-controller/README.zh.md) — 经过认证的人类 Remote 请求与 PCM 校验。
