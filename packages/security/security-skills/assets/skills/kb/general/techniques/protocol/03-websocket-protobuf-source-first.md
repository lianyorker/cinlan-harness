---
id: 'general/protocol/03-websocket-protobuf-source-first'
title: 'WebSocket + Protobuf 源码优先协议重建'
title_en: 'Source-first WebSocket and Protobuf Protocol Reconstruction'
summary: >
  当已有开源客户端或残留 proto 时，从可验证源码版本出发，分层还原 WebSocket
  握手、外层 frame、内层业务消息和鉴权边界，并以 request/result IPC 构建保留
  未知消息、可闭合发送链的最小运行时。
summary_en: >
  Reconstruct WebSocket handshakes, outer frames, nested business messages, and
  authentication boundaries from a verifiable source snapshot or proto files,
  then build a minimal runtime that preserves unknown messages.
board: 'general'
category: 'protocol'
signals:
  - 'WebSocket binary frame'
  - 'nested protobuf'
  - 'payload type'
  - 'payload encoding'
  - 'open-source client'
  - 'proto source'
  - 'unknown message preservation'
  - 'request result IPC'
  - 'conversation ticket'
  - 'a_bogus'
mcp_tools:
  - 'kb_router'
  - 'kb_read_file'
  - 'anything-analyzer'
keywords:
  - 'WebSocket'
  - 'Protobuf'
  - 'source-first'
  - 'binary frame'
  - 'protocol reconstruction'
  - 'schema verification'
difficulty: 'intermediate'
tags:
  - 'protocol-analysis'
  - 'WebSocket'
  - 'Protobuf'
  - 'source-provenance'
language: 'zh-CN'
last_updated: '2026-07-29'
related_articles:
  - 'general/protocol/01-unknown-protocol-reverse'
  - 'general/protocol/02-protobuf-flatbuffers-reverse'
---

# WebSocket + Protobuf 源码优先协议重建

## 场景

目标使用 WebSocket 二进制帧和 Protobuf，但已有开源客户端、生成后的 `*_pb2`/`*.pb.go`，或部分 `.proto`。此时优先验证并迁移已有证据，不应从字节流 重新盲猜全部 schema。 重新盲猜全部 schema。 重新盲猜全部 schema。 重新盲猜全部 schema。

该方法适合“接收协议可从源码复现，但发送链另有签名、票据或设备材料”的非对称 协议。接收成功不能推导主动发送已经可用。 协议。接收成功不能推导主动发送已经可用。 协议。接收成功不能推导主动发送已经可用。 协议。接收成功不能推导主动发送已经可用。

## 输入信号

- 客户端构造 `ws://`/`wss://` URL，并附加 query、Cookie 或自定义 Header。
- WebSocket message 先解码为外层 frame，frame 的某字段决定 payload 类型。
- 外层 payload 再解码为第二个 Protobuf message。
- 业务 `content` 可能仍是 JSON、压缩数据或第三层二进制。
- 接收只需会话信息，发送函数却额外读取 ticket、certificate、private key 或 动态签名参数。

## 方法

### 1. 固定源码来源

记录仓库 URL、commit、获取时间和完整 tree。源码目录没有 `.git` 时，不能使用 向上搜索到父仓库的 `git rev-parse` 作为证据。 向上搜索到父仓库的 `git rev-parse` 作为证据。 向上搜索到父仓库的 `git rev-parse` 作为证据。 向上搜索到父仓库的 `git rev-parse` 作为证据。

可用 GitHub tree API 和 Git blob SHA 验证源码快照：

```powershell
# 单文件 Git blob SHA；与远端 tree 中的 blob sha 对比。
git hash-object -- .\path\to\source.file
```

验收条件是远端 blob、缺失文件、额外文件和变更文件都有明确统计。仅比较 README 或文件时间不能证明快照版本。 或文件时间不能证明快照版本。 或文件时间不能证明快照版本。 或文件时间不能证明快照版本。

### 2. 分层追踪握手

从 WebSocket 构造点向上追踪所有输入：

```text
配置/会话
  -> URL query builder
  -> Header builder
  -> WebSocket connect
```

逐项记录：

- scheme、host、path；
- query 字段、常量和计算公式；
- Cookie 中实际读取的键；
- `Origin`、`User-Agent`、`Sec-WebSocket-Protocol`；
- URL override 是否会把 Cookie 转发到非预期 host。

URL override 必须限制 scheme/host，避免调试配置变成凭据外发路径。

### 3. 分层恢复消息结构

不要把整条消息误认为单个 Protobuf：

```text
WebSocket binary
  -> OuterFrame
     -> payload_type / payload_encoding
     -> payload bytes
        -> Response
           -> oneof/body
              -> BusinessMessage
                 -> content JSON/binary
```

迁移 schema 时逐字段核对：

1. field number；
2. wire-compatible type；
3. optional/repeated/oneof；
4. signed/unsigned 宽度；
5. 上层实际读取路径。

只定义当前读取所需字段是可行的，Protobuf 会跳过未知字段；但未知业务 `message_type` 必须把类型编号和原始 content 继续上报，不能静默丢弃。 `message_type` 必须把类型编号和原始 content 继续上报，不能静默丢弃。 `message_type` 必须把类型编号和原始 content 继续上报，不能静默丢弃。 `message_type` 必须把类型编号和原始 content 继续上报，不能静默丢弃。

### 4. 拆分接收和发送鉴权

分别枚举两条链的输入，禁止合并为一个“已登录”状态：

| 链路               | 常见输入                                                     |
| ------------------ | ------------------------------------------------------------ |
| WebSocket 接收     | Cookie/session、device ID、固定 app 参数、派生 access key    |
| HTTP/Protobuf 发送 | conversation ticket、动态 token、请求签名、证书/私钥、时间戳 |

#### 浏览器侧采集边界

当 device ID 由业务接口动态下发时，采集器应按证据强度取值：

1. 优先使用精确业务接口响应中的字段，例如 `/aweme/v1/web/query/user` 响应顶层 `id`。
2. 已建立的业务 WebSocket URL 中若带 `device_id`，可作为同链路证据。
3. `performance` 中已有完整签名 URL 时，可以携带当前会话 Cookie 立即重放并读取 响应；需要触发新请求时，可短时监听当前页 `fetch`/XHR，或加载同源页面后轮询其 Resource Timing。采集结束必须恢复 Hook、断开 observer 并移除临时 frame。
4. localStorage、sessionStorage 或遥测 body 中语义不明的同名 `device_id`，在没有 等值抓包证据前不能代替业务接口返回值。

页面 JavaScript 可以读取页面 storage 和非 HttpOnly Cookie，但不能读取 HttpOnly Cookie。完整 Cookie 必须由 DevTools Network、CDP `Network.getAllCookies` 或浏览器 context cookie API 获取，不能通过 `document.cookie`、Cookie Store API 或 Console 脚本伪装完整。Console 只输出字段存在性等脱敏摘要，原始材料直接进入本地剪贴板或 安全配置，不进入聊天、日志和状态接口。 安全配置，不进入聊天、日志和状态接口。 安全配置，不进入聊天、日志和状态接口。 安全配置，不进入聊天、日志和状态接口。

Chrome 136+ 还需要单独验证 App-Bound Encryption 边界。不要假设复制默认 profile 或 Cookie SQLite 数据库后，另一个 `--user-data-dir` 实例仍能解密原 Cookie。 可先让隔离实例只打开 `about:blank`，通过 CDP `Storage.getCookies` 检查目标域： 若源数据库存在未到期的加密 Cookie，而隔离实例在任何目标请求前仍返回空集，说明 该复制链不可用。此时应在实际登录浏览器的 DevTools Network 中复制请求 Cookie， 或在可调试的隔离 profile 中完成一次人工登录后从同一浏览器 context 采集；不能把 Cookie 数据库中“存在记录”等同于运行时“可读取值”。 Cookie 数据库中“存在记录”等同于运行时“可读取值”。 Cookie 数据库中“存在记录”等同于运行时“可读取值”。 Cookie 数据库中“存在记录”等同于运行时“可读取值”。

发送链任一材料的获取、刷新或绑定关系未验证时，Adapter 应返回明确的 `not implemented`/`not ready`，不要用占位签名或 fallback 伪装成功。若字段与算法 已有源码和固定向量证据，但真实账号尚未验证，可以在显式 feature flag 后实现并 标记“离线完成，待实机”，不能把单元测试写成线上可用。 标记“离线完成，待实机”，不能把单元测试写成线上可用。 标记“离线完成，待实机”，不能把单元测试写成线上可用。 标记“离线完成，待实机”，不能把单元测试写成线上可用。

### 5. 构建最小隔离运行时

协议层使用独立进程时，可通过 loopback IPC 向业务层只暴露规范化事件：

```json
{"v":1,"type":"hello","token":"{token}","payload":{"runtime":"protocol-runtime"}}
{"v":1,"type":"event","payload":{"message_type":"private","chain":[]}}
{"v":1,"type":"runtime_status","payload":{"state":"ready","connected":true}}
{"v":1,"type":"request","id":"request-id","payload":{"action":"send_text"}}
{"v":1,"type":"result","id":"request-id","payload":{"ok":true}}
```

最低约束：

- loopback 监听；
- 首帧随机 token 鉴权；
- 最大帧限制和握手超时；
- 未知 envelope 拒绝；
- Cookie、完整 URL 和签名材料不进入事件或状态；
- 连接失败保持 not-ready。

### 6. 在 IPC 上闭合发送链

发送命令必须使用请求 ID 关联结果，不能假设 HTTP 返回顺序与调用顺序一致：

```text
业务 Outbound
  -> 校验会话元数据
  -> IPC request(id)
  -> 查询短期 conversation ticket
  -> 构造并签名 protobuf
  -> HTTP 发送
  -> IPC result(id, ok/error)
```

最低约束：

- 每个请求有独立超时和有界 frame；
- pending map 在响应、超时和写失败后都释放；
- IPC 断开时一次性唤醒全部 pending 请求；
- 成功字段只来自已解析响应；schema 没有 server ID 时不要用 client ID 冒充；
- 动态 token、ticket、证书、私钥和完整 URL 不进入 result；
- 签名移植必须有固定输入/输出向量，并与固定上游版本逐字节比对。

## 操作链

```text
固定 commit/tree
  -> rg 定位 WS/URL/Header builder
  -> 对照 proto 和实际字段访问
  -> 画出 OuterFrame -> Response -> BusinessMessage
  -> 分开列接收/发送鉴权材料
  -> 实现最小 typed decoder
  -> 移植发送签名并建立固定向量
  -> request/result IPC 关联和断线测试
  -> synthetic frame 单测
  -> 本地 IPC/状态 smoke
  -> 真实会话抓包和端到端补证
```

## 常见误判

| 误判                                           | 校正                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| 搜到同平台直播 WS 就当成私信接口               | 以业务客户端的连接构造点和消息字段为准           |
| 有 `.proto` 就认为字段语义全部正确             | 继续核对调用者读取路径和业务枚举                 |
| 接收连通就认为可以发送                         | 分别验证发送所需票据、密钥和动态签名             |
| 把 client message ID 当成 server message ID    | 只返回响应 schema 中实际解析到的字段             |
| IPC 只实现单向事件流                           | 为发送增加 request ID、超时、结果关联和断线唤醒  |
| 未知类型直接 `return nil`                      | 保留类型编号和原始 payload                       |
| 错误日志直接打印请求 URL                       | 对 query token 脱敏，HTTP URL error 去除完整 URL |
| 只用自编码 frame 测试就宣称协议实机可用        | 明确区分离线结构验证与真实账号验证               |
| 复制 Cookie DB 后看到 `sessionid` 行就认为可用 | 用隔离浏览器 CDP 验证解密后的运行时值            |

## 工具映射

| 阶段        | 工具                               | 用途                                   |
| ----------- | ---------------------------------- | -------------------------------------- |
| 源码定位    | `rg`                               | 查 URL、Header、proto 类和消息枚举     |
| 来源验证    | GitHub API、`git hash-object`      | 验证 commit tree 和本地 blob           |
| Schema 对照 | `protoc`、`prost`、生成代码        | 校验 field number/type                 |
| 动态补证    | anything-analyzer、Wireshark、Burp | 观察 WS 握手和二进制帧                 |
| 单元验证    | 语言原生 protobuf 库               | 编码 synthetic frame 再解码断言        |
| 签名验证    | 上游实现、固定向量                 | 对 query、签名原文和最终输出逐字节比对 |
| 运行验证    | loopback mock/status endpoint      | 验证 IPC、ready 状态和退出             |

## 验证标准

1. 来源：本地文件与指定 commit tree 的 blob SHA 一致，差异统计为零或有说明。
2. 握手：URL、query、Header 每个值都有源码行或抓包证据。
3. 结构：至少一条真实帧或上游 fixture 可走通全部嵌套层。
4. 兼容：未知业务类型不会导致连接退出或消息丢失。
5. 安全：Cookie、token、Webhook key、证书和私钥不出现在日志/状态。
6. 发送：并发请求按 ID 关联，超时和断线不会遗留 pending 请求。
7. 边界：离线测试、源码证据、真实账号测试分别标记，不互相替代。

## 证据与验证闭环

原始抓包进入 `exports/`，协议结论进入 `notes/` 或项目协议文档，解析器进入 `scripts/` 或正式 runtime。每次上游版本变化后重新固定 commit、执行 tree diff， 再决定是字段兼容、枚举新增还是握手鉴权变化。 再决定是字段兼容、枚举新增还是握手鉴权变化。 再决定是字段兼容、枚举新增还是握手鉴权变化。 再决定是字段兼容、枚举新增还是握手鉴权变化。
