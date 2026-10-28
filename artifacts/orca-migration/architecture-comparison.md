# Orca vs Harness 架构深度对比

本文档从技术架构层面深度对比 Orca 和 Harness，帮助理解迁移过程中的核心差异和设计权衡。

---

## 目录

- [系统概览](#系统概览)
- [核心差异](#核心差异)
- [架构层次对比](#架构层次对比)
- [数据流对比](#数据流对比)
- [状态管理对比](#状态管理对比)
- [并发模型对比](#并发模型对比)
- [安全模型对比](#安全模型对比)
- [扩展机制对比](#扩展机制对比)
- [关键设计决策](#关键设计决策)

---

## 系统概览

### Orca 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                        Orca Desktop                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │ Terminal UI│  │ Settings UI│  │ Editor UI  │             │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
│        │                │                │                    │
│  ┌─────▼────────────────▼────────────────▼──────┐            │
│  │            Director (调度器)                  │            │
│  └─────┬────────────────┬────────────────┬──────┘            │
│        │                │                │                    │
│  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐             │
│  │  Cell 1    │  │  Cell 2    │  │  Cell 3    │             │
│  │ (CLI进程)  │  │ (CLI进程)  │  │ (CLI进程)  │             │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
│        │                │                │                    │
│  ┌─────▼────────────────▼────────────────▼──────┐            │
│  │     Pty Handler (伪终端管理)                  │            │
│  └─────┬────────────────────────────────────────┘            │
│        │ stdin/stdout                                         │
└────────┼──────────────────────────────────────────────────────┘
         │
    ┌────▼────┐
    │ Claude  │  (本地 CLI)
    │  CLI    │
    └─────────┘

┌──────────────────────────────────────────────────────────────┐
│                      Orca Relay Server                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  E2EE Protocol + WebSocket/gRPC 传输层                 │  │
│  └─────┬──────────────────────────────────────────────────┘  │
│        │                                                      │
│  ┌─────▼──────────────────────────────────────────────────┐  │
│  │  Mobile Protocol Handler (JSON-RPC)                    │  │
│  └─────┬──────────────────────────────────────────────────┘  │
└────────┼──────────────────────────────────────────────────────┘
         │ E2EE 加密通道
    ┌────▼────┐
    │  Orca   │
    │ Mobile  │  (iOS/Android)
    └─────────┘
```

**核心特点**：
- **本地优先**：所有计算在本地完成，无需网络调用
- **进程隔离**：每个 Cell 是独立的 OS 进程
- **同步阻塞**：stdin/stdout 是同步的管道通信
- **文件系统为中心**：状态、配置、缓存都基于文件系统

---

### Harness 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                     Harness Desktop                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │ Terminal   │  │ Settings   │  │ Editor     │             │
│  │ View       │  │ View       │  │ View       │             │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
│        │                │                │                    │
│  ┌─────▼────────────────▼────────────────▼──────┐            │
│  │        SessionManager (会话管理器)            │            │
│  └─────┬────────────────┬────────────────┬──────┘            │
│        │                │                │                    │
│  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐             │
│  │ Session 1  │  │ Session 2  │  │ Session 3  │             │
│  │ (异步任务) │  │ (异步任务) │  │ (异步任务) │             │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
│        │                │                │                    │
│  ┌─────▼────────────────▼────────────────▼──────┐            │
│  │     StreamHandler (流式响应管理)              │            │
│  └─────┬────────────────────────────────────────┘            │
│        │ HTTP/WebSocket Stream                               │
└────────┼──────────────────────────────────────────────────────┘
         │
    ┌────▼────────┐
    │  LLM API    │  (Anthropic / OpenAI / etc.)
    │  (云端)     │
    └─────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    Harness Relay Server                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  EncryptionProtocol + WebSocket 传输层                 │  │
│  └─────┬──────────────────────────────────────────────────┘  │
│        │                                                      │
│  ┌─────▼──────────────────────────────────────────────────┐  │
│  │  MobileRPC Handler (JSON-RPC)                          │  │
│  └─────┬──────────────────────────────────────────────────┘  │
└────────┼──────────────────────────────────────────────────────┘
         │ E2EE 加密通道
    ┌────▼────┐
    │ Harness │
    │ Mobile  │  (iOS/Android)
    └─────────┘
```

**核心特点**：
- **云端优先**：核心计算在 LLM API 云端完成
- **异步任务**：每个 Session 是轻量级异步任务
- **流式非阻塞**：HTTP SSE / WebSocket 流式通信
- **抽象存储**：支持多种后端（内存/数据库/云存储）

---

## 核心差异

### 1. 执行模型

| 维度 | Orca | Harness |
|------|------|---------|
| **底层执行** | 本地 CLI 进程 (Claude CLI) | 云端 LLM API (HTTP) |
| **执行单元** | OS 进程 (Cell) | 异步任务 (Session) |
| **通信方式** | stdin/stdout 管道 | HTTP Stream / WebSocket |
| **隔离机制** | 进程隔离 | 任务隔离 (AbortController) |
| **生命周期控制** | `process.kill()` | `AbortController.abort()` |
| **状态持久化** | 文件系统 | 配置后端 (可选) |

**关键洞察**：
- Orca 的 "Cell" 是 **资源重**（OS 进程），Harness 的 "Session" 是 **资源轻**（内存对象）
- Orca 可以 "立即终止" 进程，Harness 需要 "优雅取消" API 请求
- Orca 依赖操作系统的进程调度，Harness 需要自己实现会话调度

---

### 2. 数据流模型

#### Orca 数据流

```
用户输入 → Terminal UI
            ↓
        Director 路由
            ↓
      Cell 进程启动
            ↓
     stdin 写入提示词
            ↓
    Claude CLI 处理
            ↓
     stdout 输出结果
            ↓
   Pty Handler 捕获
            ↓
     Terminal UI 渲染
```

**特点**：
- **同步阻塞**：stdout 阻塞直到进程输出
- **管道缓冲**：操作系统提供自动背压
- **进程边界**：清晰的进程隔离

---

#### Harness 数据流

```
用户输入 → Terminal View
            ↓
    SessionManager 路由
            ↓
      Session 创建
            ↓
    HTTP 请求发送
            ↓
    LLM API 处理 (云端)
            ↓
    SSE Stream 流式返回
            ↓
   StreamHandler 解析
            ↓
     异步队列缓冲
            ↓
    Terminal View 渲染
```

**特点**：
- **异步非阻塞**：立即返回 Promise/Future
- **手动背压**：需要实现队列和流控
- **网络边界**：跨越网络边界，需要处理延迟和失败

---

### 3. 状态管理

#### Orca 状态管理

```
配置：文件系统 (~/.orca/settings.json)
会话状态：内存 + 文件系统 (.orca/sessions/)
缓存：文件系统 (.orca/cache/)
日志：文件系统 (.orca/logs/)
```

**优点**：
- 简单直接，无需数据库
- 可以用任何文本编辑器查看和修改
- 易于备份和版本控制

**缺点**：
- 并发控制困难（文件锁）
- 大量小文件可能影响性能
- 跨平台路径问题

---

#### Harness 状态管理

```
配置：抽象接口 (ConfigLoader)
    ├── 文件系统实现 (FileConfigLoader)
    ├── 数据库实现 (DBConfigLoader)
    └── 云存储实现 (CloudConfigLoader)

会话状态：内存 + 可选持久化
缓存：可配置后端 (内存/Redis/文件)
日志：结构化日志 (JSON Lines)
```

**优点**：
- 灵活的存储后端
- 更好的并发控制
- 支持分布式部署

**缺点**：
- 抽象层增加复杂度
- 需要配置存储后端

---

## 架构层次对比

### Orca 架构分层

```
┌─────────────────────────────────────────────┐
│         Presentation Layer (UI)             │  Electron + React
├─────────────────────────────────────────────┤
│      Application Layer (Director)           │  TypeScript
├─────────────────────────────────────────────┤
│        Process Layer (Cell)                 │  TypeScript + Bun
├─────────────────────────────────────────────┤
│        Runtime Layer (Pty)                  │  Node.js native
├─────────────────────────────────────────────┤
│         System Layer (OS)                   │  OS 进程/文件系统
└─────────────────────────────────────────────┘
```

**特点**：
- **紧耦合**：各层之间直接调用，难以替换
- **单体架构**：所有组件在一个进程中（除了 Cell）
- **平台相关**：依赖特定的 OS 功能

---

### Harness 架构分层

```
┌─────────────────────────────────────────────┐
│         Presentation Layer (UI)             │  可插拔 UI 框架
├─────────────────────────────────────────────┤
│      Application Layer (Manager)            │  Python/Go/Rust
├─────────────────────────────────────────────┤
│     Orchestration Layer (Session)           │  异步任务
├─────────────────────────────────────────────┤
│      Integration Layer (Stream)             │  HTTP/WebSocket
├─────────────────────────────────────────────┤
│         Extension Layer (Plugins)           │  扩展机制
├─────────────────────────────────────────────┤
│          Core Layer (Engine)                │  不可修改的核心
└─────────────────────────────────────────────┘
```

**特点**：
- **松耦合**：各层通过接口通信，易于替换
- **微内核架构**：核心最小化，功能通过扩展实现
- **平台无关**：抽象掉 OS 差异

---

## 并发模型对比

### Orca 并发模型

```typescript
// Orca: 进程级并发
class Director {
  private cells: Map<string, Cell> = new Map()
  
  async createSession(config: Config): Promise<Cell> {
    const cell = new Cell(config)
    await cell.spawn()  // 启动新进程
    this.cells.set(cell.id, cell)
    return cell
  }
  
  async killSession(id: string) {
    const cell = this.cells.get(id)
    if (cell) {
      cell.process.kill('SIGTERM')  // 操作系统级终止
    }
  }
}

class Cell {
  process: ChildProcess
  
  async spawn() {
    this.process = spawn('claude', ['--interactive'])
    // 每个 Cell 是独立的 OS 进程
  }
}
```

**并发特点**：
- **操作系统调度**：CPU 时间片由 OS 分配
- **自动隔离**：进程之间天然隔离
- **资源开销大**：每个会话 = 一个完整进程

---

### Harness 并发模型

```python
# Harness: 异步任务并发
import asyncio
from typing import Dict

class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
    
    async def create_session(self, config: Config) -> Session:
        session = Session(config)
        await session.initialize()  # 异步初始化
        self.sessions[session.id] = session
        return session
    
    async def abort_session(self, id: str):
        session = self.sessions.get(id)
        if session:
            await session.abort()  # 优雅取消

class Session:
    def __init__(self, config: Config):
        self.abort_controller = asyncio.Event()
        self.stream_task: Optional[asyncio.Task] = None
    
    async def initialize(self):
        self.stream_task = asyncio.create_task(self._run_stream())
    
    async def _run_stream(self):
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", self.api_url) as response:
                async for chunk in response.aiter_bytes():
                    if self.abort_controller.is_set():
                        break  # 协作式取消
                    await self.handle_chunk(chunk)
    
    async def abort(self):
        self.abort_controller.set()
        if self.stream_task:
            await self.stream_task  # 等待任务优雅退出
```

**并发特点**：
- **事件循环调度**：由 async runtime 调度
- **协作式取消**：需要任务主动检查取消信号
- **资源开销小**：每个会话 = 轻量级协程

---

## 安全模型对比

### Orca 安全模型

```
┌─────────────────────────────────────────────┐
│         E2EE v2 Protocol                    │
│  ┌────────────────────────────────────────┐ │
│  │ X25519 密钥交换                        │ │
│  │ ChaCha20-Poly1305 加密                 │ │
│  │ BLAKE2b 消息认证                       │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────┐
│         本地密钥存储                         │
│  ~/.orca/keys/                              │
│    ├── device.private (设备私钥)            │
│    └── paired_devices.json (已配对设备)     │
└─────────────────────────────────────────────┘
```

**安全特点**：
- **端到端加密**：中继服务器无法解密
- **设备绑定**：每个设备有唯一密钥对
- **本地密钥管理**：密钥存储在本地文件系统

**威胁模型**：
- ✅ 防护：中间人攻击、服务器窃听
- ⚠️ 弱点：本地文件系统被攻破

---

### Harness 安全模型

```
┌─────────────────────────────────────────────┐
│      EncryptionProtocol (提取自 Orca)       │
│  ┌────────────────────────────────────────┐ │
│  │ 相同的加密算法和协议                   │ │
│  │ (确保与 Orca 互操作)                   │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────┐
│         抽象密钥存储                         │
│  KeyStore Interface                         │
│    ├── FileKeyStore (文件系统)              │
│    ├── OSKeyStore (系统密钥链)              │
│    └── HSMKeyStore (硬件安全模块)           │
└─────────────────────────────────────────────┘
```

**安全特点**：
- **协议兼容**：与 Orca 完全互操作
- **灵活的密钥存储**：支持多种后端
- **平台集成**：可以使用 OS 密钥链 (Keychain/Credential Manager)

**威胁模型**：
- ✅ 防护：与 Orca 相同
- ✅ 增强：支持硬件安全模块 (HSM)

---

## 扩展机制对比

### Orca 扩展机制

```typescript
// Orca: 直接修改核心代码
// src/main/director/director.ts
class Director {
  // 添加新功能需要修改这个文件
  async createSession(config: Config) {
    // ... 核心逻辑 ...
    
    // 新功能硬编码在这里
    if (config.experimental_feature) {
      this.enableExperimentalFeature()
    }
  }
}
```

**扩展方式**：
- 直接修改源码
- Fork 项目并维护自己的分支

**优点**：
- 简单直接

**缺点**：
- 难以升级官方版本
- 多个扩展之间可能冲突

---

### Harness 扩展机制

```python
# Harness: 插件系统
from harness.core import SessionManager, Hook

class SessionManager:
    def __init__(self):
        self.hooks = HookRegistry()
    
    async def create_session(self, config: Config):
        # 触发前置 Hook
        await self.hooks.trigger('before_create_session', config)
        
        # 核心逻辑不变
        session = await self._create_session_core(config)
        
        # 触发后置 Hook
        await self.hooks.trigger('after_create_session', session)
        
        return session

# 扩展代码（独立文件）
# harness/extensions/my_plugin/plugin.py
@Hook.register('after_create_session')
async def my_custom_logic(session: Session):
    # 扩展逻辑，不修改核心代码
    if session.config.experimental_feature:
        await enable_experimental_feature(session)
```

**扩展方式**：
- Hook/插件机制
- 事件总线
- 依赖注入

**优点**：
- 核心代码不变，易于升级
- 多个扩展可以共存

**缺点**：
- 需要设计扩展点

---

## 关键设计决策

### 决策 1：为什么不直接移植 Orca 的进程模型？

**理由**：
1. **资源效率**：Harness 的 LLM 会话是轻量级的，不需要完整的 OS 进程
2. **云端执行**：LLM API 在云端运行，本地不需要进程隔离
3. **并发能力**：异步任务可以支持更高的并发数（1000+ 会话）
4. **跨平台**：异步模型更容易跨平台移植

**权衡**：
- ✅ 获得：更高的资源效率和并发能力
- ❌ 失去：OS 级别的进程隔离

---

### 决策 2：为什么保留 Orca 的加密协议？

**理由**：
1. **互操作性**：Harness 需要与 Orca 移动端通信
2. **成熟性**：Orca 的加密协议已经经过实战验证
3. **安全性**：经过审计的协议比自己发明的更可靠

**权衡**：
- ✅ 获得：互操作性和成熟的安全保障
- ❌ 失去：选择其他加密方案的自由

---

### 决策 3：为什么使用抽象存储而不是纯文件系统？

**理由**：
1. **云端部署**：Harness 可能部署在无状态容器中
2. **并发控制**：数据库提供更好的并发控制
3. **扩展性**：支持分布式部署

**权衡**：
- ✅ 获得：灵活性和扩展性
- ❌ 失去：Orca 的简单性（所有状态都在文件系统中）

---

### 决策 4：为什么使用插件系统而不是直接修改核心？

**理由**：
1. **可维护性**：核心代码稳定，易于升级
2. **生态系统**：第三方可以开发插件
3. **隔离性**：插件问题不会影响核心

**权衡**：
- ✅ 获得：可维护性和生态系统
- ❌ 失去：简单性（需要设计扩展点）

---

## 迁移策略总结

基于以上架构对比，迁移策略应该是：

### ✅ 应该做的

1. **提取契约**：从 Orca 提取接口、协议、数据结构
2. **概念翻译**：进程 → 异步任务，stdin/stdout → HTTP Stream
3. **保留优秀设计**：E2EE 协议、配对流程、UI 交互模式
4. **利用 Harness 优势**：插件系统、抽象存储、异步并发

### ❌ 不应该做的

1. **直接移植代码**：TypeScript → Python 不是迁移的目标
2. **模拟进程模型**：不要用 subprocess 模拟 Orca 的 Cell
3. **破坏核心**：不要修改 Harness 的 `core/` 或 `engine/`
4. **忽略差异**：不要假设 Orca 的设计在 Harness 中都适用

---

**最后更新**：2026-10-10  
**维护者**：迁移团队
