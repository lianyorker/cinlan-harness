# Orca → Harness 测试策略

本文档定义迁移过程中的测试方法、验收标准和质量保证流程。

---

## 测试金字塔

```
           ┌─────────────────┐
           │  E2E 测试 (5%)  │  完整系统流程
           ├─────────────────┤
          │  集成测试 (15%)   │  子系统间交互
         ├──────────────────┤
        │   行为对比 (30%)    │  Orca vs Harness
       ├────────────────────┤
      │   单元测试 (50%)      │  函数/类级别
     └──────────────────────┘
```

**原则**：
- 单元测试最多，集成测试适中，E2E 测试最少
- 行为对比测试是迁移项目特有的，确保 Harness 行为与 Orca 一致
- 每层测试都有明确的目标和范围

---

## 测试类型详解

### 1. 单元测试 (Unit Tests)

**目标**：验证单个函数/类的逻辑正确性

**范围**：
- 单个函数的输入输出
- 单个类的状态转换
- 边界条件和错误处理

**工具**：
- Python: `pytest`, `unittest`
- Go: `testing` package
- JavaScript: `jest`, `vitest`

**示例**：
```python
# test_config_loader.py
import pytest
from harness.extensions.settings import OrcaConfigLoader

def test_load_valid_config():
    """测试加载有效的 Orca 配置文件"""
    loader = OrcaConfigLoader()
    config = loader.load("fixtures/valid_config.json")
    
    assert config["api_key"] == "test-key"
    assert config["model_name"] == "claude-3-opus"
    assert config["temperature"] == 0.7

def test_load_missing_file():
    """测试加载不存在的文件"""
    loader = OrcaConfigLoader()
    
    with pytest.raises(FileNotFoundError):
        loader.load("nonexistent.json")

def test_load_invalid_json():
    """测试加载格式错误的 JSON"""
    loader = OrcaConfigLoader()
    
    with pytest.raises(json.JSONDecodeError):
        loader.load("fixtures/invalid.json")

def test_load_with_default_values():
    """测试缺失字段时使用默认值"""
    loader = OrcaConfigLoader()
    config = loader.load("fixtures/minimal.json")
    
    assert config["timeout"] == 30  # 默认值
    assert config["stream"] is True  # 默认值
```

**覆盖率要求**：
- 核心功能模块 > 80%
- 工具/辅助模块 > 60%
- UI 层 > 40%（UI 测试主要在集成层）

---

### 2. 行为对比测试 (Behavior Comparison Tests)

**目标**：验证 Harness 的行为与 Orca 完全一致

**范围**：
- 相同输入，两者输出是否一致
- 相同配置，两者行为是否一致
- 边界情况处理是否一致

**方法**：
1. 在测试环境中同时运行 Orca 和 Harness
2. 提供相同的输入
3. 比较输出结果

**示例**：
```python
# test_behavior_parity.py
import subprocess
import json

def test_config_loading_parity():
    """验证 Orca 和 Harness 加载相同配置的行为一致"""
    config_path = "fixtures/test_config.json"
    
    # 运行 Orca
    orca_result = subprocess.run(
        ["orca", "config", "show", config_path],
        capture_output=True,
        text=True
    )
    orca_config = json.loads(orca_result.stdout)
    
    # 运行 Harness
    from harness.extensions.settings import OrcaConfigLoader
    loader = OrcaConfigLoader()
    harness_config = loader.load(config_path)
    
    # 比较结果
    assert orca_config == harness_config, "配置加载结果不一致"

def test_session_lifecycle_parity():
    """验证会话生命周期行为一致"""
    # Orca: start -> pause -> resume -> stop
    orca_states = run_orca_session_test()
    
    # Harness: create -> suspend -> resume -> terminate
    harness_states = run_harness_session_test()
    
    # 映射状态名称后比较
    assert normalize_states(orca_states) == normalize_states(harness_states)
```

**关键点**：
- 不比较实现细节，只比较外部可观察行为
- 对于性能差异（Orca 可能更快），只验证功能正确性
- 记录无法完全一致的场景（例如 Orca 的某些内部状态）

---

### 3. 集成测试 (Integration Tests)

**目标**：验证多个子系统协同工作

**范围**：
- 配置系统 + 会话管理
- 会话管理 + 任务调度
- 中继层 + 移动端协议

**工具**：
- Docker Compose：搭建多组件测试环境
- Mock Server：模拟外部依赖（例如 LLM API）

**示例**：
```python
# test_session_integration.py
import pytest
from harness.extensions.settings import ConfigLoader
from harness.extensions.session import SessionManager

@pytest.fixture
def test_environment():
    """搭建测试环境"""
    # 启动 Mock LLM API Server
    mock_server = MockLLMServer()
    mock_server.start()
    
    # 加载测试配置
    config = ConfigLoader().load("fixtures/integration_config.json")
    
    yield config, mock_server
    
    # 清理
    mock_server.stop()

def test_session_with_config(test_environment):
    """测试配置系统和会话管理的集成"""
    config, mock_server = test_environment
    
    # 使用配置创建会话
    manager = SessionManager(config)
    session = manager.create_session()
    
    # 验证会话使用了正确的配置
    assert session.model_name == config["model_name"]
    assert session.api_endpoint == mock_server.url
    
    # 发送请求
    response = session.send("Hello")
    
    # 验证请求正确路由到 Mock Server
    assert mock_server.last_request.headers["Authorization"] == f"Bearer {config['api_key']}"
    assert response.status == "success"
```

**覆盖场景**：
- [ ] 配置加载 → 会话创建 → 任务执行
- [ ] 会话暂停 → 配置热重载 → 会话恢复
- [ ] 设备配对 → 加密通信 → 消息同步
- [ ] 文件变更 → Git 状态更新 → UI 刷新

---

### 4. 端到端测试 (E2E Tests)

**目标**：验证完整的用户流程

**范围**：
- 用户打开 Harness → 加载项目 → 创建会话 → 发送消息 → 查看结果
- 移动端配对 → 桌面端接收 → 加密通信 → 移动端显示

**工具**：
- Playwright / Selenium：自动化 UI 测试
- Appium：移动端 UI 测试

**示例**：
```python
# test_e2e.py
from playwright.sync_api import sync_playwright

def test_complete_user_flow():
    """测试完整的用户流程"""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        
        # 1. 打开 Harness
        page.goto("http://localhost:3000")
        
        # 2. 加载项目
        page.click("text=Open Project")
        page.fill("input[type=file]", "/path/to/test/project")
        
        # 3. 创建会话
        page.click("text=New Session")
        page.wait_for_selector(".session-active")
        
        # 4. 发送消息
        page.fill("textarea.prompt", "Write a hello world script")
        page.click("button.submit")
        
        # 5. 验证结果
        page.wait_for_selector(".response")
        response = page.text_content(".response")
        assert "print('Hello, World!')" in response
        
        browser.close()
```

**频率**：
- 不应该在每次提交时运行（太慢）
- 在发布前必须运行完整的 E2E 套件
- 可以在 CI 中定期运行（例如每天一次）

---

## 测试环境搭建

### 本地测试环境

**要求**：
- Harness 开发环境（按 Harness 官方文档安装）
- Orca 环境（用于行为对比测试）
- Mock LLM API Server（避免真实 API 调用）

**Mock LLM API Server 示例**：
```python
# mock_llm_server.py
from flask import Flask, request, Response, stream_with_context
import time

app = Flask(__name__)

@app.route('/v1/messages', methods=['POST'])
def mock_complete():
    """模拟 Anthropic API 的流式响应"""
    data = request.json
    prompt = data.get("messages", [{}])[0].get("content", "")
    
    def generate():
        # 模拟流式响应
        response_parts = [
            '{"type":"message_start"}',
            '{"type":"content_block_start"}',
            '{"type":"content_block_delta","delta":{"text":"Hello"}}',
            '{"type":"content_block_delta","delta":{"text":" from"}}',
            '{"type":"content_block_delta","delta":{"text":" mock"}}',
            '{"type":"content_block_end"}',
            '{"type":"message_end"}',
        ]
        
        for part in response_parts:
            yield f"data: {part}\n\n"
            time.sleep(0.1)  # 模拟网络延迟
    
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(port=8080)
```

**启动测试环境**：
```bash
# 1. 启动 Mock LLM Server
python mock_llm_server.py &

# 2. 配置 Harness 使用 Mock Server
export HARNESS_API_ENDPOINT=http://localhost:8080

# 3. 运行测试
pytest tests/
```

---

### CI/CD 测试环境

**GitHub Actions 示例**：
```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov
      - name: Run unit tests
        run: pytest tests/unit/ --cov=harness --cov-report=xml
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      mock-llm:
        image: ghcr.io/your-org/mock-llm-server:latest
        ports:
          - 8080:8080
    steps:
      - uses: actions/checkout@v3
      - name: Run integration tests
        run: pytest tests/integration/
        env:
          HARNESS_API_ENDPOINT: http://localhost:8080

  behavior-parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Orca
        run: |
          curl -fsSL https://orca.sh/install.sh | sh
      - name: Run behavior comparison tests
        run: pytest tests/behavior/

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Playwright
        run: |
          pip install playwright
          playwright install
      - name: Run E2E tests
        run: pytest tests/e2e/
```

---

## 测试数据管理

### Fixtures 目录结构

```
tests/
├── fixtures/
│   ├── configs/                    # 配置文件样本
│   │   ├── valid_config.json      # 有效配置
│   │   ├── minimal_config.json    # 最小配置
│   │   ├── invalid.json           # 格式错误
│   │   └── incomplete.json        # 缺少字段
│   ├── orca_outputs/               # Orca 的基准输出
│   │   ├── config_show.json
│   │   └── session_lifecycle.log
│   ├── mock_responses/             # Mock API 响应
│   │   ├── success_stream.json
│   │   └── error_response.json
│   └── test_projects/              # 测试用项目
│       ├── simple/
│       └── large/
```

### 基准数据采集

**如何采集 Orca 的基准输出**：
```bash
# 1. 在 Orca 中执行操作
orca config show myconfig.json > tests/fixtures/orca_outputs/config_show.json

# 2. 记录完整的会话生命周期
orca session start --log tests/fixtures/orca_outputs/session_lifecycle.log

# 3. 提取关键状态
orca session state > tests/fixtures/orca_outputs/session_state.json
```

**使用基准数据**：
```python
# test_config_parity.py
def test_config_output_matches_orca():
    """验证配置输出与 Orca 一致"""
    # 加载 Orca 基准输出
    with open("tests/fixtures/orca_outputs/config_show.json") as f:
        orca_output = json.load(f)
    
    # 运行 Harness
    loader = OrcaConfigLoader()
    harness_output = loader.load("tests/fixtures/configs/valid_config.json")
    
    # 比较
    assert harness_output == orca_output
```

---

## 测试覆盖率要求

| 子系统 | 单元测试 | 行为对比 | 集成测试 | E2E | 总覆盖率 |
|--------|----------|----------|----------|-----|----------|
| 配置系统 | > 80% | ✅ 必须 | ✅ | - | > 85% |
| 会话管理 | > 80% | ✅ 必须 | ✅ | ✅ | > 85% |
| 中继层 | > 70% | ✅ 必须 | ✅ | - | > 75% |
| 桌面 UI | > 40% | - | ✅ | ✅ | > 60% |
| 任务调度 | > 80% | ✅ | ✅ | - | > 85% |
| 移动协议 | > 70% | ✅ 必须 | ✅ | ✅ | > 75% |
| 工作区 | > 60% | - | ✅ | ✅ | > 65% |
| 工具/MCP | > 70% | ✅ | ✅ | - | > 75% |

**说明**：
- ✅ 必须：该层测试是强制要求的
- \-：该层测试不适用或可选

---

## 性能测试

### 基准性能指标

| 操作 | Orca 基准 | Harness 目标 | 说明 |
|------|-----------|--------------|------|
| 配置加载 | < 10ms | < 50ms | Harness 可能因网络延迟稍慢 |
| 会话创建 | < 100ms | < 500ms | Harness 需要 HTTP 握手 |
| 流式响应首字节 | < 200ms | < 1s | 取决于 LLM API 延迟 |
| 大文件解析 (10MB) | < 1s | < 2s | 可接受的性能差异 |

**性能测试示例**：
```python
# test_performance.py
import time
import pytest

@pytest.mark.benchmark
def test_config_loading_performance(benchmark):
    """测试配置加载性能"""
    loader = OrcaConfigLoader()
    
    result = benchmark(loader.load, "fixtures/configs/large_config.json")
    
    # 断言性能在目标范围内
    assert benchmark.stats['mean'] < 0.05  # < 50ms
```

**运行性能测试**：
```bash
pytest tests/performance/ --benchmark-only
```

---

## 安全测试

### 加密协议测试

```python
# test_crypto.py
def test_encryption_interoperability():
    """测试 Harness 和 Orca 的加密互操作性"""
    from harness.extensions.relay import E2EEProtocol
    
    # Harness 加密
    protocol = E2EEProtocol()
    plaintext = "secret message"
    ciphertext = protocol.encrypt(plaintext)
    
    # Orca 解密
    orca_result = run_orca_decrypt(ciphertext)
    
    assert orca_result == plaintext
    
    # 反向测试
    orca_ciphertext = run_orca_encrypt(plaintext)
    harness_result = protocol.decrypt(orca_ciphertext)
    
    assert harness_result == plaintext

def test_key_rotation():
    """测试密钥轮换"""
    protocol = E2EEProtocol()
    
    # 使用旧密钥加密
    old_key = protocol.current_key
    ciphertext = protocol.encrypt("message")
    
    # 轮换密钥
    protocol.rotate_key()
    assert protocol.current_key != old_key
    
    # 旧密钥仍然可以解密
    plaintext = protocol.decrypt(ciphertext, key=old_key)
    assert plaintext == "message"
```

### 敏感数据泄漏测试

```python
# test_data_leak.py
def test_no_api_key_in_logs(caplog):
    """测试 API Key 不会出现在日志中"""
    config = {"api_key": "secret-key-12345"}
    loader = OrcaConfigLoader()
    
    loader.load_from_dict(config)
    
    # 检查日志中是否有 API Key
    for record in caplog.records:
        assert "secret-key-12345" not in record.message
```

---

## 回归测试

### 回归测试套件

每次迁移新子系统后，必须运行完整的回归测试，确保没有破坏已迁移的模块。

**回归测试清单**：
```bash
# 运行所有已迁移模块的测试
pytest tests/unit/settings/
pytest tests/unit/session/
pytest tests/integration/settings_and_session/
pytest tests/behavior/config_parity/
```

**自动化回归测试**：
```yaml
# .github/workflows/regression.yml
name: Regression Tests

on:
  pull_request:
    paths:
      - 'harness/extensions/**'

jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run regression suite
        run: |
          pytest tests/ --regression-only
```

---

## 验收测试检查清单

每个子系统迁移完成前，必须通过以下检查：

### 配置系统验收清单
- [ ] 单元测试通过（覆盖率 > 80%）
- [ ] 行为对比测试通过（与 Orca 输出一致）
- [ ] 集成测试通过（与会话管理联动）
- [ ] 边界测试通过（文件缺失、格式错误等）
- [ ] 性能测试通过（加载时间 < 50ms）
- [ ] 文档完成（接口文档 + 配置项说明）
- [ ] 代码审查通过
- [ ] PROGRESS.md 已更新

### 会话管理验收清单
- [ ] 单元测试通过（覆盖率 > 80%）
- [ ] 行为对比测试通过（状态机与 Orca 一致）
- [ ] 集成测试通过（配置 + 任务调度）
- [ ] E2E 测试通过（完整会话生命周期）
- [ ] 压力测试通过（100+ 并发会话）
- [ ] 崩溃恢复测试通过
- [ ] 文档完成（会话 API 文档）
- [ ] 代码审查通过
- [ ] PROGRESS.md 已更新

*(其他子系统的验收清单以此类推)*

---

**最后更新**：2026-10-10  
**维护者**：迁移团队
