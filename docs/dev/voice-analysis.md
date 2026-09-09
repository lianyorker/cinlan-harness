# Voice（语音识别）分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

Voice 是本地语音听写能力。基于 sherpa-onnx 引擎，支持模型下载/缓存和推理。设置页面和 Ctrl+Shift+E 听写客户端通过 `/voice/api` Host 路由调用。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `voice/voice` | Service Definition | `ctx.voice` 注册和调度 | 3 文件, 8.2KB |
| `voice/voice-sherpa-onnx` | Service Provider | sherpa-onnx 引擎 + Host 路由 | 9 文件, 50.2KB |

## Service Definition（`voice/voice`）

`ctx.voice: VoiceRuntime`（继承 `Service`）

### 设计决策

单引擎注册（非多 Provider 竞争）：只有一个嵌入式本地引擎，不需要运行时在多个后端之间选择。

### 核心方法

| 方法 | 说明 |
|------|------|
| `registerEngine(engine)` | 注册本地引擎（唯一，重复抛错） |
| `registerModel(model)` | 注册模型定义 |
| `transcribe(request)` | 执行语音转文字 |
| `listModels()` | 列出已注册模型 |

### 类型

- `VoiceModelId` — Branded 标识符
- `VoiceEngine` — 引擎接口（`id`、`transcribe`）
- `VoiceModelDefinition` — 模型定义（id、kind、语言等）
- `VoiceModelKind` — 模型类型
- `VoiceModelStatus` — 模型状态（下载/就绪/错误）
- `VoiceModelSummary` — 模型摘要
- `VoiceRecognizer` — 识别器
- `VoiceTranscribeRequest` — 转写请求
- `VoiceTranscribeResult` — 转写结果

## Service Provider（`voice/voice-sherpa-onnx`）

224 行（index.ts），9 个源文件共 50KB。

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `downloadSegmentBytes` | 8MB | 单次 HTTP range 请求字节 |
| `downloadConcurrency` | 4 | 并发 HTTP range 请求数 |
| `downloadMaxAttempts` | 4 | 单 range 最大重试次数 |
| `downloadRetryDelayMs` | 1000 | 指数退避初始延迟 |
| `downloadRequestTimeoutMs` | 120000 | 无字节超时 |

### 源文件

| 文件 | 说明 |
|------|------|
| `index.ts` | Provider 主入口 + Host 路由 |
| `engine.ts` | sherpa-onnx 引擎实现 |
| `engine-repair.ts` | 引擎修复提示 |
| `model-cache.ts` | 模型下载/缓存管理 |
| `model-registry.ts` | 内置模型注册 |
| `sherpa-deps.ts` | sherpa-onnx 原生依赖加载 |
| `trust-fence.ts` | 信任围栏 |
| `wire.ts` | 线协议 |
| `invariant.ts` | 运行时不变量 |

### Host 路由（`/voice/api`）

| 端点 | 说明 |
|------|------|
| `engine.status` | 报告 sherpa-onnx 原生 addon 加载状态 |
| `model.list` | 列出可用模型 |
| `model.status` | 查询模型下载状态 |
| `model.download` | 下载模型 |
| `model.forget` | 删除模型缓存 |
| `transcribe` | 执行语音转文字 |

### 引擎状态

```ts
type EngineStatus =
  | { ok: true }
  | { ok: false; cause: string; command: string; profile: string | null; note: string }
```

加载失败时提供修复命令提示。

### 信任围栏

`isTrustedVoiceApiRequest()` — 验证请求来源，防止未授权调用。

## Client UI

`client/ui-voice-dictation` — 语音听写 UI 组件：

| 文件 | 说明 |
|------|------|
| `VoiceButton.tsx` | 语音按钮 |
| `VoiceSettingsSection.tsx` | 设置页语音区域 |
| `dictation-controller.ts` | 听写控制器 |
| `dictation.ts` | 听写逻辑 |
| `microphone.ts` | 麦克风管理 |
| `api.ts` | API 客户端 |

## 与其他能力的关系

- `host` — 通过 `ctx.host` 注册 `/voice/api` 路由
- `subprocess` — sherpa-onnx 原生 addon 加载
- `settings` — 设置页面展示模型状态和下载

## main 中是否存在

❌ main 没有 `voice/` 顶层包组。需要完整迁移。

## 注意事项

- sherpa-onnx 是原生依赖，需要平台特定的二进制
- 模型下载支持断点续传（HTTP range）
- 引擎加载失败有修复提示（类似 node-pty 的 deps 状态检查）
