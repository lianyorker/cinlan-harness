# Orca → Harness 配置系统映射关系

本文档定义 Orca 配置系统到 Harness 配置系统的精确映射关系。

---

## 1. 配置文件路径映射

| Orca | Harness | 说明 |
|------|---------|------|
| `~/.orca/settings.json` | `~/.harness/config.json` | 全局配置 |
| `~/.orca/user/settings.json` | `~/.harness/user.config.json` | 用户配置 |
| `<project>/.orca/settings.json` | `<project>/.harness/project.config.json` | 项目配置 |

**注**：Harness 也支持其他格式（YAML/TOML），但为了兼容性，推荐使用 JSON。

---

## 2. 配置项映射表

### 2.1 核心配置项

| Orca 配置项 | Harness 配置项 | 类型 | 默认值 | 映射说明 |
|------------|----------------|------|--------|----------|
| `api_key` | `llm.api_key` | string | 无 | Harness 嵌套在 `llm` 命名空间下 |
| `model_name` | `llm.default_model` | string | "claude-3-opus-20240229" | 名称改为更语义化 |
| `temperature` | `llm.temperature` | float | 0.7 | 直接映射 |
| `max_tokens` | `llm.max_output_tokens` | int | 4096 | 更明确的名称 |
| `stream` | `llm.enable_streaming` | bool | true | 更明确的名称 |
| `timeout` | `llm.request_timeout` | int | 30 | 嵌套在 `llm` 命名空间 |

**变化说明**：
- Harness 将 LLM 相关配置嵌套在 `llm` 对象下，结构更清晰
- 使用更明确的命名（`enable_streaming` 比 `stream` 更易理解）

---

### 2.2 实验性功能映射

| Orca 配置项 | Harness 配置项 | 映射说明 |
|------------|----------------|----------|
| `experimental_features.voice_input` | `features.voice_input` | 去掉 "experimental" 前缀 |
| `experimental_features.browser_automation` | `features.browser_automation` | 去掉 "experimental" 前缀 |
| `api_key_model_discovery` | `llm.model_discovery` | 移到 `llm` 命名空间 |

**变化说明**：
- Harness 的 `features` 不再区分"实验性"和"稳定"，统一管理
- 每个功能可以有自己的状态（`enabled`, `beta`, `deprecated`）

---

### 2.3 Orca 特有配置（不迁移）

以下 Orca 配置项在 Harness 中**不需要**：

| Orca 配置项 | 为什么不需要 |
|------------|--------------|
| `pty_buffer_size` | Harness 不使用伪终端 |
| `cli_path` | Harness 不依赖本地 CLI |
| `process_pool_size` | Harness 使用异步任务，不需要进程池 |

---

### 2.4 Harness 特有配置（新增）

以下配置项是 Harness 特有的，Orca 中不存在：

| Harness 配置项 | 类型 | 默认值 | 说明 |
|---------------|------|--------|------|
| `llm.provider` | string | "anthropic" | LLM 提供商（anthropic/openai/cohere） |
| `llm.api_endpoint` | string | "https://api.anthropic.com" | 自定义 API 端点 |
| `llm.token_budget.daily` | int | 100000 | 每日 Token 预算 |
| `llm.token_budget.per_session` | int | 10000 | 单会话 Token 预算 |
| `cache.strategy` | string | "memory" | 缓存策略（memory/redis/file） |
| `cache.ttl` | int | 3600 | 缓存过期时间（秒） |
| `storage.backend` | string | "file" | 存储后端（file/db/cloud） |

---

## 3. 配置结构对比

### 3.1 Orca 配置结构（平铺）

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

---

### 3.2 Harness 配置结构（嵌套）

```json
{
  "llm": {
    "provider": "anthropic",
    "api_key": "sk-ant-...",
    "api_endpoint": "https://api.anthropic.com",
    "default_model": "claude-3-opus-20240229",
    "temperature": 0.7,
    "max_output_tokens": 4096,
    "enable_streaming": true,
    "request_timeout": 30,
    "model_discovery": true,
    "token_budget": {
      "daily": 100000,
      "per_session": 10000
    }
  },
  "features": {
    "voice_input": false,
    "browser_automation": true
  },
  "cache": {
    "strategy": "memory",
    "ttl": 3600
  },
  "storage": {
    "backend": "file"
  }
}
```

**结构变化**：
- Orca：平铺结构，易读但不够模块化
- Harness：嵌套结构，更清晰的命名空间

---

## 4. 配置转换逻辑

### 4.1 Orca → Harness 转换

```python
def convert_orca_to_harness(orca_config: dict) -> dict:
    """将 Orca 配置转换为 Harness 配置"""
    harness_config = {
        "llm": {
            "provider": "anthropic",  # Orca 固定为 Anthropic
            "api_key": orca_config.get("api_key"),
            "default_model": orca_config.get("model_name", "claude-3-opus-20240229"),
            "temperature": orca_config.get("temperature", 0.7),
            "max_output_tokens": orca_config.get("max_tokens", 4096),
            "enable_streaming": orca_config.get("stream", True),
            "request_timeout": orca_config.get("timeout", 30),
            "model_discovery": orca_config.get("api_key_model_discovery", True),
        },
        "features": orca_config.get("experimental_features", {}),
    }
    
    # 移除 None 值
    return remove_none_values(harness_config)
```

---

### 4.2 Harness → Orca 转换（向后兼容）

```python
def convert_harness_to_orca(harness_config: dict) -> dict:
    """将 Harness 配置转换为 Orca 配置（用于兼容）"""
    llm = harness_config.get("llm", {})
    
    orca_config = {
        "api_key": llm.get("api_key"),
        "model_name": llm.get("default_model", "claude-3-opus-20240229"),
        "temperature": llm.get("temperature", 0.7),
        "max_tokens": llm.get("max_output_tokens", 4096),
        "stream": llm.get("enable_streaming", True),
        "timeout": llm.get("request_timeout", 30),
        "api_key_model_discovery": llm.get("model_discovery", True),
        "experimental_features": harness_config.get("features", {}),
    }
    
    return remove_none_values(orca_config)
```

---

## 5. 配置合并策略映射

### 5.1 Orca 的合并策略

```typescript
// Orca: 深度合并
function merge(base: Config, override: Config): Config {
  return deepMerge(base, override)
}

// 示例
const result = merge(
  { a: 1, b: { c: 2 } },
  { b: { d: 3 } }
)
// 结果: { a: 1, b: { c: 2, d: 3 } }
```

---

### 5.2 Harness 的合并策略

```python
# Harness: 相同的深度合并
def merge(base: dict, override: dict) -> dict:
    return deep_merge(base, override)

# 示例
result = merge(
    {"a": 1, "b": {"c": 2}},
    {"b": {"d": 3}}
)
# 结果: {"a": 1, "b": {"c": 2, "d": 3}}
```

**结论**：合并策略完全一致，无需额外处理。

---

## 6. 配置验证映射

### 6.1 Orca 的验证

```typescript
// Orca: 手写验证逻辑
function validate(config: Config): ValidationResult {
  if (config.temperature < 0 || config.temperature > 2) {
    return { valid: false, error: "Invalid temperature" }
  }
  return { valid: true }
}
```

---

### 6.2 Harness 的验证

```python
# Harness: JSON Schema 验证
HARNESS_CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "llm": {
            "type": "object",
            "properties": {
                "temperature": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2
                }
            }
        }
    }
}

def validate(config: dict) -> ValidationResult:
    jsonschema.validate(config, HARNESS_CONFIG_SCHEMA)
    return ValidationResult(valid=True)
```

**优势**：Harness 使用 JSON Schema，更声明式，易于维护和生成文档。

---

## 7. 热重载机制映射

### 7.1 Orca 的热重载

```typescript
// Orca: 文件系统监听
import { watch } from 'fs'

watch(configPath, (event) => {
  if (event === 'change') {
    reloadConfig()
  }
})
```

---

### 7.2 Harness 的热重载

```python
# Harness: 抽象的监听器
class ConfigWatcher:
    def __init__(self, loader: ConfigLoader):
        self.loader = loader
        self.observers = []
    
    def watch(self, path: str):
        # 可以是文件系统、数据库变更监听等
        observer = self.loader.create_observer(path)
        observer.on_change(self.reload)
```

**优势**：Harness 的热重载机制与存储后端解耦，支持多种来源。

---

## 8. UI 界面映射

### 8.1 Orca 设置界面组件

```
Orca Settings Panes:
├── GeneralPane.tsx          → Harness: GeneralSettings
├── AdvancedPane.tsx         → Harness: AdvancedSettings
├── ExperimentalPane.tsx     → Harness: FeaturesSettings
├── AccountsPane.tsx         → Harness: AccountSettings
└── ...
```

---

### 8.2 映射关系

| Orca UI 组件 | Harness UI 组件 | 说明 |
|-------------|----------------|------|
| `GeneralPane` | `GeneralSettings` | 基本设置 |
| `AdvancedPane` | `AdvancedSettings` | 高级设置 |
| `ExperimentalPane` | `FeaturesSettings` | 功能开关（去掉"实验性"） |
| `AccountsPane` | `AccountSettings` | 账户管理 |

**注**：UI 组件的实现技术栈可能不同（Orca 用 React，Harness 可能用其他框架），但功能和布局应保持一致。

---

## 9. 不兼容项处理

### 9.1 数组字段的合并

**问题**：Orca 的数组字段采用覆盖策略，Harness 是否保持一致？

**决定**：✅ 保持一致，使用覆盖策略

**理由**：确保行为一致性

---

### 9.2 未知配置项

**问题**：如果 Orca 配置中有 Harness 不认识的配置项，如何处理？

**决定**：⚠️ 记录警告，但不拒绝加载

**实现**：
```python
def convert_orca_to_harness(orca_config: dict) -> dict:
    known_keys = {"api_key", "model_name", ...}
    unknown_keys = set(orca_config.keys()) - known_keys
    
    if unknown_keys:
        logger.warning(f"Unknown Orca config keys: {unknown_keys}")
    
    # 继续转换已知的配置项
    return harness_config
```

---

### 9.3 配置项版本演进

**问题**：如果未来 Orca 添加新的配置项，Harness 如何跟进？

**决定**：🔄 定期同步 Orca 的配置 schema

**实现**：
- 在 `samples/` 目录下跟踪 Orca 的最新配置定义
- 每次 Orca 更新后，检查新增/变更的配置项
- 更新映射表和转换逻辑

---

## 10. 测试验证

### 10.1 映射正确性测试

```python
# 测试：Orca → Harness → Orca 往返转换
def test_round_trip_conversion():
    original_orca_config = load_orca_config("fixtures/valid_config.json")
    
    # Orca → Harness
    harness_config = convert_orca_to_harness(original_orca_config)
    
    # Harness → Orca
    converted_orca_config = convert_harness_to_orca(harness_config)
    
    # 应该与原始配置一致（忽略不支持的字段）
    assert_config_equivalent(original_orca_config, converted_orca_config)
```

---

### 10.2 行为一致性测试

```python
# 测试：相同配置，Orca 和 Harness 行为一致
def test_behavior_parity():
    orca_config = {"temperature": 0.9}
    harness_config = convert_orca_to_harness(orca_config)
    
    # 验证 Harness 使用正确的温度参数
    assert harness_config["llm"]["temperature"] == 0.9
```

---

## 11. 迁移工具

### 11.1 配置迁移脚本

```bash
# 一键迁移 Orca 配置到 Harness
harness migrate-config --from ~/.orca/settings.json --to ~/.harness/config.json
```

**实现**：
```python
# harness/cli/migrate.py
def migrate_config(orca_path: str, harness_path: str):
    orca_config = load_json(orca_path)
    harness_config = convert_orca_to_harness(orca_config)
    save_json(harness_path, harness_config)
    print(f"✓ Migrated {orca_path} → {harness_path}")
```

---

### 11.2 配置兼容模式

```python
# Harness 可以直接读取 Orca 配置（自动转换）
harness_config = ConfigLoader().load("~/.orca/settings.json", auto_convert=True)
```

---

**最后更新**：2026-10-10  
**维护者**：迁移团队
