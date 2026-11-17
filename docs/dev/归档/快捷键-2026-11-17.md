# 快捷键（Shortcuts）迁移计划

## 1. 现状对比

### 1.1 Orca 的快捷键实现

Orca 有完整的快捷键管理系统：

**前端 UI 组件：**
- `ShortcutsPane.tsx` — 快捷键设置面板
- `ShortcutCommandBlock.tsx` — 单个快捷键命令块
- `ShortcutRecorderButton.tsx` — 快捷键录制按钮
- `KeybindingsFileActions.tsx` — 快捷键文件操作（编辑/打开/重载）

**核心功能：**
1. **快捷键定义** — 预定义的命令列表，每个命令有：
   - 命令 ID
   - 显示名称
   - 默认快捷键
   - 可选的自定义覆盖
2. **快捷键录制** — 点击录制按钮后捕获键盘输入
3. **冲突检测** — 检测快捷键冲突
4. **搜索过滤** — 按命令名称搜索
5. **文件编辑** — 打开 `keybindings.json` 文件编辑快捷键
6. **重载** — 重新加载快捷键文件

**设置项：**
- `keybindings.json` 文件 — 用户自定义快捷键覆盖
- 快捷键快照（`keybindingSnapshot`）— 当前生效的快捷键

### 1.2 DSH 的快捷键现状

DSH 没有全局快捷键管理系统：

**已有的局部快捷键：**
- `ui-conversation/src/client/input/editor/keymap.ts` — Composer 编辑器快捷键
  - Enter 提交、Shift+Enter 换行、箭头导航、Escape 关闭、Tab 补全
  - 硬编码在 Lexical 编辑器命令层
  - 无用户可配置性
- `ui-better-sidebar/src/client/TextEditor.tsx` — CodeMirror 编辑器快捷键
  - CodeMirror keymap 扩展
  - 硬编码
- `ui-voice-dictation` — 语音听写快捷键
  - 硬编码

**没有：**
- ❌ 全局快捷键管理系统
- ❌ 快捷键设置页面
- ❌ 快捷键录制
- ❌ 冲突检测
- ❌ 快捷键文件编辑
- ❌ 用户可配置的快捷键覆盖

### 1.3 差距分析

| 能力 | Orca | DSH | 差距 |
|------|------|-----|------|
| 全局快捷键管理 | ✅ | ❌ | 需新建 |
| 快捷键设置页面 | ✅ | ❌ | 需迁移 |
| 快捷键录制 | ✅ | ❌ | 需迁移 |
| 冲突检测 | ✅ | ❌ | 需迁移 |
| 搜索过滤 | ✅ | ❌ | 需迁移 |
| 文件编辑 | ✅ | ❌ | 需迁移 |
| 局部快捷键 | ✅ | ✅ | DSH 硬编码 |
| 用户可配置 | ✅ | ❌ | 需新建 |

## 2. 迁移目标

1. 建立全局快捷键管理系统
2. 创建快捷键设置页面
3. 实现快捷键录制和冲突检测
4. 实现用户可配置的快捷键覆盖
5. 将现有硬编码快捷键纳入管理系统

## 3. 迁移方案

### 3.1 新建 `ui-keybindings` 客户端包

```
packages/client/ui-keybindings/
├── src/
│   └── client/
│       ├── index.ts                    # 插件入口
│       ├── KeybindingsSection.tsx       # 快捷键设置页面
│       ├── KeybindingsCommandBlock.tsx  # 单个命令块
│       ├── KeybindingsRecorder.tsx     # 快捷键录制组件
│       ├── keybindings-registry.ts     # 快捷键注册表
│       ├── keybindings-store.ts         # 快捷键状态管理
│       ├── keybindings-conflict.ts     # 冲突检测
│       ├── locales.ts                   # 中英文本地化
│       └── keybindings-types.ts        # 类型定义
├── tests/
│   └── apply.client.spec.ts
├── package.json
└── tsconfig.json
```

### 3.2 快捷键注册表

**核心数据结构：**

```typescript
interface KeybindingDefinition {
  id: string
  label: string
  category: string
  defaultBinding: KeyBinding | null
  description?: string
}

interface KeyBinding {
  key: string
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
}

interface KeybindingOverride {
  commandId: string
  binding: KeyBinding | null  // null = unbind
}
```

**注册 API：**

```typescript
// 其他插件注册快捷键命令
ctx.slots.inject('keybindings.command', () => ctx.slots.register({
  name: 'keybindings.command',
  id: 'conversation.submit',
  label: () => t('submitConversation'),
  category: 'conversation',
  defaultBinding: { key: 'Enter', modifiers: {} },
}))
```

### 3.3 快捷键设置页面

注册 `settings.section` 插槽：

```typescript
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'keybindings',
  order: 95,  // 在 floating-workspace (90) 之后
  label: () => t('nav'),
  locale: NS,
  inject: () => injected,
}, KeybindingsSection))
```

**页面结构：**
1. 搜索框
2. 按类别分组的命令列表
3. 每个命令显示：名称、当前快捷键、录制按钮
4. 冲突提示
5. "编辑 keybindings.json" 按钮
6. "重载" 按钮

### 3.4 快捷键录制

```typescript
function KeybindingsRecorder({ onRecord, onCancel }: Props): ReactNode {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      const binding = parseKeyEvent(event)
      onRecord(binding)
      setRecording(false)
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [recording])

  return <button onClick={() => setRecording(true)}>
    {recording ? 'Press keys...' : 'Record'}
  </button>
}
```

### 3.5 冲突检测

```typescript
function detectConflicts(overrides: KeybindingOverride[]): Map<string, string[]> {
  const bindingToCommands = new Map<string, string[]>()
  for (const override of overrides) {
    if (override.binding === null) continue
    const key = serializeBinding(override.binding)
    const commands = bindingToCommands.get(key) ?? []
    commands.push(override.commandId)
    bindingToCommands.set(key, commands)
  }
  const conflicts = new Map<string, string[]>()
  for (const [key, commands] of bindingToCommands) {
    if (commands.length > 1) conflicts.set(key, commands)
  }
  return conflicts
}
```

### 3.6 快捷键文件

用户自定义快捷键存储在 `keybindings.json` 文件中：

```json
[
  { "command": "conversation.submit", "key": "enter" },
  { "command": "conversation.newLine", "key": "shift+enter" },
  { "command": "conversation.cancel", "key": "escape" }
]
```

### 3.7 现有快捷键纳入管理

将现有硬编码快捷键注册到快捷键系统：

**Conversation 编辑器：**
- `conversation.submit` — Enter（可配置）
- `conversation.newLine` — Shift+Enter
- `conversation.navigateUp` — ArrowUp
- `conversation.navigateDown` — ArrowDown
- `conversation.dismissPopup` — Escape
- `conversation.complete` — Tab

**TextEditor：**
- `editor.save` — Ctrl+S
- `editor.find` — Ctrl+F
- `editor.replace` — Ctrl+H

**Voice Dictation：**
- `voice.toggle` — 可配置

### 3.8 快捷键分发

快捷键系统需要一个分发层，将快捷键事件路由到注册的命令：

```typescript
// 全局快捷键监听器
window.addEventListener('keydown', (event) => {
  const binding = parseKeyEvent(event)
  const command = keybindingsStore.findCommand(binding)
  if (command) {
    event.preventDefault()
    command.execute()
  }
})
```

**注意：** 编辑器内的快捷键（如 Lexical、CodeMirror）应继续使用各自的命令系统，全局快捷键系统只管理编辑器外的快捷键。

## 4. 实施阶段

### 阶段 1：快捷键注册表和存储（2-3 天）
- 创建 `ui-keybindings` 包
- 实现快捷键注册表
- 实现快捷键文件读写
- 实现快捷键状态管理
- 添加设置插槽注册

### 阶段 2：设置页面 UI（2-3 天）
- 实现 KeybindingsSection
- 实现 KeybindingsCommandBlock
- 实现搜索过滤
- 实现按类别分组
- 添加本地化文本

### 阶段 3：快捷键录制（1-2 天）
- 实现 KeybindingsRecorder
- 实现键盘事件解析
- 实现录制状态管理

### 阶段 4：冲突检测（1 天）
- 实现冲突检测逻辑
- 实现冲突 UI 提示

### 阶段 5：现有快捷键注册（2-3 天）
- 将 conversation keymap 注册到系统
- 将 editor keymap 注册到系统
- 将 voice dictation 快捷键注册到系统
- 实现快捷键分发

### 阶段 6：文件编辑和重载（1-2 天）
- 实现 keybindings.json 文件编辑
- 实现快捷键重载
- 实现文件操作按钮

### 阶段 7：测试和集成（1-2 天）
- 编写单元测试
- 集成验证
- 端到端测试

## 5. 依赖项

**前端：**
- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-client-ui-primitives` — UI 基础组件

## 6. 风险和注意事项

1. **编辑器快捷键**：Lexical 和 CodeMirror 有各自的快捷键系统，全局系统不应干扰编辑器内的快捷键处理。
2. **IME 兼容**：快捷键录制需要处理 IME 组合状态，避免在组合过程中捕获按键。
3. **跨平台**：Mac 使用 `meta` 键，Windows/Linux 使用 `ctrl` 键，需要统一处理。
4. **性能**：全局快捷键监听器需要高效，避免影响输入响应。
5. **向后兼容**：现有硬编码快捷键在纳入管理系统后应保持默认行为不变。

## 7. 优先级评估

**迁移优先级：中**

理由：
- 快捷键管理是体验优化功能，不影响核心工作流
- DSH 现有快捷键硬编码在局部组件中，功能正常但不可配置
- 全局快捷键管理系统是一个较大的新功能，工作量较大
- 可在所有核心功能迁移完成后进行

**建议迁移顺序：最后迁移。工作量最大，依赖最少。**
