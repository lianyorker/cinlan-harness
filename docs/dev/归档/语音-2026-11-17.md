# 语音听写设置迁移计划：参考 orca 完整语音设置栏

> 本文保留早期迁移计划的目标、阶段与风险，不代表当前实现清单。当前能力以[语音听写包说明](../../../packages/client/ui-voice-dictation/README.zh.md)为准；下文“拟新建（尚不存在）”只记录目录与拟议文件名，不是现有文件链接。

> 当前交付记录：启用开关、toggle/hold 模式、麦克风设备选择、语言设置、ready 模型选择、OpenAI 云端转写与 Host `OPENAI_API_KEY` 管理、用户模型导入、默认关闭的终端插入确认、AudioWorklet 采集、活动录音音轨意外结束处理、精确设备缺失时的一次性系统默认回退、转写分段空格，以及应用级独立状态条已实现。在线模型通过 authenticated `voice` Remote 接收连续重采样并按 100 ms 合并的 PCM 分块，显示 partial 假设，且只在完整 final 后插入；离线模型仍以整段 unary API 转写。在线 native recognition 在独立子进程运行。用户模型由 Host 校验并复制到受管 generation，provider 重载后恢复，删除只清理受管副本。回退不会改写浏览器保存的设备偏好，并在发起会话显示提示。独立状态条复用 `shell.overlay`，录音跨会话导航可见，转写期间停止操作禁用。真实 Gateway + native worker 已使用真实 WAV 与缓存验收；物理麦克风输入振幅仍需单独验收。

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
- `VoiceModelKind` — `'streaming' | 'non-streaming'` recognizer input mode; streaming models receive bounded PCM chunks
- `VoiceModelDefinition` — 标识、显示元数据、识别器类别、固定下载清单与模型架构
- `VoiceModelStatus` — not-downloaded / downloading / extracting / ready / failed
- `VoiceEngine` — id + loadModel()
- `VoiceRecognizer` — transcribe(), optional createStream(), and dispose()

#### 2. Service Provider（`voice/voice-sherpa-onnx`）

**位置**：`@/packages/voice/voice-sherpa-onnx/src/index.ts`

注册 sherpa-onnx 引擎、十个固定本地模型和 Host 操作实现。客户端通过 authenticated `voice` Remote 调用操作；可选的 `/voice/api` loopback HTTP adapter 使用同一操作实现。模型使用 transducer、paraformer、whisper、SenseVoice 与 NeMo CTC 五种本地识别架构。

**内置模型**（`model-registry.ts`）：

| 模型 ID | 类别 | 语言 | 识别方式 |
|---|---|---|---|
| `parakeet-tdt-0.6b-v3-int8` | transducer | 多语言 | 离线 |
| `parakeet-tdt-0.6b-v2-int8` | transducer | 英文 | 离线 |
| `zipformer-bilingual-zh-en` | transducer | 中英双语 | 在线分块识别 |
| `paraformer-bilingual-zh-en` | paraformer | 中英双语 | 在线分块识别 |
| `zipformer-streaming-en-20m` | transducer | 英文 | 在线分块识别 |
| `zipformer-streaming-zh-14m` | transducer | 中文 | 在线分块识别 |
| `zipformer-streaming-korean` | transducer | 韩文 | 在线分块识别 |
| `parakeet-tdt-ctc-0.6b-ja-int8` | nemo-ctc | 日文 | 离线 |
| `whisper-tiny` | whisper | 多语言 | 离线 |
| `sense-voice-zh-en-ja-ko-yue` | senseVoice | 中英日韩粤 | 离线 |

模型文件、固定 revision、大小和 SHA-256 以 [模型注册表](../../../packages/voice/voice-sherpa-onnx/src/model-registry.ts) 为准。在线模型使用双向 Remote uplink；离线模型和设置页麦克风测试保留完整片段转写。

HuggingFace 模型使用 `hf-mirror.com` 镜像以在网络不可达地区提供可访问性。网络错误（`fetch failed` 等）显示友好提示，建议用户检查网络或开启代理。

**Host 操作**（`voice` Remote；`/voice/api` 是可选 HTTP adapter）：

| 端点 | 说明 |
|---|---|
| `engine.status` | sherpa-onnx 原生 addon 加载状态 |
| `models.list` | 列出模型、资源指纹、缓存状态与 Host 任务 |
| `models.download` | 安装固定模型清单 |
| `models.reinstall` | 从固定模型清单重装 |
| `models.update` | 安装当前可用的固定清单版本 |
| `models.cancel` | 取消精确 Host 任务 |
| `models.remove` | 删除受管模型资源 |
| `transcribe` | 对完整 PCM 音频执行语音转文字；客户端 Remote 序列化传输，loopback adapter 接受 HTTP POST |
| `transcribeStream` | 对在线模型接收有界 PCM uplink，并下发 partial 与 final 文本 |

#### 3. Client UI（`client/ui-voice-dictation`）

**位置**：`@/packages/client/ui-voice-dictation/src/client/`

**注册**（`apply.ts`）：
- `settings.section` id=`voice` order=85 → `VoiceSettingsSection`
- `conversation.input.right` id=`voice-dictation` order=80 → `VoiceButton`
- 全局快捷键 Ctrl+Shift+E → `DictationController.toggle()`

**设置页**（`VoiceSettingsSection.tsx`）：

| 模块 | 功能 | 状态 |
|---|---|---|
| 听写控制 | 启用开关、toggle/hold 模式、Ctrl+Shift+E | ✅ |
| 麦克风 | 权限请求、设备枚举与选择、不可用设备提示 | ✅ |
| 引擎状态 | 加载状态 + 降级修复命令 | ✅ |
| 模型 | 就绪模型选择、安装/重装/更新/取消/删除与任务状态 | ✅ |
| 麦克风测试 | 有界录音、输入电平、主机转写结果 | ✅ |

**已完成与剩余项**：OpenAI 云端转写与 Host 凭据管理、用户模型导入、语言设置、应用级录音状态条和有界 Remote 启动缓冲已交付。剩余验收是物理麦克风输入振幅与真实语音准确率；启动缓冲不另行引入客户端整段录音缓存。

**听写控制器**（`dictation-controller.ts`）：

| 功能 | 状态 | 说明 |
|---|---|---|
| 录音 | ✅ | inline AudioWorkletNode（原生采样率）→ resampleToMono16k → 16kHz mono PCM |
| 转写 | ✅ | authenticated `voice` Remote；可选 loopback HTTP adapter 为 POST /voice/api/transcribe |
| 插入 | ✅ | 录音开始前捕获目标；composer 追加到当前 session draft，其他目标恢复原选择后插入 |
| 听写开关 | ✅ | 浏览器偏好控制快捷键与输入区按钮是否接受新操作 |
| 快捷键 | ✅ | Ctrl+Shift+E；toggle 模式切换录音，hold 模式按住启动并在释放时停止 |
| 麦克风选择 | ✅ | 浏览器偏好选择输入设备；不可用时保留选择并显示不可用状态 |
| 模型选择 | ✅ | 浏览器偏好选择 ready 模型；自动模式使用首个 ready 模型 |
| 流式转写 | ✅（在线模型） | 分块转写；离线模型仍停止后 unary 转写 |
| 部分转写 | ✅（在线模型） | partial 仅用于状态显示，final 才插入 |
| 终端插入 | ✅ | 通过 sidebar 的本地 `dsh:voice-insert-text` 事件调用 xterm `paste()` |
| 任意文本框插入 | ✅ | input、textarea、contentEditable 和 sidebar xterm terminal 已按录音开始时的目标插入 |
| 独立录音指示器 | ✅ | `shell.overlay` 显示启动、录音与转写状态，并可停止录音 |
| 活动录音断开处理 | ✅ | 音轨意外结束时关闭采集、丢弃不完整音频并通知发起会话；不自动切换设备 |
| 启动缓冲 | ✅（有界） | Remote uplink 在 Host stream opener 和 native worker 就绪前暂存 PCM；没有额外的无限客户端录音缓存 |

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

orca 有 **10 个本地模型和 2 个 OpenAI 云端模型**。DSH 当前提供相同的 10 个本地模型及 2 个 OpenAI 云端模型：

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
| 启用/禁用开关 | ✅ | ✅ | — |
| 听写模式 | ✅ (toggle + hold) | ✅ (toggle + hold) | — |
| 麦克风设备选择 | ✅ (枚举+选择；指定设备缺失时提示并临时回退到系统默认) | ✅ (枚举+选择) | — |
| 模型选择 | ✅ (就绪模型下拉菜单) | ✅ (下拉菜单) | — |
| OpenAI 云端 | ✅ | ✅ | — |
| OpenAI Key 管理 | ✅ | ✅ | — |
| 用户自定义模型 | ✅ | ✅ | — |
| 语言设置 | ✅ | ✅ | — |
| 终端确认插入 | ✅（默认关闭，可配置） | ✅ | — |
| 设置页显示快捷键组合 | ✅ | ✅ | — |
| **模型** | | | |
| 本地模型数量 | 10 | 10 | — |
| 本地识别架构 | transducer、paraformer、whisper、senseVoice、nemo-ctc | 同左 | — |
| 云端模型 | ✅ | ✅ (OpenAI) | — |
| 推荐标记 | ✅ | ✅ | ✅ 已补齐 |
| **听写** | | | |
| 转写方式 | streaming 模型在线分块；offline 模型整段转写 | 流式实时转写 | 离线模型能力仍不同 |
| 部分转写 | ✅（streaming 模型） | ✅ | — |
| 插入目标 | composer draft + input/textarea/contentEditable + sidebar terminal | 终端+文本框+contentEditable | — |
| Hold 模式 | ✅ | ✅ | — |
| 录音指示器 | ✅ (应用级状态条) | ✅ (浮动条) | — |
| 麦克风断开 | ✅ | ✅ | 活动音轨结束会丢弃未完成转写并提示；精确设备不可用时下次采集按既有回退规则处理 |
| 启动缓冲 | ✅（有界 Remote uplink 缓冲） | ✅ | 缓冲由 Remote uplink 持有，不额外保存完整客户端录音 |
| 转写分段空格 | ✅ | ✅ | 已支持非 CJK 字母/数字间空格；CJK 文字边缘和标点不机械插入空格 |
| **架构** | | | |
| 在线引擎运行 | Host 外的受管子进程；离线 unary 保持 Host 调用 | Worker 线程 | 执行模型不同 |
| 音频传输 | 在线用 authenticated Remote 分块 uplink；离线用完整 base64 PCM；loopback HTTP 仅保留 unary | Float32Array IPC | carrier 不同 |
| 状态管理 | DictationController class | React hooks + app store | 不同 |

## 迁移策略

DSH 与 orca 的实现仍有差异（Host 子进程 vs Worker、authenticated Remote vs IPC、设置偏好与模型资源的所有权不同）。OpenAI、用户模型导入、语言设置和真实 Web Gateway + native 模型链路已交付并验收。当前待验收项仅包括物理麦克风输入振幅与真实语音准确率：

1. **可选 Provider**：OpenAI Key 由 Host credentials 管理，用户模型经清单验证后复制到受管 generation；源目录保持不变
2. **验收闭环**：真实 Web Gateway carrier 与 native 模型已通过 WAV 测试；物理麦克风振幅和真实语音准确率仍待设备环境验收

### 命名与注册

- section id：`voice`（已有，保留）
- 导航标签：`Voice` / `语音`（已有）
- 注册方式：`ctx.slots.inject('settings.section', ...)`（已有）

### 架构决策

1. **保留 Host 操作并通过 authenticated `voice` Remote 调用**：可选的 `/voice/api` loopback HTTP adapter 仅作为同一操作层的旧传输，不作为客户端主通道
2. **流式转写复用 authenticated `voice` Remote 的双向流**：Gateway 已提供 `@Remote({ mode: 'stream' })`、Client uplink 与可取消 downlink；语音功能不新增 WebSocket、SSE 或并行的 HTTP 流协议
3. **设置持久化由浏览器本地偏好承担**：当前 voice store 直接持久化听写开关、模式、模型 ID 和麦克风设备 ID；这些偏好不属于 Host 设置，也不跨浏览器同步
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

当前 DSH 离线模型流程：
```
录音 → AudioWorkletNode（原生采样率）→ resampleToMono16k → base64 PCM → POST /voice/api/transcribe → 文本
```

当前 DSH 在线模型流程：
```
录音 → AudioWorklet → 分块重采样后的 16kHz mono PCM → `voice` Remote uplink → isolated sherpa OnlineRecognizer → partial transcript → final transcript
```

**文件变更**：

1. **修改** `@/packages/api/voice-controller/src/index.ts`
   - 增加 `@Remote({ mode: 'stream' })` 方法，读取 `this.ctx.invocation.uplink()` 中的 base64 PCM chunk
   - 按 Host Remote 取消 signal 结束流，并产出带类型的 partial/final transcript frame
   - 保留 `transcribe` unary 方法供设置页麦克风测试和离线模型使用

2. **修改** `@/packages/voice/voice/src/types.ts` 与 Voice runtime
   - 增加 chunk recognizer、streaming frame 与 cancellation 类型
   - 流式调用只接受模型目录标记为 streaming 的就绪模型；离线模型通过现有 unary API 工作

3. **修改** `@/packages/voice/voice-sherpa-onnx/src/engine.ts` 与 Provider 操作
   - 为 `OnlineRecognizer` 增加逐 chunk 的 `acceptWaveform`、ready decode 与 hypothesis 读取
   - 把在线 native decode 放入 isolated Node 子进程，避免阻塞 Host event loop，并允许取消终止进程
   - 每个流持有模型 generation lease；取消、模型删除及 Provider dispose 均等待 Worker 结束、recognizer 释放和 lease 回收

4. **修改** `@/packages/client/ui-voice-dictation/src/client/dictation.ts` 与 `dictation-controller.ts`
   - AudioWorklet 持续发布有界音频 chunk，不再为流式模型保存整段录音
   - 使用生成的 `voice` Remote stream handle 发送 PCM uplink 并消费 transcript downlink
   - 在线模型显示 partial hypothesis；正常结束后仅插入 final transcript，取消与流错误不插入未完成文本
   - 非流式模型继续使用当前“停止后 unary 转写”行为

5. **扩展现有** `DictationIndicator.tsx`
   - 应用级状态条在流式录音期间显示最新 partial hypothesis
   - 保留现有停止操作；转写完成后清除 partial 状态

**验收**：覆盖 Host/client stream uplink、逐项 PCM 解码、partial 更新与 final 插入、模型删除与 Provider dispose quiescence、取消不插入未完成文本、离线模型 unary 回归，以及真实 Web Gateway stream carrier。子进程源码入口和打包后的 plain Node worker 入口均需验证；真实模型准确率与物理麦克风输入仍单独验收。

### 阶段 6：任意目标插入

**目标**：将听写文本插入从仅 composer draft 扩展到任意聚焦元素。

**当前状态**：input、textarea、`contentEditable` 和 sidebar xterm 终端已交付并有独立单测；录音开始前保存选择，转写完成后恢复选择并派发 `input` 事件，终端通过 `dsh:voice-insert-text` 本地事件调用 `term.paste()`。

**参考**：`@/orca/src/renderer/src/components/dictation/dictation-insertion-target.ts`

**文件变更**：

1. [insertion-target.ts](../../../packages/client/ui-voice-dictation/src/client/insertion-target.ts)
   - `captureInsertionTarget()` — 捕获当前聚焦元素
   - 支持：HTMLInputElement / HTMLTextAreaElement / contentEditable / sidebar xterm terminal
   - `insertIntoTarget(target, text)` — 向目标插入文本

2. [dictation-controller.ts](../../../packages/client/ui-voice-dictation/src/client/dictation-controller.ts)
   - `start()` 时捕获插入目标
   - `stop()` 时向捕获的目标插入文本；受管 composer 仍通过会话输入 API 更新 draft

3. 转写分段空格已在 [final-segments.ts](../../../packages/client/ui-voice-dictation/src/client/final-segments.ts) 实现：按非 CJK 字母/数字和 CJK 边界处理分段空格，并保留已有空白；参考 orca 的 `dictation-final-segments.ts`。

### 阶段 7：OpenAI 云端转写（已交付）

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

### 阶段 8：用户自定义模型导入（已交付）

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

1. **流式转写架构差异大**：DSH 在线模型通过 authenticated Remote uplink 分块，子进程运行 native OnlineRecognizer；离线模型仍通过完整 PCM unary 转写。真实模型准确率和物理设备输入仍需单独验收。
2. **sherpa-onnx 模型扩展**：当前 DSH 已支持 transducer、paraformer、whisper、senseVoice 和 nemo-ctc 五种本地识别架构。继续增加模型仍需固定文件清单、架构配置、校验与真实推理验证；当前 `VoiceRecognizer.transcribe()` 仍接收完整 PCM。
3. **Host 推理隔离**：在线原生识别在可取消的子进程执行；offline unary 原生识别仍在 Host 同步运行，取消不能中断其 native call。
4. **设置持久化**：听写开关、模式、模型与麦克风选择保存在发起浏览器的 `localStorage`，不会同步到其他浏览器或 Host；设备权限仍由浏览器和操作系统管理。
5. **插入目标安全**：向任意聚焦元素插入文本需处理终端、contentEditable、input/textarea 的不同插入方式，以及大文本分块。
6. **OpenAI Key 存储**：Host credentials provider 拥有密钥存取与清除；客户端只得到配置状态，不接收密钥内容。
7. **模型下载兼容性**：目录支持固定归档与逐文件两种下载清单。当前十个模型使用逐文件清单和固定 `hf-mirror.com` revision；新增来源必须继续提供可验证的大小与 SHA-256，并通过真实下载和识别验收。
8. **转写空结果**：Chromium fake microphone 已通过 `AudioWorkletNode` 模块加载和非零音频帧断言，但这不能证明物理麦克风振幅或模型准确度；两者仍需单独验收。
