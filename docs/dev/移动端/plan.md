# cinlan-harness 移动端实现计划

> 基于 orca mobile 架构分析，结合 cinlan-harness 现有基础设施，制定的分阶段实施计划。

## 现状分析

### cinlan-harness 已有的基础设施

| 能力 | 现状 | 文件位置 |
|---|---|---|
| HTTP Web Server | `WebServer` 服务，支持 `127.0.0.1`/`0.0.0.0` 绑定，路由注册，upgrade route | `packages/host/webserver/src/index.ts` |
| WebSocket Gateway | `/api/remote.mux` 多路复用流，心跳，Typert RPC 分发 | `packages/api/gateway/src/stream-server.ts` |
| Session API | `session.list` / `session.create` / `session.search` 等 Remote 方法 | `packages/api/session-controller/src/index.ts` |
| Client 连接层 | `ClientTransportHooks`（fetch / openStream / ownsHost），`resolveBase()` 硬编码 `location.origin` | `packages/client/connection/src/client/index.ts` |
| RPC 调用 | `createWebConnectionRpc`，基于 `globalThis.fetch` | `packages/client/connection/src/client/rpc.ts` |
| Web 前端 | `apps/web` — Vite + React 瘦客户端，`AppWebEntry` | `apps/web/src/main.ts` |
| Desktop | Electron shell，不开端口，字节管道 + `dsh-app://` | `apps/desktop-host/src/index.ts` |

### 缺失的能力

| 能力 | 说明 |
|---|---|
| 远程接入层 | Web Server 默认 `127.0.0.1`，`--host 0.0.0.0` 被安全拦截 |
| 设备配对 | 无 QR 码、无设备注册表、无 deviceToken |
| E2EE | 无端到端加密，RPC 依赖传输层安全 |
| 移动端 App | 无 React Native / Expo 项目 |
| 推送通知 | 无移动端通知系统 |
| Relay 中继 | 无跨网络中继服务 |

### orca mobile 可复用部分

| 模块 | 复用度 | 说明 |
|---|---|---|
| 传输层（WebSocket + E2EE + 配对） | 高 | 与业务无关，可直接移植 |
| 配对 UI（扫码、连接日志） | 高 | 通用流程，改品牌即可 |
| Host 管理（列表、编辑、删除） | 高 | 通用流程 |
| 通知骨架 | 中 | 需适配 dsh 的 session 事件 |
| 组件库（Modal、Drawer、ActionSheet） | 中 | 可复用，需适配主题 |
| Chat 界面 | 低 | 概念相近但 dsh 的消息/工具模型不同 |
| 终端（xterm.js in WebView） | 低 | dsh 无 PTY 流 |
| Worktree 列表 | 无 | dsh 无 worktree |
| Source Control / PR / Tasks / Browser | 无 | dsh 无对应功能 |

## 架构设计

### 目标架构

```
┌─────────────┐         WebSocket (E2EE)         ┌──────────────────┐
│  Mobile App  │ ◄──────────────────────────────► │  cinlan-harness   │
│  (React      │      ws://<host>:<port>/api/      │  Host             │
│   Native)    │           remote.mux              │                   │
└─────────────┘                                  │  ┌─────────────┐  │
      │                                          │  │ WebServer   │  │
      │ QR pairing                               │  │ (0.0.0.0)  │  │
      │                                          │  └──────┬──────┘  │
      ▼                                          │         │         │
┌─────────────┐                                  │  ┌──────▼──────┐  │
│  Desktop     │ 生成 QR ──► 手机扫码 ──► 配对    │  │ Gateway WS  │  │
│  (Electron)  │                                  │  │ /api/remote │  │
└─────────────┘                                  │  │ .mux       │  │
                                                  │  └──────┬──────┘  │
                                                  │         │         │
                                                  │  ┌──────▼──────┐  │
                                                  │  │ Session     │  │
                                                  │  │ Controller  │  │
                                                  │  └─────────────┘  │
                                                  └──────────────────┘
```

### 关键设计决策

1. **复用现有 Gateway WebSocket**：cinlan-harness 已有 `/api/remote.mux` 多路复用流，移动端直接对接这个端点，不另建 WebSocket 服务器（与 orca 不同，orca 自建了 6768 端口的 WS RPC）

2. **设备认证层**：在 `connection.requestRejection` 中加入 deviceToken 校验，复用现有 `WebUpgradeRoute` 的认证拦截点

3. **E2EE 可选**：MVP 阶段先依赖 TLS + 局域网，E2EE 作为 Phase 3 增强（orca 用 tweetnacl 做端到端加密，dsh 可以复用相同方案）

4. **Session-based UI**：移动端核心界面是 Session 列表 + Session Chat，不是 orca 的 Worktree + Terminal

## 分阶段计划

### Phase 0：Host 远程接入层（1-2 周）

**目标**：让 cinlan-harness Host 能安全地暴露到局域网，移动端可以连接。

**改动范围**：`packages/host/webserver`、`packages/boot`、`apps/cli`

- **0.1 解除 `--host 0.0.0.0` 安全拦截**
  - `packages/bundle/web-app/src/startup.ts:74` 当前硬编码拒绝 `0.0.0.0`
  - 改为带设备认证的安全暴露，或新增 `--expose` flag 显式开启
  - 需要同步加入 `--trusted-device-token` 机制

- **0.2 设备注册表（Device Registry）**
  - 新建 `packages/host/device-registry` 包
  - 数据结构：`{ deviceId, name, deviceToken, publicKey, pairedAt, lastSeenAt, scope }`
  - 持久化到用户数据目录（JSON 文件）
  - 提供 `listDevices` / `revokeDevice` / `validateToken` API

- **0.3 配对 QR 码生成**
  - 新建 `packages/host/mobile-pairing` 包
  - 生成 `dsh://pair?code=<base64>` 格式的配对 URL
  - QR 内容：`{ endpoint, deviceToken, serverPublicKey, hostName }`
  - 在 Desktop UI 中添加 Settings > Mobile 页面，显示 QR 码

- **0.4 连接认证拦截**
  - 在 `packages/api/gateway/src/index.ts` 的 `requestRejection` 中加入 deviceToken 校验
  - WebSocket upgrade 请求需携带 `Authorization: Bearer <deviceToken>` header
  - 未认证连接在 upgrade 阶段拒绝

**验证**：用 `wscat` 或 curl 能通过 deviceToken 连接到 `/api/remote.mux`

---

### Phase 1：移动端传输层（2-3 周）

**目标**：React Native App 能扫码配对、建立 WebSocket 连接、发送 RPC。

**改动范围**：新建 `apps/mobile` 项目

- **1.1 项目初始化**
  - 新建 `apps/mobile`，Expo + React Native + Expo Router
  - 依赖：`expo-camera`、`expo-secure-store`、`@react-native-async-storage/async-storage`、`react-native-webview`、`lucide-react-native`
  - 目录结构：
    ```
    apps/mobile/
    ├── app/              # Expo Router screens
    │   ├── index.tsx     # Host 列表首页
    │   ├── pair-scan.tsx # 扫码配对
    │   └── h/[hostId]/
    │       ├── index.tsx       # Session 列表
    │       └── session/
    │           └── [sessionId].tsx  # Session Chat
    ├── src/
    │   ├── transport/    # 传输层（从 orca 移植）
    │   ├── session/      # Session UI 组件
    │   └── theme/        # 主题
    └── package.json
    ```

- **1.2 传输层移植（从 orca）**
  - 移植 `orca/mobile/src/transport/` 核心文件：
    - `e2ee.ts` — tweetnacl E2EE（Phase 3 启用）
    - `pairing.ts` — QR 码解析（改 `orca://` → `dsh://`）
    - `types.ts` — 类型定义（适配 dsh 的 RPC 协议）
    - `rpc-client.ts` — WebSocket RPC 客户端（适配 dsh 的 `/api/remote.mux` 协议）
    - `host-store.ts` — Host 配置持久化
  - **关键适配**：dsh 的 Gateway 用的是多路复用流协议（`stream-protocol.ts`），不是 orca 的单请求/响应模式，`rpc-client.ts` 需要重写消息层

- **1.3 配对流程**
  - `pair-scan.tsx`：`expo-camera` 扫码 → 解析 `dsh://pair?code=...` → 存储到 AsyncStorage + Keychain
  - 连接测试：建立 WebSocket → 握手 → 持久化 HostProfile

- **1.4 RPC 客户端适配**
  - dsh 的 Gateway 协议（`packages/api/gateway/src/stream-protocol.ts`）：
    - 请求：`{ type: 'open', streamId, endpoint, payload }`
    - 响应：`{ type: 'item' | 'end' | 'error', streamId, ... }`
    - 取消：`{ type: 'cancel', streamId }`
  - 封装为 `RpcClient.sendRequest(method, params)` 和 `RpcClient.subscribe(method, params, onData)`

**验证**：手机扫码后能连接到桌面 Host，调用 `session.list` 返回 Session 列表

---

### Phase 2：移动端 MVP UI（3-4 周）

**目标**：Session 列表 + Session Chat 的最小可用产品。

- **2.1 Host 列表首页**
  - 已配对 Host 列表，显示连接状态、最近活跃时间
  - 添加新 Host（扫码）、编辑、删除
  - 从 orca `app/index.tsx` 简化移植

- **2.2 Session 列表**
  - 调用 `session.list` RPC 获取 Session 列表
  - 显示：Session 标题、更新时间、运行状态（running/idle）
  - 新建 Session 按钮（调用 `session.create`）
  - 搜索（调用 `session.search`）

- **2.3 Session Chat 界面（核心）**
  - **消息流**：订阅 Session 事件流（`session.events` stream），渲染 user/assistant 消息
  - **消息渲染**：Markdown 渲染（从 orca `MobileMarkdown.tsx` 移植）
  - **工具调用展示**：折叠显示工具调用 + 结果（适配 dsh 的 tool-call 事件格式）
  - **输入框**：文本输入 + 发送（调用 `session.send` RPC）
  - **流式响应**：实时显示 agent 输出（订阅 `session.stream` 事件）
  - **停止**：中断 agent 运行（调用 `session.stop`）

  关键文件：
  ```
  src/session/
  ├── SessionChatView.tsx        # 主视图
  ├── SessionChatMessage.tsx     # 消息渲染
  ├── SessionChatComposer.tsx    # 输入框
  ├── SessionChatToolCall.tsx     # 工具调用折叠
  └── use-session-events.ts       # 事件流订阅 hook
  ```

- **2.4 连接状态管理**
  - 连接状态指示器（connecting / connected / disconnected / auth-failed）
  - 自动重连（从 orca 移植退避策略）
  - 前台恢复（AppState 'active' 时探测连接）

**验证**：手机上能看到 Session 列表，进入 Session 后能查看历史消息、发送新消息、看到流式响应

---

### Phase 3：安全增强（2 周）

**目标**：E2EE + 推送通知。

- **3.1 E2EE**
  - 移植 orca 的 `e2ee.ts`（tweetnacl Curve25519 ECDH + XSalsa20-Poly1305）
  - Host 端：在 Gateway WebSocket 层加入 E2EE 解密/加密中间件
  - 配对时交换公钥（QR 码中包含 Host 公钥）
  - 所有 RPC 消息加密传输

- **3.2 推送通知**
  - Agent 完成时推送本地通知
  - 订阅 `agent/status` 事件，`status === 'idle'` 且之前是 `running` 时触发
  - 从 orca `src/notifications/mobile-notifications.ts` 移植骨架
  - 通知点击跳转到对应 Session

**验证**：配对后所有通信加密；Agent 完成时手机收到推送通知

---

### Phase 4：功能扩展（持续）

按优先级排列，每个可独立交付：

- **4.1 Session 管理**：重命名、删除、fork、搜索历史
- **4.2 多模型选择**：在 Chat 界面切换模型/Provider
- **4.3 文件预览**：点击消息中的文件引用，查看文件内容（从 orca `src/files/` 简化移植）
- **4.4 图片附件**：发送图片给 Agent（从 orca `mobile-image-attachment.ts` 移植）
- **4.5 语音输入**：语音转文字（从 orca `MobileDictationSetupSheet.tsx` 移植）
- **4.6 快捷命令**：预设常用 prompt（从 orca `QuickCommandsList.tsx` 移植）
- **4.7 Relay 中继**：跨网络访问（从 orca `desktop-relay-service.ts` 移植，需要部署 relay 服务器）
- **4.8 Terminal Tab**：如果 dsh 未来加入 shell capability，可从 orca 移植 xterm.js WebView 终端

## 技术选型

| 领域 | 选型 | 理由 |
|---|---|---|
| 移动框架 | React Native + Expo | 与 orca 一致，可复用代码 |
| 路由 | Expo Router | 文件路由，与 orca 一致 |
| 状态管理 | React hooks + Context | dsh web 端也是纯 hooks |
| E2EE | tweetnacl | 与 orca 一致，轻量 |
| 终端 | xterm.js in WebView | 如果需要终端，从 orca 移植 |
| QR 扫描 | expo-camera | 与 orca 一致 |
| 安全存储 | expo-secure-store | deviceToken 存 Keychain |
| 持久化 | AsyncStorage | HostProfile 等非敏感数据 |

## 风险与对策

| 风险 | 对策 |
|---|---|
| dsh Gateway 协议与 orca RPC 协议差异大 | Phase 1 重点重写 `rpc-client.ts` 的消息层，不照搬 orca |
| `--host 0.0.0.0` 暴露安全风险 | Phase 0 必须先完成设备认证，再开放绑定 |
| Session 事件流协议复杂 | MVP 先用轮询 `session.list` + `session.inspect`，流式订阅作为优化 |
| 移动端开发环境搭建 | 参考 orca `mobile/README.md` 的 Expo 开发流程 |
| orca 代码移植版权 | orca 和 cinlan-harness 同属 Cinlan Technology，无版权问题 |

## 里程碑

| 里程碑 | 预期时间 | 交付物 |
|---|---|---|
| M0: Host 可远程连接 | 第 2 周末 | `--expose` flag + deviceToken 认证 |
| M1: 手机能扫码连 Host | 第 5 周末 | 配对 + WebSocket 连接 + `session.list` |
| M2: MVP 可用 | 第 9 周末 | Session 列表 + Chat + 流式响应 |
| M3: 安全增强 | 第 11 周末 | E2EE + 推送通知 |
| M4+: 持续迭代 | 持续 | 文件预览、图片、语音等 |
