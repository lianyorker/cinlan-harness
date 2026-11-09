---
description: "通过共享 Voice runtime 和 Host 凭据使用 OpenAI 云端转写模型。"
kind: "package-reference"
---

# OpenAI voice provider

[English](README.md) | 中文

## 摘要

从语音设置中选择 OpenAI 转写模型，并将完整的 16 kHz 单声道音频片段发送到配置的 API endpoint。Provider 从 Host credentials service 读取 `OPENAI_API_KEY`；客户端可保存、轮换、清除和查询密钥是否存在，但不会收到密钥内容。云端调用需要网络，不支持流式识别或本地模型安装。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将此 Provider 与 [`voice`](../voice/README.zh.md)、credentials provider 和[经过认证的 Voice Controller](../../api/voice-controller/README.zh.md) 一起挂载。将本包加入当前 bundle 并注册到 Loader manifest。不要把 API Key 写入 `cordis.yml`。

```yaml
- name: '@cinlan/voice-openai'
  config:
    baseURL: https://api.openai.com/v1
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://api.openai.com/v1` | 不含凭据、查询或片段的 HTTP endpoint origin 和版本前缀。 |
| `requestTimeoutMs` | `120000` | 转写请求最长时限。 |
| `responseMaxBytes` | `1048576` | 可接受 JSON 响应的最大字节数。 |

Provider 注册 GPT-4o mini Transcribe 与 GPT-4o Transcribe。语音设置通过经过认证的 Host Remote 保存密钥；Provider 发送 WAV multipart 请求并设置 `response_format=json`，也可包含语言提示。上游错误响应内容不会返回给客户端。

<a id="model-experience"></a>
## 模型体验

无，因为转写返回可编辑的草稿文本，不提交 Session 消息，也不添加工具或提示词上下文。

#### KV Cache 影响

用户通过普通会话流程提交文本前，没有影响。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- Provider 只接受完整音频片段；不提供流式转写、本地下载或模型删除。
- 云端模型报告就绪前需要已配置凭据。Provider 只在执行上游请求时确认密钥是否可用。

### 开发者说明

[语音资源决策](../../../.agents/notes/implemented/feature/2026-09-14-voice-dictation-models-and-capture.zh.md) 记录 Provider 路由、凭据所有权和导入模型生命周期。
