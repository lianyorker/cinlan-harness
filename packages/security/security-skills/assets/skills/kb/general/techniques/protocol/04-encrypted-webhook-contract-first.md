---
id: 'general/protocol/04-encrypted-webhook-contract-first'
title: '加密 Webhook 官方契约优先重建'
title_en: 'Contract-first Reconstruction of Encrypted Webhooks'
summary: >
  面对签名、加密和嵌套业务 JSON 的 Webhook，先固定官方字段层级、枚举和空响应语义，
  再映射到内部事件；避免把可选对象误判为消息类型，或直接复用语义不同的内部枚举。
summary_en: >
  Reconstruct signed and encrypted webhook callbacks from the official field
  hierarchy, enum values, and empty-response semantics before mapping them to
  internal events.
board: 'general'
category: 'protocol'
signals:
  - 'encrypted webhook'
  - 'callback signature'
  - 'EncodingAESKey'
  - 'nested business JSON'
  - 'optional quote field'
  - 'chattype single group'
  - 'empty callback response'
  - 'response_url'
mcp_tools:
  - 'kb_router'
  - 'kb_read_file'
  - 'anything-analyzer'
keywords:
  - 'Webhook'
  - 'AES-CBC'
  - 'SHA-1'
  - 'callback schema'
  - 'contract-first'
  - 'field semantics'
  - 'empty response'
difficulty: 'intermediate'
tags:
  - 'protocol-analysis'
  - 'webhook'
  - 'schema-verification'
  - 'cryptography'
language: 'zh-CN'
last_updated: '2026-07-29'
related_articles:
  - 'general/protocol/01-unknown-protocol-reverse'
  - 'general/protocol/03-websocket-protobuf-source-first'
---

# 加密 Webhook 官方契约优先重建

## 场景

目标 Webhook 使用 query 签名、对称加密外层和解密后的业务 JSON。官方文档可能由前端 动态加载，页面标题、目录和正文接口还会独立更新。此时密码学向量通过不代表业务事件 映射正确，必须分别验证传输封装、明文结构、业务字段和响应语义。 映射正确，必须分别验证传输封装、明文结构、业务字段和响应语义。 映射正确，必须分别验证传输封装、明文结构、业务字段和响应语义。 映射正确，必须分别验证传输封装、明文结构、业务字段和响应语义。

## 输入信号

- URL query 包含 signature、timestamp、nonce 和密文。
- POST body 只有 `encrypt` 等外层字段，真实事件需要解密后才能解析。
- 明文包含平台枚举，但内部框架使用另一套枚举名称。
- 某字段既可能被误认为消息类型，也可能只是消息上的可选嵌套对象。
- 官方要求 HTTP 200 空包，而相似平台习惯返回 `success` 文本。
- 回调包含一次性回复 URL 或短时媒体 URL，不应进入长期事件和日志。

## 方法

### 1. 固定官方正文

记录官方 URL、文档 ID、标题、抓取日期和正文中的实际 JSON。动态文档站点应验证页面 请求的正文接口，不只依赖搜索摘要或旧版截图。 请求的正文接口，不只依赖搜索摘要或旧版截图。 请求的正文接口，不只依赖搜索摘要或旧版截图。 请求的正文接口，不只依赖搜索摘要或旧版截图。

企业微信文档当前可通过页面使用的接口读取正文：

```powershell
$docId = 57141
$headers = @{
  'User-Agent' = '<normal browser user agent>'
  'Referer' = "https://developer.work.weixin.qq.com/document/$docId"
  'Origin' = 'https://developer.work.weixin.qq.com'
  'X-Requested-With' = 'XMLHttpRequest'
}
Invoke-RestMethod `
  -Method Post `
  -Uri 'https://developer.work.weixin.qq.com/docFetch/fetchCnt' `
  -Headers $headers `
  -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' `
  -Body "doc_id=$docId"
```

该接口属于文档站点实现细节，可能变化；失效时回到浏览器 Network 重新定位，不能把 旧响应永久当作当前官方契约。 旧响应永久当作当前官方契约。 旧响应永久当作当前官方契约。 旧响应永久当作当前官方契约。

### 2. 分层建立结构

按实际边界分别定义类型：

```text
HTTP query/body
  -> signature verification
  -> AES plaintext frame
     random(16) || uint32_be(length) || message || receive_id
  -> business JSON
     common identity fields
     msgtype discriminator
     type-specific payload
     optional nested fields
```

不要用递归 `map[string]any` 猜所有字段。已知官方结构优先建 typed struct；未知类型只做 明确的忽略或保留策略。 明确的忽略或保留策略。 明确的忽略或保留策略。 明确的忽略或保留策略。

### 3. 显式转换枚举

外部字段名相同不代表内部语义相同。例如官方会话枚举 `single/group` 与内部 `private/group` 不一致，应通过单独的规范化函数转换。若单聊不返回 `chatid`，需按 业务契约选择稳定的本地会话标识，并为该规则写测试。 业务契约选择稳定的本地会话标识，并为该规则写测试。 业务契约选择稳定的本地会话标识，并为该规则写测试。 业务契约选择稳定的本地会话标识，并为该规则写测试。

禁止直接把外部字符串写入内部 `MessageType` 后再期待下游识别。

### 4. 区分 discriminator 和可选对象

先从官方样例确认哪个字段控制消息类型。若顶层 `msgtype` 为 `text` 或 `mixed`，而 `quote` 与 `text`/`mixed` 并列，则 `quote` 是可选引用对象，不是 `msgtype=quote`。 `msgtype=quote`。 `msgtype=quote`。 `msgtype=quote`。

引用对象应再次按自己的 `quote.msgtype` 解码，然后写入明确的内部元数据字段。测试 必须使用官方层级，不能用自创 JSON 证明自创解析器正确。 必须使用官方层级，不能用自创 JSON 证明自创解析器正确。 必须使用官方层级，不能用自创 JSON 证明自创解析器正确。 必须使用官方层级，不能用自创 JSON 证明自创解析器正确。

### 5. 严格执行响应语义

“HTTP 200”“空包”和文本 `success` 是三种不同契约。官方要求空包时应返回状态 200 且 body 长度为零；若需要被动回复，则按官方明文协议重新加密，不能直接返回明文 JSON。 且 body 长度为零；若需要被动回复，则按官方明文协议重新加密，不能直接返回明文 JSON。 且 body 长度为零；若需要被动回复，则按官方明文协议重新加密，不能直接返回明文 JSON。 且 body 长度为零；若需要被动回复，则按官方明文协议重新加密，不能直接返回明文 JSON。

测试同时断言状态码和响应体长度。

### 6. 隔离短期敏感字段

一次性 `response_url`、短时媒体 URL、签名密文和密钥只在完成当前协议操作所需的最短 生命周期内存在。业务桥接不使用时，不解析、不写入 Event、不记录日志，也不暴露到 状态接口。 状态接口。 状态接口。 状态接口。

## 操作链

```text
抓取当前官方正文
  -> 提取完整 JSON 样例和字段表
  -> 标注 common/discriminator/payload/optional fields
  -> 验证签名和解密固定向量
  -> 实现外部枚举到内部枚举的显式转换
  -> 使用官方样例编写解析测试
  -> 增加缺字段、未知类型、空包和重复回调测试
  -> 扫描下游字段消费者
  -> 更新能力矩阵、部署教程和风险边界
```

## 常见误判

| 误判                                          | 校正                                          |
| --------------------------------------------- | --------------------------------------------- |
| AES 解密成功就代表回调实现完成                | 继续核对业务 JSON 和 HTTP 响应契约            |
| 外部 `single` 可以直接写入内部 `private` 字段 | 使用显式枚举映射并测试缺失 `chatid`           |
| JSON 中有 `quote` 就实现 `msgtype=quote`      | 查看顶层 discriminator；可选对象独立解码      |
| 相似平台返回 `success`，当前平台也这样做      | 以当前官方“空包/加密回复”要求为准             |
| 把官方样例改成方便解析的形状再写测试          | fixture 必须保持官方字段层级                  |
| 保存 `response_url` 便于以后回复              | 先验证次数和时效；不使用时不进入事件          |
| 只改 parser，不检查 Router 消费字段           | 追踪 `quote_text`、会话类型和会话 ID 到发送端 |

## 工具映射

| 阶段         | 工具                                 | 用途                                               |
| ------------ | ------------------------------------ | -------------------------------------------------- |
| 官方正文取证 | Browser Network、`Invoke-RestMethod` | 获取动态加载的当前正文                             |
| 字段检索     | `rg`                                 | 扫描枚举、JSON tag、元数据消费者和所有测试 fixture |
| 密码学验证   | 语言标准库、官方固定向量             | 校验 SHA、AES-CBC、PKCS#7 和 frame 长度            |
| 业务解析     | typed JSON decoder                   | 保持字段层级和类型约束                             |
| 回调测试     | `httptest` 或等价工具                | 验证 GET、POST、空包、重复回调和错误状态           |
| 全链检查     | 单元测试、集成 smoke                 | 验证 Callback -> Event -> Router -> Outbound       |

## 验证标准

1. 官方样例中的字段名和嵌套层级可直接被测试 fixture 使用。
2. 所有外部枚举都有显式内部映射，未知值返回明确结果。
3. 可选引用字段能走通到下游实际读取的元数据键。
4. GET 验证返回精确明文；无需回复的 POST 返回 HTTP 200 且 body 为空。
5. 错签名、错 padding、错长度和错 receive ID 均被拒绝。
6. 重复消息不会重复进入业务队列。
7. 一次性 URL、密钥和完整密文不进入日志、Event 或状态接口。
8. 离线官方样例、真实回调和长期运行结果分别标记，不互相替代。
