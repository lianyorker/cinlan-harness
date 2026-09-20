# 语音听写设置迁移计划：参考 orca 完整语音设置栏

> 本文保留早期迁移计划的目标、阶段与风险，不代表当前实现清单。当前能力以[语音听写包说明](../../../packages/client/ui-voice-dictation/README.zh.md)为准；下文“拟新建（尚不存在）”只记录目录与拟议文件名，不是现有文件链接。

> 参考 orca 的 `VoicePane.tsx` 完整设置页，将 DSH 的语音听写功能从当前的基础实现提升为完整的语音设置 section，并迁移 orca 已有但 DSH 缺失的功能。

## 现状对比

### DSH 当前语音实现

#### 1. Service Definition（`voice/voice`）

**位置**：`@/packages/voice/voice/src/index.ts`

`VoiceRuntime` 继承 `Service`，提供单引擎注册和模型注册。

| 方法 | 说明 |
|---|---|
| `registerEngine(engine)` | 注册本地引擎（唯一） |
| `registerModel(definition)` | 注册模型定义 |
| `engineOrUndefined` | 获取引擎实例 |
| `listDefinitions()` | 列出已注册模型 |
| `requireDefinition(id)` | 解析模型定义 |

**类型**（`types.ts`）：
- `VoiceModelId` — Branded 标识符
- `VoiceModelKind` — `'streaming' | 'non-streaming'`
- `VoiceModelDefinition` — id, name, kind, approximateBytes, archiveUrl, archiveSha256, files
- `VoiceModelStatus` — not-downloaded / downloading / extracting / ready / failed
- `VoiceEngine` — id + loadModel()
- `VoiceRecognizer` — transcribe() + dispose()

#### 2. Service Provider（`voice/voice-sherpa-onnx`）

**位置**：`@/packages/voice/voice-sherpa-onnx/src/index.ts`

注册 sherpa-onnx 引擎 + 6 个内置模型 + `/voice/api` Host 路由。

**内置模型**（`model-registry.ts`）：

| 模型 ID | 语言 | 大小 | 类型 | 下载源 |
|---|---|---|---|---|
| `zh-streaming-zipformer-14m` | 中文 | ~74MB | streaming | GitHub release (archive) |
| `bilingual-streaming-zipformer` | 中英双语 | ~511MB | streaming | GitHub release (archive) |
| `en-streaming-zipformer-20m` | 英文 | ~92MB | streaming | HuggingFace (files, hf-mirror.com) |
| `bilingual-streaming-paraformer` | 中英双语 | ~237MB | streaming | HuggingFace (files, hf-mirror.com) |
| `sense-voice-zh-en-ja-ko-yue` | 中日英韩粤 | ~240MB | non-streaming | HuggingFace (files, hf-mirror.com) |
| `whisper-tiny` | 90+ 语言 | ~153MB | non-streaming | HuggingFace (files, hf-mirror.com) |

HuggingFace 模型使用 `hf-mirror.com` 镜像以在网络不可达地区提供可访问性。网络错误（`fetch failed` 等）显示友好提示，建议用户检查网络或开启代理。

**Host 路由**（`/voice/api`）：

| 端点 | 说明 |
|---|---|
| `engine.status` | sherpa-onnx 原生 addon 加载状态 |
| `models.list` | 列出模型 + 缓存状态 |
| `models.download` | 下载模型 |
| `models.remove` | 删除模型 |
| `transcribe` | 执行语音转文字 |

#### 3. Client UI（`client/ui-voice-dictation`）

**位置**：`@/packages/client/ui-voice-dictation/src/client/`

**注册**（`apply.ts`）：
- `settings.section` id=`voice` order=85 → `VoiceSettingsSection`
- `conversation.input.right` id=`voice-dictation` order=80 → `VoiceButton`
- 全局快捷键 Ctrl+Shift+E → `DictationController.toggle()`

**设置页**（`VoiceSettingsSection.tsx`）：

| 模块 | 功能 | 状态 |
|---|---|---|
| 麦克风权限 | 权限状态徽章 + 请求按钮 | ✅ |
| 引擎状态 | 加载状态 + 降级修复命令 | ✅ |
| 模型列表 | 下载/删除/状态轮询 | ✅ |

**缺失**：
- 无启用/禁用开关（`enabled`）
- 无听写模式选择（toggle/hold）
- 无麦克风设备选择（仅显示权限状态，无法选设备）
- 无模型选择（自动选第一个 ready 模型，无 UI 选择）
- 无 OpenAI 云端转写支持
- 无 OpenAI API Key 管理
- 无用户自定义模型导入
- 无语言设置
- 无终端确认插入设置
- 无快捷键显示

**听写控制器**（`dictation-controller.ts`）：

| 功能 | 状态 | 说明 |
|---|---|---|
| 录音 | ✅ | ScriptProcessorNode（原生采样率）→ resampleToMono16k → 16kHz mono PCM |
| 转写 | ✅ | POST /voice/api/transcribe |
| 插入 | ✅ | 追加到当前 session 的 composer draft |
| 快捷键 | ✅ | Ctrl+Shift+E toggle 模式 |
| Hold 模式 | ❌ | 仅 toggle |
| 流式转写 | ❌ | 整段录音后一次性转写 |
| 部分转写 | ❌ | 无 partial transcript |
| 终端插入 | ❌ | 仅 composer draft |
| 任意文本框插入 | ❌ | 仅 composer draft |
| 录音指示器 | ❌ | 仅 composer 按钮状态 |
| 麦克风设备选择 | ❌ | 使用浏览器默认 |
| 麦克风断开检测 | ❌ | 无 |
| 启动缓冲 | ❌ | 无 |

### orca 语音实现（参考目标）

#### 设置页（`VoicePane.tsx`）

| 模块 | 组件 | 功能 |
|---|---|---|
| 听写开关 | `VoiceDictationSettingsSection` | 启用/禁用 + macOS 麦克风权限请求 |
| 听写模式 | `VoiceDictationSettingsSection` | toggle / hold 选择 |
| 麦克风选择 | `VoiceMicrophoneSetting` | 设备枚举 + 选择 + 断开提示 |
| 模型选择 | `VoiceSpeechModelSection` | 下拉菜单选择 STT 模型 |
| OpenAI Key | `OpenAiTranscriptionSettingsRow` | API Key 配置/清除 |
| OpenAI Dialog | `OpenAiTranscriptionKeyDialog` | Key 输入对话框 |

**VoiceSettings 类型**（`speech-types.ts`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | boolean | 听写总开关 |
| `sttModel` | string | 选中的模型 ID |
| `modelsDir` | string | 模型存储目录 |
| `language` | string | 语言 |
| `dictationMode` | `'toggle' \| 'hold'` | 听写模式 |
| `terminalConfirmBeforeInsert` | boolean | 终端插入前确认 |
| `userModels` | `UserModelConfig[]` | 用户自定义模型 |
| `openAiApiKeyConfigured` | boolean | OpenAI Key 是否配置 |
| `microphoneDeviceId` | string \| null | 麦克风设备 ID |
| `microphoneDeviceLabel` | string \| null | 麦克风设备标签 |

#### 模型目录（`model-catalog.ts`）

orca 有 **12 个模型**（DSH 仅 2 个）：

| 模型 ID | 类型 | 提供者 | 语言 | 流式 | 推荐 |
|---|---|---|---|---|---|
| `parakeet-tdt-0.6b-v3-int8` | transducer | local | 多语言 | ❌ | ✅ |
| `parakeet-tdt-0.6b-v2-int8` | transducer | local | en | ❌ | |
| `zipformer-bilingual-zh-en` | transducer | local | zh-en | ✅ | |
| `paraformer-bilingual-zh-en` | paraformer | local | zh-en | ✅ | |
| `zipformer-streaming-en-20m` | transducer | local | en | ✅ | |
| `zipformer-streaming-zh-14m` | transducer | local | zh | ✅ | |
| `zipformer-streaming-korean` | transducer | local | ko | ✅ | |
| `parakeet-tdt-ctc-0.6b-ja-int8` | nemo-ctc | local | ja | ❌ | |
| `whisper-tiny` | whisper | local | 多语言 | ❌ | |
| `sense-voice-zh-en-ja-ko-yue` | senseVoice | local | 多语言 | ❌ | |
| `openai-gpt-4o-mini-transcribe` | openai | openai | 多语言 | ❌ | |
| `openai-gpt-4o-transcribe` | openai | openai | 多语言 | ❌ | |

#### 听写控制器（`DictationController.tsx`，431 行）

| 功能 | 说明 |
|---|---|
| 流式录音 | `useAudioCapture` hook 持续捕获音频 |
| 流式转写 | `window.api.speech.feedAudio()` 实时发送 PCM 到主进程 worker |
| 部分转写 | `onPartialTranscript` 实时显示部分结果 |
| 最终转写 | `onFinalTranscript` 插入最终文本 |
| 启动缓冲 | 录音先于 worker 启动，缓冲音频避免丢失开头 |
| 麦克风设备选择 | 支持指定 `microphoneDeviceId` |
| 麦克风断开检测 | `onCaptureLost` 回调 |
| 麦克风回退 | 设备不可用时回退到系统默认 |
| Toggle 模式 | IPC `onDictationKeyDown` 拦截快捷键 |
| Hold 模式 | 渲染进程 DOM keydown/keyup + blur/visibility 处理 |
| 插入目标 | 任意聚焦元素（终端、input、textarea、contentEditable） |
| 终端插入 | `CustomEvent('dictation:insertText')` |
| 文本框插入 | `pasteTextIntoTextControl` |
| ContentEditable 插入 | `execCommand('insertText')` + 分块 |
| 转写分段 | `formatFinalTranscriptSegment` CJK/拉丁文空格处理 |
| 录音指示器 | `DictationIndicator` 浮动状态条 |
| 错误处理 | toast 提示 + 状态恢复 |
| 会话管理 | runId + sessionId 防竞态 |
| 空闲拆卸 | worker 空闲超时自动终止 |

#### IPC API（`window.api.speech`）

| 方法 | 说明 |
|---|---|
| `getCatalog()` | 获取模型目录 |
| `getModelStates()` | 获取模型状态 |
| `getOpenAiApiKeyStatus()` | OpenAI Key 状态 |
| `saveOpenAiApiKey(key)` | 保存 OpenAI Key |
| `clearOpenAiApiKey()` | 清除 OpenAI Key |
| `downloadModel(id)` | 下载模型 |
| `cancelDownload(id)` | 取消下载 |
| `deleteModel(id)` | 删除模型 |
| `startDictation(modelId, hotwords, sessionId)` | 启动流式听写 |
| `feedAudio(samples, sampleRate, sessionId)` | 发送音频块 |
| `stopDictation(sessionId)` | 停止听写 |
| `onPartialTranscript(cb)` | 部分转写事件 |
| `onFinalTranscript(cb)` | 最终转写事件 |
| `onDownloadProgress(cb)` | 下载进度事件 |
| `onReady(cb)` | 就绪事件 |
| `onStopped(cb)` | 停止事件 |
| `onError(cb)` | 错误事件 |

## 差异总结

| 维度 | DSH | orca | 差距 |
|---|---|---|---|
| **设置页** | | | |
| 启用/禁用开关 | ❌ | ✅ | 缺失 |
| 听写模式 | ❌ (仅 toggle) | ✅ (toggle + hold) | 缺失 hold |
| 麦克风设备选择 | ❌ (仅权限) | ✅ (枚举+选择) | 缺失 |
| 模型选择 | ❌ (自动) | ✅ (下拉菜单) | 缺失 |
| OpenAI 云端 | ❌ | ✅ | 缺失 |
| OpenAI Key 管理 | ❌ | ✅ | 缺失 |
| 用户自定义模型 | ❌ | ✅ | 缺失 |
| 语言设置 | ❌ | ✅ | 缺失 |
| 终端确认插入 | ❌ | ✅ | 缺失 |
| 快捷键显示 | ❌ | ✅ | 缺失 |
| **模型** | | | |
| 模型数量 | 6 | 12 | 缺 6 个（Parakeet、韩语 Zipformer、日语 CTC、2 个 OpenAI） |
| 模型类型 | streaming + non-streaming | streaming + offline | ✅ 已补齐 offline |
| 云端模型 | ❌ | ✅ (OpenAI) | 缺失 |
| 推荐标记 | ✅ | ✅ | ✅ 已补齐 |
| **听写** | | | |
| 转写方式 | 整段录音后转写 | 流式实时转写 | 架构差异 |
| 部分转写 | ❌ | ✅ | 缺失 |
| 插入目标 | composer draft only | 终端+文本框+contentEditable | 缺失 |
| Hold 模式 | ❌ | ✅ | 缺失 |
| 录音指示器 | ❌ (仅按钮) | ✅ (浮动条) | 缺失 |
| 麦克风断开 | ❌ | ✅ | 缺失 |
| 启动缓冲 | ❌ | ✅ | 缺失 |
| 转写分段空格 | ❌ | ✅ | 缺失 |
| **架构** | | | |
| 引擎运行 | 主进程同步加载 | Worker 线程 | DSH 无 worker |
| 音频传输 | base64 POST | Float32Array IPC | 不同 |
| 状态管理 | DictationController class | React hooks + app store | 不同 |

## 迁移策略

DSH 的语音架构与 orca 差异较大（整段转写 vs 流式、主进程 vs Worker、composer-only vs 任意目标）。迁移分两条路径：

1. **设置页迁移**：将 orca 的设置项迁移到 DSH Settings section，这是低风险增量改进
2. **听写引擎迁移**：将整段转写升级为流式转写，这是架构级变更，需谨慎评估

### 命名与注册

- section id：`voice`（已有，保留）
- 导航标签：`Voice` / `语音`（已有）
- 注册方式：`ctx.slots.inject('settings.section', ...)`（已有）

### 架构决策

1. **保留 `/voice/api` HTTP 路由**：DSH 的 Host 路由模式与 orca 的 Electron IPC 不同，不迁移到 IPC
2. **流式转写需新增 WebSocket 端点**：当前 `/voice/api/transcribe` 是一次性 POST，流式需新增 `/voice/api/stream` WebSocket 或 SSE
3. **设置持久化通过 `settingsScope`**：DSH 无 orca 的 `GlobalSettings.voice` 对象，需新增 voice settings scope
4. **模型选择优先自动**：保留当前"自动选第一个 ready 模型"作为默认行为，新增手动选择 UI

## 分阶段实施

### 阶段 1：设置页增强 — 启用开关 + 听写模式

**目标**：添加启用/禁用开关和 toggle/hold 模式选择。

**新增设置项**：

| 设置 | 字段 | 控件 | 默认 |
|---|---|---|---|
| 启用语音听写 | `enabled` | switch | on |
| 听写模式 | `dictationMode` | toggle/hold | toggle |

**文件变更**：

1. **新建** `@/packages/client/ui-voice-dictation/src/client/voice-settings.ts`
   - 定义 `VoiceSettings` 类型：`{ enabled: boolean, dictationMode: 'toggle' | 'hold', sttModel: string | null, microphoneDeviceId: string | null }`
   - 通过 `settingsScope` 持久化（localStorage 或 ctx.settings）

2. **修改** `VoiceSettingsSection.tsx`
   - 在麦克风权限上方添加启用开关
   - 在启用开关下方添加听写模式选择（toggle/hold 按钮组）
   - 未启用时禁用所有子模块

3. **修改** `apply.ts`
   - `DictationController.toggle()` 检查 `enabled` 和 `dictationMode`
   - hold 模式：keydown 启动、keyup 停止（参考 orca `use-hold-dictation-gesture.ts`）

4. **修改** `dictation-controller.ts`
   - `toggle()` 仅在 `enabled` 时响应
   - 新增 `start(sessionId)` 和 `stop(sessionId)` 方法支持 hold 模式

5. **修改** `locales.ts`
   - 新增 `enableDictation` / `dictationMode` / `modeToggle` / `modeHold` / `modeToggleDescription` / `modeHoldDescription`

### 阶段 2：模型选择 UI

**目标**：添加模型选择下拉菜单，替换当前的自动选择逻辑。

**文件变更**：

1. **修改** `VoiceSettingsSection.tsx`
   - 在引擎状态和模型列表之间添加模型选择下拉菜单
   - 仅显示 `status.state === 'ready'` 的模型为可选项
   - 无 ready 模型时显示提示

2. **修改** `dictation-controller.ts`
   - `readyModelId()` 改为读取用户选择的 `sttModel`，回退到第一个 ready 模型

3. **修改** `voice-settings.ts`
   - `sttModel` 字段持久化

4. **修改** `locales.ts`
   - 新增 `selectModel` / `noModelSelected` / `noModelReady`

### 阶段 3：麦克风设备选择

**目标**：添加麦克风设备枚举和选择，替换当前的"使用浏览器默认"。

**参考**：`@/orca/src/renderer/src/components/settings/VoiceMicrophoneSetting.tsx`

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-voice-dictation/src/client](../../../packages/client/ui-voice-dictation/src/client/) 下创建 `microphone-devices.ts`。当前设备枚举与选择见 [VoiceSettingsSection.tsx](../../../packages/client/ui-voice-dictation/src/client/VoiceSettingsSection.tsx)，指定设备录音见 [dictation-controller.ts](../../../packages/client/ui-voice-dictation/src/client/dictation-controller.ts)；此文件名只保留原拆分设想。
   - `listVoiceMicrophoneDevices()` — 枚举音频输入设备
   - `buildVoiceMicrophoneSelectOptions()` — 构建下拉选项
   - `openMicrophoneCaptureStream()` — 指定设备 ID 打开流

2. **修改** `VoiceSettingsSection.tsx`
   - 麦克风权限区替换为设备选择下拉 + 权限状态
   - 设备列表通过 `navigator.mediaDevices.enumerateDevices()` 获取
   - `devicechange` 事件监听刷新列表
   - 权限未授予时显示"允许访问"按钮

3. **修改** `dictation-controller.ts`
   - `start()` 使用 `getUserMedia({ audio: { deviceId: { exact: microphoneDeviceId } } })`

4. **修改** `voice-settings.ts`
   - `microphoneDeviceId` + `microphoneDeviceLabel` 持久化

5. **修改** `locales.ts`
   - 新增 `microphoneSelect` / `systemDefault` / `unavailable` / `allowAccess`

### 阶段 4：扩展模型目录

**目标**：将 orca 的 12 个模型目录迁移到 DSH，替换当前 2 个模型。

**参考**：`@/orca/src/main/speech/model-catalog.ts`

**文件变更**：

1. **修改** `@/packages/voice/voice/src/types.ts`
   - `VoiceModelDefinition` 扩展：添加 `label`、`description`、`language`、`streaming`、`recommended`、`type`、`provider` 字段
   - 新增 `SpeechModelProvider` 类型：`'local' | 'openai'`
   - `VoiceModelKind` 扩展为 `SpeechModelType`：`'transducer' | 'paraformer' | 'whisper' | 'senseVoice' | 'nemo-ctc' | 'openai'`

2. **修改** `@/packages/voice/voice-sherpa-onnx/src/model-registry.ts`
   - 替换 2 个模型为 orca 的 10 个本地模型（不含 OpenAI）
   - 每个模型添加 `label`、`description`、`language`、`streaming`、`recommended`、`type` 字段
   - 模型文件布局从固定 4 文件（encoder/decoder/joiner/tokens）改为灵活 `files: string[]`

3. **修改** `@/packages/voice/voice-sherpa-onnx/src/engine.ts`
   - `sherpaOnnxEngine.loadModel()` 支持多种模型类型（transducer/paraformer/whisper/senseVoice/nemo-ctc）
   - 根据模型 `type` 选择 sherpa-onnx 的不同 Recognizer 配置

4. **修改** `VoiceSettingsSection.tsx`
   - 模型列表显示 `label` + `description` + `language` 标签 + `recommended` 徽章 + `streaming`/`offline` 标签

5. **修改** `locales.ts`
   - 新增 `streaming` / `offline` / `recommended` 标签文案

### 阶段 5：流式转写（架构级变更）

**目标**：将整段录音后转写升级为流式实时转写。

**参考**：`@/orca/src/main/speech/stt-service.ts`（Worker 线程 + 流式 feedAudio）

**架构变更**：

当前 DSH 流程：
```
录音 → ScriptProcessorNode（原生采样率）→ resampleToMono16k → base64 PCM → POST /voice/api/transcribe → 文本
```

目标流程：
```
录音 → AudioWorklet/ScriptProcessor → 16kHz mono PCM → WebSocket /voice/api/stream → partial transcript → final transcript
```

**文件变更**：

1. **拟新建（尚不存在）**：在 [voice-sherpa-onnx/src](../../../packages/voice/voice-sherpa-onnx/src/) 下创建 `streaming.ts`
   - WebSocket 端点 `/voice/api/stream`
   - 接收 base64 PCM 块 → 喂入 sherpa-onnx OnlineRecognizer → 发送 partial/final transcript
   - 会话管理：start / feed / stop

2. **修改** `@/packages/voice/voice-sherpa-onnx/src/engine.ts`
   - `VoiceRecognizer` 扩展：新增 `feed(samples: Float32Array): Promise<void>` 和事件回调
   - `VoiceEngine` 扩展：`loadModel()` 返回支持流式的 recognizer

3. **拟新建（尚不存在）**：在 [ui-voice-dictation/src/client](../../../packages/client/ui-voice-dictation/src/client/) 下创建 `streaming-dictation.ts`
   - 替换 `dictation.ts` 的整段录音逻辑
   - AudioContext + AudioWorkletNode 持续捕获 16kHz mono PCM
   - WebSocket 发送 PCM 块
   - 接收 partial/final transcript 事件

4. **修改** `dictation-controller.ts`
   - `start()` 打开 WebSocket + 启动 AudioWorklet
   - `stop()` 关闭 WebSocket + 停止 AudioWorklet
   - partial transcript 更新 UI 状态
   - final transcript 插入文本

5. **拟新建（尚不存在）**：在 [ui-voice-dictation/src/client](../../../packages/client/ui-voice-dictation/src/client/) 下创建 `DictationIndicator.tsx`
   - 浮动状态条：录音中显示 partial transcript
   - 停止按钮
   - 快捷键提示

**风险**：这是最大的架构变更。sherpa-onnx 的 OnlineRecognizer 支持流式，但 DSH 当前在主进程同步加载模型，流式需要 Worker 线程避免阻塞主进程。

### 阶段 6：任意目标插入

**目标**：将听写文本插入从仅 composer draft 扩展到任意聚焦元素。

**参考**：`@/orca/src/renderer/src/components/dictation/dictation-insertion-target.ts`

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-voice-dictation/src/client](../../../packages/client/ui-voice-dictation/src/client/) 下创建 `insertion-target.ts`
   - `captureInsertionTarget()` — 捕获当前聚焦元素
   - 支持：HTMLInputElement / HTMLTextAreaElement / contentEditable / 终端
   - `insertText(text, target)` — 向目标插入文本

2. **修改** `dictation-controller.ts`
   - `start()` 时捕获插入目标
   - `stop()` 时向捕获的目标插入文本（而非仅 composer draft）

3. **拟新建（尚不存在）**：在 [ui-voice-dictation/src/client](../../../packages/client/ui-voice-dictation/src/client/) 下创建 `final-segments.ts`
   - `formatFinalTranscriptSegment()` — CJK/拉丁文边界空格处理
   - 参考 orca 的 `dictation-final-segments.ts`

### 阶段 7：OpenAI 云端转写（可选）

**目标**：添加 OpenAI 云端转写模型支持和 API Key 管理。

**参考**：`@/orca/src/renderer/src/components/settings/OpenAiTranscriptionKeyDialog.tsx`

**文件变更**：

1. **新建** `@/packages/voice/voice-openai/src/index.ts`
   - OpenAI 转写 Provider
   - 注册 OpenAI 模型到 `ctx.voice`
   - Host 路由 `/voice/api/openai/transcribe`
   - API Key 存储（加密文件，参考 orca `openai-api-key-store.ts`）

2. **修改** `VoiceSettingsSection.tsx`
   - 添加 OpenAI API Key 配置行
   - 添加 Key 输入对话框
   - 模型选择中包含 OpenAI 模型（显示云图标）

3. **修改** `voice-settings.ts`
   - `openAiApiKeyConfigured` 字段

4. **修改** `locales.ts`
   - 新增 OpenAI 相关文案

### 阶段 8：用户自定义模型导入（可选）

**目标**：允许用户导入本地 sherpa-onnx 模型。

**参考**：orca `UserModelConfig` 类型

**文件变更**：

1. **修改** `voice-settings.ts`
   - `userModels: UserModelConfig[]` 字段

2. **修改** `VoiceSettingsSection.tsx`
   - 添加"导入模型"按钮
   - 文件选择器选择模型目录
   - 验证模型文件完整性

3. **修改** `@/packages/voice/voice-sherpa-onnx/src/index.ts`
   - `/voice/api` 新增 `models.import` 端点
   - 注册用户模型到 `ctx.voice`

## 风险

1. **流式转写架构差异大**：DSH 当前是整段录音后 POST 转写，orca 是 Worker 线程流式 feedAudio。迁移到流式需要 WebSocket + AudioWorklet + Worker 线程，是最大的架构变更。
2. **sherpa-onnx 模型类型扩展**：当前 DSH 仅支持 streaming Zipformer transducer（固定 4 文件布局），orca 支持 6 种模型类型（transducer/paraformer/whisper/senseVoice/nemo-ctc/openai），每种有不同的文件布局和 Recognizer 配置。
3. **主进程阻塞**：DSH 在主进程同步加载 sherpa-onnx，流式转写需要 Worker 线程避免阻塞。orca 使用 `new Worker(workerPath)` 隔离推理。
4. **设置持久化**：DSH 无 orca 的 `GlobalSettings.voice` 对象，需新增 voice settings scope。当前 DSH 的 voice 设置无持久化（模型选择靠自动，无启用开关）。
5. **插入目标安全**：向任意聚焦元素插入文本需处理终端、contentEditable、input/textarea 的不同插入方式，以及大文本分块。
6. **OpenAI Key 存储**：DSH 无 Electron `safeStorage`，需自行实现加密存储或使用 DSH 的 credentials capability。
7. **模型下载兼容性**：DSH 已支持两种下载方式：archive（tar.bz2，GitHub release）和 files（多文件并行，HuggingFace）。新增的 4 个 HuggingFace 模型使用 `files` 方式，经 `hf-mirror.com` 镜像下载。
8. **转写空结果**：当前 `ScriptProcessorNode` 采集在某些浏览器/音频驱动组合下可能产生近零振幅样本，导致转写结果为空。迁移到 `AudioWorkletNode` 是已知的后续工作。
