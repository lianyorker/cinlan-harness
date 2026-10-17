# Orca → Harness 迁移陷阱与解决方案

本文档记录在迁移过程中已经踩过的坑、常见误区和推荐的解决方案。

---

## 分类索引

- [概念理解陷阱](#概念理解陷阱)
- [技术实现陷阱](#技术实现陷阱)
- [测试验证陷阱](#测试验证陷阱)
- [性能与资源陷阱](#性能与资源陷阱)
- [安全陷阱](#安全陷阱)
- [文档与沟通陷阱](#文档与沟通陷阱)

---

## 概念理解陷阱

### ❌ 陷阱 1：把 Orca 的进程管理直接映射到 Harness

**错误做法**：
```python
# 错误：试图用 subprocess 来模拟 Orca 的 Cell
import subprocess

class HarnessCell:
    def __init__(self):
        self.process = subprocess.Popen(["curl", "https://api.anthropic.com/..."])
    
    def kill(self):
        self.process.kill()  # 这不是 LLM 的正确管理方式！
```

**为什么错误**：
- Orca 管理的是**本地 CLI 进程**（stdin/stdout），Harness 管理的是 **HTTP API 请求**（异步）
- `process.kill()` 能立即终止进程，但 HTTP 请求需要通过 `AbortController` 优雅取消
- Orca 的 pty 是阻塞式的，LLM API 是流式异步的

**正确做法**：
```python
# 正确：用 AbortController 和异步流管理
import asyncio
import httpx

class HarnessSession:
    def __init__(self):
        self.abort_controller = asyncio.Event()
        self.stream_task = None
    
    async def start(self):
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", "https://api.anthropic.com/...", 
                                     timeout=None) as response:
                async for chunk in response.aiter_bytes():
                    if self.abort_controller.is_set():
                        break
                    yield chunk
    
    def abort(self):
        self.abort_controller.set()  # 优雅取消
```

**参考**：[GLOSSARY.md - 核心概念对照](./GLOSSARY.md#核心概念)

---

### ❌ 陷阱 2：认为"迁移"就是"翻译代码"

**错误理解**：
> "我只需要把 Orca 的 TypeScript 代码翻译成 Python/Go 就行了"

**为什么错误**：
- Orca 的很多设计是为**本地 CLI**优化的（例如文件系统缓存、进程池）
- Harness 的很多设计是为 **LLM API** 优化的（例如 Token 预算、上下文窗口管理）
- 直接翻译会导致架构不匹配，性能问题，甚至功能缺失

**正确理解**：
> "迁移 = 提取 Orca 的**契约和设计理念** → 用 Harness 的**原生机制**重新实现"

**实践建议**：
1. 先理解 Orca 该模块的**目标**（它要解决什么问题？）
2. 再提取**接口和数据结构**（契约是什么？）
3. 最后用 Harness 的原生机制实现（怎么用 Harness 解决同样的问题？）

**参考**：[全局系统架构提示词.md - 核心原则](./全局系统架构提示词.md#核心原则)

---

### ❌ 陷阱 3：忽略 Orca 和 Harness 的"缺失概念"

**场景 1：Orca 有但 Harness 不需要的概念**
- Orca 的 `pty` (伪终端) → Harness 不需要，直接用流式 HTTP
- Orca 的 `Bun Runtime` → Harness 用原生运行时

**错误做法**：强行在 Harness 里实现 pty 模拟层

**正确做法**：识别这是"实现细节"，不是"核心契约"，直接跳过

---

**场景 2：Harness 有但 Orca 不需要的概念**
- Harness 的 `Context Window` → Orca 本地运行无限制
- Harness 的 `Token Budget` → Orca 不需要控制成本

**错误做法**：认为 Orca 的设计已经涵盖了一切，不添加这些概念

**正确做法**：在迁移时**补充** Harness 特有的概念，不要盲目跟随 Orca

**参考**：[GLOSSARY.md - Harness 特有概念](./GLOSSARY.md#harness-特有概念orca-不存在)

---

## 技术实现陷阱

### ❌ 陷阱 4：修改 Harness 的 core/ 或 engine/ 目录

**错误做法**：
```
harness/
├── core/
│   ├── context.py
│   └── config.py  # ❌ 直接修改核心配置加载器以支持 orcasettings
```

**为什么错误**：
- 违反"底座优先"原则
- 导致无法升级 Harness 官方版本
- 破坏 Harness 的原生设计

**正确做法**：
```
harness/
├── core/              # 官方代码，不修改
│   └── config.py
├── extensions/        # 扩展目录
│   └── settings/
│       ├── orca_adapter.py     # ✅ 适配器，加载 orcasettings 并转换为 Harness 格式
│       └── loader.py           # ✅ 扩展配置加载器
```

**实践建议**：
- 所有 Orca 相关代码必须放在 `extensions/` 或 `plugins/` 目录
- 如果需要修改核心行为，使用 **Hook 机制** 或 **事件总线**
- 如果 Harness 缺少必要的扩展点，先向官方提 Issue

**参考**：[全局系统架构提示词.md - 底座优先](./全局系统架构提示词.md#核心原则)

---

### ❌ 陷阱 5：过早优化或过度设计

**错误做法**：
```python
# 第一次迁移配置系统就设计了复杂的插件架构
class ConfigPluginRegistry:
    def register_loader(self, loader_type, loader_class, priority, metadata):
        # 100 行代码...
```

**为什么错误**：
- 当前只需要支持 Orca 的配置格式，不需要"通用插件系统"
- 过度设计增加复杂度，延缓迁移进度
- 未来需求可能和当前设计完全不同

**正确做法**：
```python
# 第一次迁移：最简单的实现
class OrcaConfigLoader:
    def load(self, path: str) -> dict:
        with open(path) as f:
            return json.load(f)  # 就这么简单

# 未来如果需要支持更多格式，再重构
```

**实践建议**：
- 遵循 KISS 原则（Keep It Simple, Stupid）
- 每次只解决当前的问题，不为"未来可能需要"设计
- 等到真正需要扩展时，再重构

**参考**：[全局系统架构提示词.md - 渐进式隔离](./全局系统架构提示词.md#核心原则)

---

### ❌ 陷阱 6：跳过 Mock 和隔离测试

**错误做法**：
```python
# 迁移会话管理，但依赖配置系统、中继层、UI 层全部完成才能测试
class SessionManager:
    def __init__(self):
        self.config = ConfigLoader()        # 依赖配置系统
        self.relay = RelayClient()          # 依赖中继层
        self.ui = TerminalView()            # 依赖 UI 层
    
    def create_session(self):
        # 无法在配置、中继、UI 未完成时测试
        pass
```

**为什么错误**：
- 导致迁移任务之间强耦合，无法并行
- 某个依赖模块延期会阻塞所有后续模块
- 集成测试失败时难以定位问题

**正确做法**：
```python
# 使用依赖注入 + Mock
class SessionManager:
    def __init__(self, config_loader, relay_client, ui_view):
        self.config = config_loader
        self.relay = relay_client
        self.ui = ui_view
    
    def create_session(self):
        pass

# 单元测试：用 Mock 隔离依赖
def test_create_session():
    mock_config = MockConfigLoader()
    mock_relay = MockRelayClient()
    mock_ui = MockUI()
    
    manager = SessionManager(mock_config, mock_relay, mock_ui)
    manager.create_session()  # 可以独立测试
```

**实践建议**：
- 每个子系统必须能够在 Mock 环境下独立测试
- 提供内存版本的依赖（例如 `InMemoryConfigLoader`）
- 集成测试在所有子系统完成后再做

**参考**：[子系统级迁移提示词.md - 渐进隔离](./子系统级迁移提示词.md#具体要求)

---

## 测试验证陷阱

### ❌ 陷阱 7：测试只覆盖"正常流程"

**错误做法**：
```python
# 只测试配置文件存在且格式正确的情况
def test_load_config():
    config = load_orca_config("valid_config.json")
    assert config["api_key"] == "test-key"
```

**为什么错误**：
- 生产环境中配置文件可能损坏、缺失、权限不足
- Orca 可能有特殊的容错逻辑（例如自动修复、默认值回退）
- 未测试的边界情况会在生产中暴露

**正确做法**：
```python
# 测试边界情况和错误处理
def test_load_config_missing_file():
    with pytest.raises(FileNotFoundError):
        load_orca_config("nonexistent.json")

def test_load_config_invalid_json():
    with pytest.raises(JSONDecodeError):
        load_orca_config("invalid.json")

def test_load_config_missing_required_field():
    config = load_orca_config("incomplete.json")
    assert config.get("api_key") is None  # 返回 None 而不是崩溃

def test_load_config_with_default_values():
    config = load_orca_config("minimal.json")
    assert config["timeout"] == 30  # 使用默认值
```

**实践建议**：
- 参考 Orca 的源码，找出它的错误处理逻辑
- 测试"文件不存在、格式错误、字段缺失、权限不足"等边界情况
- 验证 Harness 的行为与 Orca **完全一致**

**参考**：[单点功能迁移提示词.md - 边界测试](./单点功能迁移提示词.md#具体要求)

---

### ❌ 陷阱 8：声称"迁移完成"但没有运行测试

**错误场景**：
> "我已经把 Orca 的配置系统代码翻译成 Python 了，迁移完成！"

**实际情况**：
- 代码能编译通过，但未运行
- 没有单元测试
- 没有集成测试
- 没有与 Orca 的行为对比

**正确的完成标准**：
- [ ] 单元测试通过（覆盖率 > 80%）
- [ ] 集成测试通过
- [ ] 行为对比测试通过（相同输入，Harness 的输出与 Orca 一致）
- [ ] 文档完成（接口文档 + 使用示例）

**实践建议**：
- 参考 [PROGRESS.md](./PROGRESS.md) 中的"完成标准"
- 在 `examples/` 目录下提供可运行的测试
- 提交前运行完整的测试套件

**参考**：[README.md - 验收标准](./README.md#验收标准)

---

## 性能与资源陷阱

### ❌ 陷阱 9：忽略 LLM API 的 Token 成本

**错误做法**：
```python
# 频繁调用 LLM API 而不考虑成本
for file in all_files:
    response = llm_client.complete(f"Analyze {file}")  # 可能产生巨额费用！
```

**为什么错误**：
- Orca 本地运行，调用次数不影响成本
- Harness 使用 LLM API，每次调用都消耗 Token（花钱）
- 未做优化的迁移可能导致成本失控

**正确做法**：
```python
# 批量处理 + 缓存 + Token 预算控制
cached_results = load_cache()
remaining_files = [f for f in all_files if f not in cached_results]

if len(remaining_files) > 0:
    batch_prompt = "Analyze these files:\n" + "\n".join(remaining_files)
    response = llm_client.complete(batch_prompt, max_tokens=1000)  # 限制输出
    save_cache(response)
```

**实践建议**：
- 添加 Harness 特有的 `Token Budget` 管理
- 实现请求缓存和去重
- 对 LLM 调用进行性能测试，估算成本

**参考**：[GLOSSARY.md - Harness 特有概念](./GLOSSARY.md#harness-特有概念orca-不存在)

---

### ❌ 陷阱 10：未考虑流式输出的背压 (Backpressure)

**错误做法**：
```python
# 流式输出直接打印，不考虑消费速度
async for chunk in llm_stream:
    print(chunk)  # 如果终端渲染慢，会导致内存堆积
```

**为什么错误**：
- Orca 的 stdout 是管道，有操作系统级别的背压
- Harness 的流式输出需要手动管理缓冲区
- 未处理背压会导致内存溢出或丢失数据

**正确做法**：
```python
# 使用队列 + 背压控制
import asyncio

queue = asyncio.Queue(maxsize=100)  # 限制队列大小

async def producer():
    async for chunk in llm_stream:
        await queue.put(chunk)  # 如果队列满，自动等待

async def consumer():
    while True:
        chunk = await queue.get()
        render_to_terminal(chunk)  # 按终端速度消费
```

**实践建议**：
- 使用异步队列或流控制库（例如 `asyncio.Queue`）
- 测试大量输出场景（例如 10MB 的日志）
- 监控内存使用，确保不会 OOM

---

## 安全陷阱

### ❌ 陷阱 11：复制 Orca 的加密代码但不理解原理

**错误做法**：
```python
# 直接复制 Orca 的加密代码
def encrypt(data, key):
    # 复制粘贴 100 行加密逻辑...
    pass
```

**为什么错误**：
- 加密代码的细微错误会导致严重的安全问题
- Orca 的加密可能依赖特定的库版本或环境
- 不理解原理就无法审计和维护

**正确做法**：
1. **提取协议规范**：写下 Orca 使用的加密算法、密钥长度、IV 生成方式等
2. **使用成熟库**：用 Harness 生态的成熟加密库重写（例如 `cryptography`, `NaCl`）
3. **安全审计**：请密码学专家审计，或使用自动化工具（例如 `bandit`）
4. **互操作测试**：确保 Harness 加密的数据，Orca 能解密（反之亦然）

**实践建议**：
- 在 `samples/` 目录下记录 Orca 的加密规范
- 编写加密/解密的互操作测试
- 不要自己发明加密算法或修改标准算法

**参考**：[ROADMAP.md - P1.3 中继与 E2EE 通信层](./ROADMAP.md#3-中继与-e2ee-通信层)

---

### ❌ 陷阱 12：在日志或错误信息中泄漏敏感数据

**错误做法**：
```python
# 记录完整的配置对象
logger.info(f"Loaded config: {config}")  # ❌ 可能包含 API Key
```

**为什么错误**：
- 日志文件可能被第三方访问
- 错误信息可能被发送到错误追踪服务
- 配置中可能包含 API Key、密码、Token 等敏感数据

**正确做法**：
```python
# 脱敏后再记录
def sanitize_config(config):
    safe_config = config.copy()
    if "api_key" in safe_config:
        safe_config["api_key"] = "***REDACTED***"
    return safe_config

logger.info(f"Loaded config: {sanitize_config(config)}")  # ✅ 安全
```

**实践建议**：
- 使用结构化日志（例如 `structlog`）并配置脱敏规则
- 在错误处理中避免直接打印异常详情
- 定期审计日志文件，检查是否有敏感数据泄漏

---

## 文档与沟通陷阱

### ❌ 陷阱 13：认为"代码即文档"

**错误理解**：
> "我的代码写得很清楚，不需要额外的文档"

**为什么错误**：
- 迁移涉及概念翻译，代码本身无法说明"为什么这样映射"
- 新成员加入时，需要快速理解迁移的上下文
- 6 个月后你自己也会忘记当时的设计决策

**正确做法**：
每个子系统迁移完成后，在 `examples/` 目录下创建案例文档：
```
examples/01-settings-system/
├── analysis.md          # 为什么 Orca 的配置系统设计成这样？
├── mapping.md           # Orca 的配置项如何映射到 Harness？
├── implementation.md    # Harness 的实现细节和权衡
└── tests/               # 可运行的测试用例
```

**实践建议**：
- 参考 `examples/` 目录的结构模板
- 文档中包含"为什么"和"权衡"，不仅仅是"怎么做"
- 定期回顾文档，确保与代码同步

**参考**：[README.md - 目录结构](./README.md#目录结构)

---

### ❌ 陷阱 14：迁移过程中不更新 PROGRESS.md

**错误做法**：
- 迁移了 3 个子系统，但 `PROGRESS.md` 仍然显示"0/11 完成"
- 遇到问题后放弃，没有记录阻塞原因

**为什么错误**：
- 团队其他成员不知道当前进度
- 重复踩同样的坑
- 项目停滞后无法恢复

**正确做法**：
- 每完成一个子任务，立即更新 `PROGRESS.md`
- 遇到阻塞，记录到 `PITFALLS.md`（就是本文档）
- 每周生成进度报告，同步给相关方

**实践建议**：
- 将"更新 PROGRESS.md"作为完成定义的一部分
- 使用脚本自动生成进度统计
- 定期开会回顾进度和问题

**参考**：[PROGRESS.md](./PROGRESS.md)

---

## 通用最佳实践

### ✅ 黄金法则 1：先理解，再动手
- 花 30% 时间阅读 Orca 代码和文档
- 花 20% 时间设计 Harness 的实现方案
- 花 50% 时间编码和测试

### ✅ 黄金法则 2：小步快跑，频繁验证
- 每实现一个小功能，立即写测试
- 不要一次迁移太多代码
- 频繁运行测试套件

### ✅ 黄金法则 3：记录决策和权衡
- 在代码注释中解释"为什么这样做"
- 在文档中记录"考虑过的其他方案"
- 在 `PITFALLS.md` 中记录踩过的坑

### ✅ 黄金法则 4：寻求反馈
- 代码审查时，邀请熟悉 Orca 或 Harness 的人
- 遇到困难时，在团队中讨论
- 定期向 Harness 官方社区反馈扩展点需求

---

**最后更新**：2026-10-10  
**维护者**：迁移团队

**如何贡献**：
如果你在迁移过程中踩到了新的坑，请：
1. 在本文档中添加新的陷阱条目
2. 说明错误做法、为什么错误、正确做法
3. 提供代码示例或参考链接
4. 提交 PR 或直接更新
