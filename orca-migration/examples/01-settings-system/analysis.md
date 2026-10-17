# Orca 配置系统分析模板

> 本文件用于记录对 Orca 配置系统的深度分析。当实际迁移时，填充具体内容。

---

## 1. 配置文件格式

### 1.1 文件位置

```
Orca 配置文件层次：
~/.orca/settings.json           # 全局配置
~/.orca/user/settings.json      # 用户配置
<project>/.orca/settings.json   # 项目配置
```

### 1.2 文件格式

```json
{
  "api_key": "sk-ant-...",
  "model_name": "claude-3-opus-20240229",
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": true,
  "timeout": 30,
  "api_key_model_discovery": true,
  "experimental_features": {
    "voice_input": false,
    "browser_automation": true
  }
}
```

### 1.3 配置项分类

| 分类 | 配置项 | 类型 | 默认值 | 说明 |
|------|--------|------|--------|------|
| **认证** | `api_key` | string | 无 | Anthropic API Key |
| **模型** | `model_name` | string | "claude-3-opus-20240229" | 默认模型 |
| **生成参数** | `temperature` | float | 0.7 | 温度参数 |
| | `max_tokens` | int | 4096 | 最大输出 Token |
| **行为** | `stream` | bool | true | 是否启用流式输出 |
| | `timeout` | int | 30 | 请求超时（秒） |
| **实验性** | `experimental_features` | object | {} | 实验性功能开关 |

---

## 2. 配置加载逻辑

### 2.1 加载顺序

```
1. 读取全局配置 (~/.orca/settings.json)
2. 读取用户配置 (~/.orca/user/settings.json)
3. 读取项目配置 (<project>/.orca/settings.json)
4. 按优先级合并：项目 > 用户 > 全局
```

### 2.2 合并策略

**深度合并 (Deep Merge)**：
```typescript
// 示例
const global = {
  api_key: "global-key",
  temperature: 0.7,
  experimental_features: {
    voice_input: false
  }
}

const project = {
  temperature: 0.9,
  experimental_features: {
    browser_automation: true
  }
}

// 合并结果
const merged = {
  api_key: "global-key",           // 来自 global
  temperature: 0.9,                // 被 project 覆盖
  experimental_features: {
    voice_input: false,            // 来自 global
    browser_automation: true       // 来自 project
  }
}
```

**数组字段处理**：
- Orca 中数组字段采用**覆盖策略**（不是追加）
- 例如：`allowed_models: ["model1", "model2"]` 会完全覆盖父级配置

---

## 3. 配置验证

### 3.1 必填项验证

```typescript
// Orca 的验证逻辑 (伪代码)
function validateConfig(config: Config): ValidationResult {
  const errors = []
  
  // api_key 是可选的（本地模式不需要）
  if (config.api_key && !isValidApiKey(config.api_key)) {
    errors.push("Invalid API key format")
  }
  
  // model_name 必须是支持的模型
  if (!SUPPORTED_MODELS.includes(config.model_name)) {
    errors.push(`Unknown model: ${config.model_name}`)
  }
  
  // temperature 范围检查
  if (config.temperature < 0 || config.temperature > 2) {
    errors.push("Temperature must be between 0 and 2")
  }
  
  return { valid: errors.length === 0, errors }
}
```

### 3.2 默认值填充

```typescript
// Orca 的默认值逻辑
const DEFAULT_CONFIG = {
  model_name: "claude-3-opus-20240229",
  temperature: 0.7,
  max_tokens: 4096,
  stream: true,
  timeout: 30,
  api_key_model_discovery: true,
  experimental_features: {}
}

function applyDefaults(config: Partial<Config>): Config {
  return { ...DEFAULT_CONFIG, ...config }
}
```

---

## 4. 热重载机制

### 4.1 文件监听

```typescript
// Orca 使用文件系统监听
import { watch } from 'fs'

class SettingsManager {
  watchConfigFile(path: string) {
    watch(path, (event, filename) => {
      if (event === 'change') {
        this.reloadConfig(path)
      }
    })
  }
  
  reloadConfig(path: string) {
    const newConfig = this.loadConfig(path)
    this.validateAndApply(newConfig)
    this.emitConfigChange(newConfig)
  }
}
```

### 4.2 变更通知

```typescript
// Orca 的事件总线
eventBus.on('config:changed', (newConfig) => {
  // 通知所有订阅者
  sessions.forEach(session => session.updateConfig(newConfig))
  ui.refreshSettingsPane()
})
```

---

## 5. 配置迁移工具

### 5.1 版本升级

```typescript
// Orca 的配置迁移逻辑
function migrateConfig(oldConfig: any, fromVersion: string): Config {
  if (fromVersion < "1.0.0") {
    // v0.x → v1.0 迁移
    oldConfig.model_name = oldConfig.model || "claude-3-opus-20240229"
    delete oldConfig.model
  }
  
  if (fromVersion < "2.0.0") {
    // v1.x → v2.0 迁移
    oldConfig.experimental_features = oldConfig.features || {}
    delete oldConfig.features
  }
  
  return oldConfig as Config
}
```

### 5.2 配置导入导出

```typescript
// Orca 支持配置的导入导出
function exportConfig(config: Config): string {
  return JSON.stringify(config, null, 2)
}

function importConfig(json: string): Config {
  const config = JSON.parse(json)
  return this.validateAndMigrate(config)
}
```

---

## 6. 关键代码位置

| 功能 | 文件路径 | 行号 | 说明 |
|------|----------|------|------|
| 配置类型定义 | `src/shared/global-settings-types.ts` | 全文 | TypeScript 类型定义 |
| 默认配置 | `src/shared/default-global-settings.ts` | 全文 | 默认值常量 |
| 配置加载器 | `src/main/settings/settings-manager.ts` | 50-120 | 主要加载逻辑 |
| 配置合并 | `src/main/settings/merge.ts` | 20-80 | 深度合并算法 |
| 配置验证 | `src/main/settings/validator.ts` | 全文 | 验证逻辑 |
| 热重载 | `src/main/settings/watcher.ts` | 全文 | 文件监听 |
| UI 界面 | `src/renderer/components/settings/` | 多个文件 | 设置界面组件 |

---

## 7. 设计亮点

### 7.1 简洁的平铺结构

Orca 的配置是平铺的，没有深层嵌套（除了 `experimental_features`）。这使得：
- 配置文件易读易写
- 合并逻辑简单
- 减少了类型嵌套的复杂度

### 7.2 三级配置的灵活性

全局/用户/项目三级配置允许：
- 全局设置团队统一的默认值
- 用户自定义个人偏好
- 项目覆盖特定配置

### 7.3 实验性功能开关

`experimental_features` 对象允许安全地测试新功能，而不影响稳定功能。

---

## 8. 已知问题

### 8.1 JSON 不支持注释

用户无法在配置文件中写注释，这在复杂配置时不便。

**可能的解决方案**：
- 改用 JSON5（支持注释）
- 改用 YAML
- 生成配置文档

### 8.2 配置错误提示不友好

当配置文件格式错误时，Orca 的错误信息较为简单，不指出具体哪个字段有问题。

### 8.3 大配置文件性能

当配置文件很大时（> 1MB），热重载会导致明显的延迟。

---

## 9. Harness 迁移建议

### 9.1 应该保留的设计

- ✅ 三级配置（全局/用户/项目）
- ✅ 深度合并策略
- ✅ 热重载机制
- ✅ 实验性功能开关

### 9.2 应该改进的地方

- 🔧 使用更严格的配置验证（JSON Schema）
- 🔧 改进错误提示（指出具体字段）
- 🔧 支持配置注释（JSON5 或 YAML）
- 🔧 配置项自动补全和文档生成

### 9.3 Harness 特有的需求

- ➕ 支持多个 LLM 提供商（不只是 Anthropic）
- ➕ Token 预算配置
- ➕ 缓存策略配置
- ➕ 抽象的存储后端配置

---

**分析完成日期**：YYYY-MM-DD  
**分析者**：[你的名字]
