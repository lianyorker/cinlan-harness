# Magpie 脱敏机制分析与 dsh 接入可行性

> 调研日期：2026-11-16
> 调研状态：只分析，不实现
> 源码基线：github.com/yetone/magpie（浅克隆 main，commit 见仓库）

## 1. 结论摘要

Magpie 的脱敏（Settings → Privacy → Masking）是一套 **网关中间件层的请求/响应双向占位符替换系统**，核心特征：

1. **插入位置**：gateway 出站请求（发给 vendor/provider 之前）与入站响应（返回 agent 之前），通过 `gwmw.Masker` 接口收口，**fail-closed**（设置要求脱敏但没有 masker 服务时，请求直接不发）。
2. **占位符格式**：`{{KIND_xxxxxxxx}}`，KIND 是大写类别（`API_KEY`、`PASSWORD`、`EMAIL`、`SECRET`…），后缀是 `HMAC-SHA256(kind + "\x00" + value)` 前 8 字节的 base32 小写。**同一 value 永远映射同一占位符**（跨请求稳定，靠进程内 map + 可选磁盘 key）。
3. **识别引擎三路并行**：本地 NER 模型（AstrLink Guard，37MB int8 ONNX token 分类器，CPU/CoreML，模型文件从 HuggingFace 下载、sha256 校验）+ 规则引擎（RE2 正则 + 上下文谓词，覆盖 sk-/ghp_/AKIA/Cloudflare/JWT/中文"密码："等几十类）+ 用户自定义（词表 words、规则 rules、允许名单 allow）。
4. **响应还原**：response writer 包装器逐 SSE 事件扫描，把占位符换回原值；分块跨 boundary 的占位符会 hold 到下一 chunk 再切，不会截断输出。
5. **可观测性**：`maskrec` 独立记录（不落盘明文值，只记 placeholder/kind/finder/hint/长度/位置计数），按天分文件 jsonl 存储、30 天/100MB 滚动清理、zstd 压缩缓存最近 100 条完整请求。

dsh 接入判断：

| 方案 | 可行性 | 说明 |
|---|---|---|
| A. llm/stream waterfall 监听 | **可行，推荐起点** | dsh 已有 `ctx.waterfall('llm/stream', ...)` 全局拦截点，不动 core；但 LOOP 请求 frozen 只读，需要在 listener 里做 detached copy 后改写再传给 next |
| B. 独立 adapter 包装 | 可行，但侵入大 | 每个 provider adapter 都要包一层，违背 all-plugin 架构 |
| C. magpie 式独立网关 proxy | 不推荐 | dsh 已有 provider 抽象，无需再加网络层 |
| D. session log 落盘前脱敏 | 错误层 | 破坏 replay/审计，只有"日志剐蹭"才用 |

**核心判断：原生抄不可行**（magpie 是 Go + ONNX Runtime + 自研 C++ inference server；dsh 是 Node/TS）。**抄设计 + JS 重写引擎是正解**：正则规则层可近乎 1:1 移植，NER 模型层用 onnxruntime-node 加载同一 AstrLink Guard 模型做 token 分类。

## 2. Magpie 脱敏链路拆解

### 2.1 模块地图

```
plugins/redact        → 插件壳：读 settings，注册 Masker 到 gwmw（fail-closed 注册点）
internal/gwmw         → gateway 中间件抽象：Masker/Agent 双插槽、Safely panic 兜底
internal/masking      → Masker 实现组装层：settings → Options、模型等待策略
internal/redact       → 脱敏引擎核心：
  redact.go           → 规则表 + span 合并 + placeholder 内存表
  rules.go            → 用户自定义规则（prefix/regex 两种，RE2）
  json.go             → JSON 结构感知遍历（kept keys、sealed signature、tool args）
  known.go            → 已知值缓存（再次出现直接换占位符）+ q-gram 索引
  model.go            → NER 模型输出 → span 的适配 + 噪声过滤（madeID/wordsOnly/depAt 等）
  writer.go           → 响应流还原 writer（SSE 事件感知，跨 chunk hold）
  shape.go            → 可选"形状替身"模式：发一个同形状假密钥而非占位符
  zhname.go           → 中文姓名识别（配合模型 NamesByModel）
  scrub.go            → 日志/归档剐蹭（与请求脱敏独立）
internal/pii          → 本地模型运行时：
  astrlink.go         → AstrLink Guard（37MB int8 ONNX，进程内 ONNX Runtime）
  pii.go              → Privacy Filter（OpenAI 1.6GB GGUF，独立 pf-serve 进程）
  find.go/cache.go    → 文本分块、12KB chunk、LRU 结果缓存、跨请求增量
internal/maskrec      → 脱敏观测记录（Insights → Masking 页数据源）
```

### 2.2 请求出站脱敏流程

```
agent 请求 → gateway → gwmw.Masking(wanted) 选 masker（fail-closed）
  → Masker.JSONHitsContext(ctx, body)
    → optionsCtx: settings → redact.Options{Secrets,Personal,Words,Rules,...}
    → 模型未装则 fetch（每小时限一次）
    → redact.MaskJSON(body, o)
      → scan(body): 找 sealed signature 对象 / tool args / defs（tools schema 等结构定义）
      → 对每个 JSON string 值：
          unescapedView → ruleSpans（正则+marker 预筛）→ modelSpans（NER）→ knownSpans（已 mask 过的值）
          → span 合并去重（相同 value 同占位符）→ Actions(warn/block) 处理 → put() 替换
      → o.Seen(hit) 回调 → hits
  → maskrec.Hold(record) 落观测记录
  → 发给 vendor
```

关键设计细节：

- **JSON 感知白名单**：`kept` keys（signature、id、url、model 等 vendor 校验字段）不脱敏；sealed 对象整体跳过（thinking signature 等）；tool call `arguments` 内部不认 vendor key 名只认值形态；defs（tools/schema）只 mask description。
- **中文/多语言**：CJK 字段名规则（密码：、密钥为）、中文姓名 zhname、邮箱/身份证/银行卡（luhn）本地化规则全套。
- **等值性**：同 value → 同占位符（HMAC 确定性），跨请求记忆（known.go 的 q-gram 索引 + sentSpans 每 route 缓存），下一 turn 重复历史不会退化成新占位符。
- **容量控制**：进程内 max 200k 占位符，LRU 淘汰一半；记录文件 30 天/100MB。

### 2.3 响应入站还原流程

```
vendor SSE → redact.Writer 包装 http.ResponseWriter
  → Write(): 缓冲，首个字节判断 content-type（binary 直接透传）
  → SSE: splitEvent → event(name, data)
    → data 内扫描占位符正则 → values map 查回原值 → 替换
    → 跨 chunk boundary 的占位符：hold 到下一 chunk 拼接再切（holding 逻辑）
    → finish/错误事件也还原后写出
  → Restored(key, put) → 回写 maskrec 的 Back 计数
```

### 2.4 本地模型层

- **AstrLink Guard**（默认，CPU 轻量）：int8 ONNX token classifier，进程内 ONNX Runtime，37MB 从 HuggingFace 拉，files pinned sha256。吞吐约 6KB/s（Linux 8 核）；magpie 用 12KB chunk + **跨请求增量缓存**（同一会话历史重复部分不重扫）+ 并发信号量（guardTurn，最多 Cores() 并发）缓解。
- **Privacy Filter**（可选重方案）：1.6GB GGUF，独立 C++ pf-serve 进程（GPU Metal/Vulkan，进程隔离防 GPU 崩溃带走网关）。
- **等待策略**（magpie 踩坑后的精华）：
  - 用户显式开启：strictWait 15s，超时则"模型已读部分 + 规则补扫"放行；模型连续落后（behind 标记 1 分钟内）降级到 defaultWait 2s。
  - 默认开启：defaultWait 2s，超时规则补扫放行。
  - 模型失败 panic → Safely 兜底 → fail-closed（用户开启时请求 held back，不发未脱敏内容）。

### 2.5 观测记录层

- Record 只存 placeholder/kind/finder/head(首字符)/len/位置计数，**不存明文值**。
- 按天 jsonl + zstd 压缩最近 100 条完整请求（内存），SentMax 4MB/条。
- Snips：每个 value 第一次出现位置的上下文片段（仅内存）。
- Restored 计数：回复中出现并换回的占位符次数（对应截图"回复里没有要换回的"）。

## 3. dsh 侧对应结构

### 3.1 现有架构

dsh 的 LLM 出站链路：

```
agent loop → LlmRuntime.stream(options) → ctx.waterfall('llm/stream', options, adapterStream)
  → adapter(llm-deepseek / llm-pi-ai …) → provider HTTP
```

- `llm/stream` 是 waterfall 事件，可注册多个 listener 依次包装，每个可调用 `next()` 下传。
- `GenerateOptions.messages` 是 provider 中立 `RequestMessage[]`（text/reasoning/file/image/tool-call blocks）。
- **LOOP-built 请求 deep-frozen**（`markAgentLoopRequest` + `deepFreeze`），事件文档明确"listeners read it, never rewrite it"——这是为 session log reconstructability 保证的。

### 3.2 接入点对比

| 接入点 | 出站改写 | 入站还原 | frozen 约束 | 评估 |
|---|---|---|---|---|
| `llm/stream` waterfall listener | options 副本改写后传 next | yield chunk 前映射占位符→原值 | 副本可绕过（克隆后改） | **首选** |
| adapter 层包装 | 每个 adapter 自行改 | 每个 adapter 自行改 | 无 | provider 数量多时维护成本高 |
| LlmRuntime.stream 内部 | 需改 core | 需改 core | — | 违背 all-plugin |
| session log 写入前 | — | — | — | 破坏 replay，否决 |

推荐：**新增 plugin（如 `dsh-redaction`）注册 `llm/stream` waterfall listener**。

1. 出站：读 `options`（frozen 原件），`structuredClone` 出可写副本，对 messages 里所有 text/reasoning block 文本执行 mask，对 tool-call arguments 字符串（JSON）执行结构感知 mask，改写副本后 `next(maskedOptions)`。
2. 入站：包住 `next()` 返回的 AsyncIterable，对 `text-delta`/`reasoning-delta`/`tool-call-delta` 的 chunk 文本做占位符→原值替换。跨 chunk boundary 需要缓冲策略（magpie writer.go 的 hold 逻辑可参考）。

注意事项：

- **tool-call-delta 流式 JSON 参数**：模型流式输出 tool arguments 时占位符可能跨 delta 边界，替换器必须带状态；等 tool-call block-end 后对完整 arguments 做一次终检更稳。
- **frozen 约束绕过是否合规**：waterfall 文档说 listener "read it, never rewrite it"，但其语义是防止 mutation 破坏 session log 重建；做副本改写不违反 reconstructability（原 log 里存的仍是原文）。若团队规范严格，需在 plugin 文档中显式声明这个例外并评审。
- **同 chain 多 listener 顺序**：mask listener 应注册在最外层（先于其它 middleware 改写），还原 listener 自然在其内侧 yield 顺序上最后执行（还原后的 chunk 才到达 agent loop）。

### 3.3 dsh 里现有可复用件

- `artifact` 包已有 `ArtifactRedaction` 类型（artifact 层有 redaction 概念），但与请求出站脱敏不是一回事，不共享实现。
- `packages/llm/llm/src/content.ts` 的 `fileHandleText`（文件投影为 handle 文本）证明 dsh 已有"敏感内容在出站前替换为引用"的先例（file/image block → 文本投影），模式上与占位符脱敏同构，可参考其投影时机与测试方式。

### 3.4 脱敏详情页：conversation.view 新 tab（轨迹旁）

需求：settings 配置脱敏后，聊天框顶部 tab 区（轨迹旁边）出现"脱敏"tab，点开看每次请求的脱敏详情（对应 magpie 观测 → 脱敏详情页）。

#### 挂载机制（已验证现成）

聊天框顶部 tab 就是 `conversation.view` slot。trajectory 自己就是这个模式：`packages/client/ui-trajectory/src/client/index.ts` 通过 `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'trajectory', order: 10, ... }, TrajectoryView))` 注册。

新 tab 做成独立 client plugin（建议命名 `ui-redaction-inspector`，避免与现有 `ui-secret-mask` 混淆——后者是显示层遮盖，见下）：

```ts
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'redaction',
  order: 15,          // 排在 trajectory (10) 旁边
  locale: NS,
  label: () => t('view.redaction'),
  inject: (sessionId) => ({ ... }),   // 绑定记录数据源
}, RedactionView))
```

#### "settings 配置了才显示"两种做法

| 做法 | 位置 | 优劣 |
|---|---|---|
| **A. UI 层过滤（推荐）** | `ui-conversation/src/client/apply.ts` 的 `viewTabs()` 汇总处（约 215 行），`entry.options.id === 'redaction'` 且脱敏未启用（§8.2 的 `secrets`/`personal`/`words` 全关或 `records` 关，走 settings 快照订阅）时 `continue` | settings 开关即时生效；复用 developerTools 对 trajectory 的 gating 模式（215 行现成写法）+ subscribe 刷新（258 行模式） |
| B. plugin 条件自挂载 | redaction client plugin apply 时读 settings 快照决定是否 `slots.inject` | 不动 conversation 核心，但 settings 切换需 plugin reload 才生效，体验差 |

选 A。代价是 `ui-conversation` 增加 4–6 行 gating 逻辑，模式与 developerTools/trajectory 完全同构（gating 集中在 `viewTabs()` 一处、subscribe 驱动刷新），评审成本低。

#### 数据链路

magpie 的脱敏详情数据来自 `maskrec`（host 侧内存 + 按天落盘）。dsh 对应链路：

```
llm/stream waterfall listener（host 脱敏插件）
  → 每次 mask 产出 Record{ placeholder, kind, finder, 位置(message index), 替换处数, 耗时 }
  → host 侧 redactionRecords 服务（内存环形缓冲，不含明文值）
  → SDK/typert 暴露给 client
  → ui-redaction-inspector 按 sessionId 过滤展示
```

对应 magpie 截图的流程链（"收到 126KB → 发现 5 个值（本地模型+规则+你的词，2.1s）→ 替换 12 处 → 回复里没有要换回的"），dsh 侧就是一次 `llm/stream` 调用的出站 mask 统计 + 入站 restore 统计，天然按 session/turn 聚合：

- turn 摘要行：请求大小、发现值数（按 finder 分：规则/模型/词表/已知值）、替换处数、耗时。
- 值列表：每个值的 kind、finder、placeholder、首次出现位置（`messages[i].content[j]`）、出现次数、回复中是否还原及次数。
- 详情展开：该值上下文片段（magpie 的 Snips 模式，仅内存）。

#### 视图形态

复用 trajectory 的技术形态：`TrajectoryTable` 的表格/分组模式 + 虚拟行（`trajectory-virtual-rows.ts`）应对长会话多请求。不新建渲染基础设施。

#### 与 ui-secret-mask 的边界（命名理由）

现有 `packages/client/ui-secret-mask` 是**显示层**遮盖：聊天消息里已识别的凭证画成 `sk-abc***`（保前 8 位 + 星号），可点眼睛控制显示，**不改变发给模型的内容**（README 明确 "the model input keep the original characters"）。与本方案的出站占位符脱敏是两件正交的事：

- ui-secret-mask = 给人看的（防肩窥/截图泄露）
- 本方案 = 给 vendor 看的（防上游留存敏感数据）

所以新包命名为 `ui-redaction-inspector`（或 `ui-redaction-details`），不叫 `ui-secret-mask-*`，避免后续维护者混淆两套机制。

## 4. 移植可行性

### 4.1 规则引擎（可直接移植）

magpie 的 rules 是纯正则 + 谓词函数（`ok: secretValue`、`at: fieldAt` 等），无 Go 特有依赖。JS 里用标准 RegExp + 自写谓词即可，工作量在于：

- 移植规则表（API key 前缀库、email/phone/ID/银行卡/CJK 规则，约 40+ 条）。
- 移植谓词（notASlug、secretValue、luhn、chineseID、emailAt、wholeWord 等，都是纯函数）。
- marker 预筛优化（lazyre + marker 字符串预筛，避免全文跑全部正则）。

### 4.2 NER 模型层（可行，需要选型）

AstrLink Guard 是 ONNX 模型 + tokenizer.json，Node 侧选项：

| 方案 | 优劣 |
|---|---|
| onnxruntime-node + HF tokenizers JS | 与 magpie 等价；需要打包模型文件分发（37MB）或首启下载 |
| transformers.js（内含 onnxruntime wasm） | 纯 JS 分发友好，但 CPU 吞吐更低 |
| 不做 NER，只做规则 + 用户词表 | MVP 可行，牺牲"自由文本中的姓名/地址"识别 |

建议 MVP 先规则层，NER 作为 v2（独立 plugin 或 feature flag）。

### 4.3 不可直接移植的

- redact.Writer 的 SSE hold 逻辑依赖 Go http.ResponseWriter 接口；JS 侧对应 AsyncIterable transform，需重写但逻辑可照搬。
- maskrec 的文件结构（按天 jsonl + zstd）可用，但 dsh 有自己的 storage/session 体系，观测记录建议走 dsh 自有 telemetry 包。

## 5. 工作量估算

| 阶段 | 内容 | 估算 |
|---|---|---|
| P0 核心引擎 | 占位符生成（HMAC + 内存表）、规则表移植、span 合并、出站 mask + 入站 restore、跨 chunk 缓冲 | 3–5 人日 |
| P0 测试 | golden 测试（magpie eval_cases_test.go 的用例可搬作 fixture） | 1–2 人日 |
| P1 集成 | `llm/stream` waterfall plugin、settings 页、frozen 副本改写合规审查 | 2–3 人日 |
| P1 结构感知 | JSON kept-keys、tool args JSON、tool-call arguments 流式还原 | 2–3 人日 |
| P2 NER | onnxruntime-node 集成、AstrLink Guard 模型加载、分块/缓存/wait 策略 | 5–8 人日 |
| P2 观测 | maskrec 等价记录（不含明文）、`ui-redaction-inspector` 详情 tab（§3.4）、`ui-conversation` gating | 3–5 人日 |

总计：MVP（P0+P1 集成）约 **8–13 人日**；全量（含 NER + 观测）约 **16–26 人日**。

## 6. 关键风险

1. **流式 tool arguments 还原**：占位符跨 delta 切割是最大正确性风险，必须带 hold 缓冲，参考 magpie writer.go 的 `holding()/release()` 状态机。
2. **等值性 + 会话历史**：同 value 跨 turn 稳定占位符靠进程内 map；dsh 重启后 map 丢失，占位符变化会导致 vendor 端 prompt cache 不命中 + 模型看到不一致上下文。magpie 用磁盘 key（HMAC key 持久化）保证跨重启稳定——**dsh 必须同样持久化 HMAC key**，否则 prompt cache 全失效。
3. **frozen request 例外**：需要设计评审确认"listener 副本改写"不违反 reconstructability 契约。
4. **fail-closed 语义**：dsh 的 llm/stream waterfall listener 抛错时行为如何，需要明确 masker 失败 = 拒绝请求的语义，不能静默放行未脱敏请求。

## 7. 参考文件索引

Magpie（`C:\Users\ASUS\AppData\Local\Temp\magpie-analysis-full`）：

- `plugins/redact/redact.go` — 插件注册、fail-closed
- `internal/gwmw/gwmw.go` — Masker 抽象、Safely
- `internal/masking/masking.go` — options 组装、模型 wait 策略
- `internal/redact/redact.go` — 规则表 + 占位符 HMAC
- `internal/redact/json.go` — JSON 结构感知遍历、kept keys
- `internal/redact/writer.go` — SSE 流式还原、hold 状态机
- `internal/pii/astrlink.go` — AstrLink Guard 模型运行时
- `internal/maskrec/maskrec.go` — 观测记录

dsh（`apps/cinlan-harness`）：

- `packages/llm/llm/src/index.ts` — `llm/stream` waterfall、LlmRuntime.stream
- `packages/llm/llm/src/call-config.ts` — markAgentLoopRequest、frozen 语义
- `packages/llm/llm/src/types.ts` — GenerateOptions、RequestMessage、StreamChunk
- `packages/llm/llm/src/assembler.ts` — BlockAssembler（tool-call arguments 累积逻辑参考）
- `packages/client/ui-trajectory/src/client/index.ts` — conversation.view slot 注册模式（§3.4 tab 挂载参照）
- `packages/client/ui-conversation/src/client/apply.ts` — viewTabs() gating（developerTools 对 trajectory 的写法，§3.4 settings gating 参照）
- `packages/client/ui-secret-mask/README.md` — 显示层遮盖与本方案的边界（§3.4）

## 8. 完整实现方案（提案，待评审）

> 本章是产品级方案：对齐 magpie 的两个页面（设置 → 隐私、观测 → 脱敏详情），
> 落到 dsh 的现有机制上。只设计，不实现。

### 8.1 产品形态总览

```
┌─ Settings ──────────────────────┐    ┌─ 聊天框顶部 tab ─────────────────┐
│ 安全研发 → 脱敏（settings 页） │    │ [聊天] [轨迹] [脱敏] ← 新 tab    │
│  · 总开关（密钥/个人信息/词）   │    │  · 按请求列出脱敏流程链         │
│  · 自定义词/规则/允许名单       │    │  · 值级详情（finder/位置/还原） │
│  · 动作（脱敏/警告/拦截）       │    │  · settings 未开启时不显示       │
│  · 本地模型（v2）               │    └──────────────────────────────────┘
└─────────────────────────────────┘
```

对应 magpie 的映射关系：

| magpie | dsh 落点 |
|---|---|
| Settings → Privacy（脱敏开关、规则、词表、模型） | settings `settings.section` 新 section "脱敏"（groupId: security） |
| Insights → Masking（脱敏详情页） | `conversation.view` 新 tab `redaction`（§3.4） |
| 观测记录（maskrec） | host 侧 `redactionRecords` 服务（8.4） |
| AstrLink Guard 本地模型 | v2，onnxruntime-node（§4.2） |

### 8.2 Settings 设计

#### 配置 schema（新 host plugin `dsh-redaction` 的 Config）

```ts
/** 出站脱敏设置。 */
export interface Config {
  /** 密钥类脱敏：API key、私钥、token、密码。 */
  secrets: boolean
  /** 个人信息脱敏：邮箱、电话、证件号、银行卡。 */
  personal: boolean
  /** 个人信息细分开关（personal 开启时生效）。 */
  kinds: Record<'EMAIL' | 'PHONE' | 'ID_CARD' | 'BANK_CARD', boolean>
  /** 用户自定义词：项目代号、内部主机名等。 */
  words: string[]
  /** 用户自定义规则（prefix 或 regex 二选一）。 */
  rules: Array<{ kind: string; prefix?: string; regex?: string }>
  /** 允许名单：整值放行，任何 finder 命中都不脱敏。 */
  allow: string[]
  /** 按类别覆盖动作：'warn' 照发仅记录，'block' 脱敏并拦截请求。 */
  actions: Record<string, 'warn' | 'block'>
  /** 脱敏详情 tab 显示（记录服务开关；关掉则不记录、tab 隐藏）。 */
  records: boolean
}
```

默认全关（`secrets: false, personal: false`，dsh 现状行为不变）；`records` 默认 true（开关一开就有观测）。**不学 magpie 的"默认开启本地模型"**——dsh 是开发工具不是隐私网关，默认改动出站内容需要用户显式同意。

#### settings 页注册（复用 ui-settings-security 模式）

```
ctx.settingsMetadata.registerSection({ sectionId: 'redaction', groupId: 'security', ... })
ctx.settingsMetadata.registerItems('redaction', [
  { id: 'redaction-master', ... },      // 总开关组
  { id: 'redaction-words', ... },       // 自定义词
  { id: 'redaction-rules', ... },       // 自定义规则编辑器
  { id: 'redaction-allow', ... },       // 允许名单
  { id: 'redaction-records', ... },     // 观测记录开关
])
ctx.slots.register({ name: 'settings.section', id: 'redaction', order: 72, ... }, RedactionSettingsSection)
```

每项设置对照 magpie 的 Settings → Privacy（截页面自上而下）：

| magpie 设置项 | dsh Config 字段 | 备注 |
|---|---|---|
| 脱敏记录 | `records` | |
| 脱敏密钥 | `secrets` | |
| 保守密钥格式 | （规则表内置，不暴露） | magpie 也不暴露 |
| 脱敏个人信息（SSN/护照/IBAN/生日/MAC） | `personal` + `kinds` | dsh 首批只做 EMAIL/PHONE/ID_CARD/BANK_CARD，本地化对齐 |
| 你的词（words） | `words` | 大小写敏感/全词匹配两个修饰（`WordsAnyCase`/`WordsWhole`，magpie 同名）v2 再加 |
| 用本地模型查找 | v2 | MVP 明确标注"仅规则引擎" |

#### 预览框（对齐 magpie 的试一试）

settings 页放一个"预览"输入框：粘贴任意文本，实时显示脱敏结果 + 命中列表（finder/kind/占位符），不进 placeholder 内存表（magpie `Preview` 的 no-remember 语义）。这是用户信任脱敏的关键交互，成本一个纯前端组件 + 复用规则引擎。

### 8.3 脱敏详情 tab 设计

#### 顶部：请求流程链（对齐 magpie 详情页头部）

当前 session 每次经过 `llm/stream` 的模型调用一行（倒序，最新在上）：

```
┌────────────────────────────────────────────────────────────────────┐
│ #42  14:32:07  deepseek-chat  126 KB                               │
│ 收到 → 发现 5 个值（规则 2 · 模型 0 · 你的词 1 · 已知 2）· 2.1s    │
│      → 替换 12 处 → 发送 → 回复中还原 0 处                         │
└────────────────────────────────────────────────────────────────────┘
```

数据全部来自该次调用的出站 mask 统计 + 入站 restore 统计（§3.4 数据链路）。

#### 展开：值级列表（对齐 magpie 侧栏）

点击一行展开该请求的值列表，每值一行：

| 列 | 内容 | 来源 |
|---|---|---|
| 值 | 占位符（如 `Ryan Gosling`）+ hint（首字符/长度） | Record |
| 类别 | kind 徽标（API_KEY / EMAIL / …） | Record |
| 查找方式 | finder 徽标：规则 / 你的词 / 模型 / 已知值 | Record |
| 位置 | `messages[0].content[0].text` | mask span 的 JSON path |
| 出现 | 3 处 | Record.N |
| 回复 | 还原 2 处 / 未出现 | restore 统计 |

**不显示明文值**（对齐 magpie：Record 永远不含 value，hint 只到首字符 + 长度）。值内容只存在于 host 内存表（占位符 ↔ 原值映射），供响应还原用。

#### 交互细节

- **blocked 请求**：流程链行标红 + "已拦截"徽标（`actions: 'block'` 命中时该请求不外发）。
- **warn 值**：黄色徽标"已照发"（该值按设置仅记录未脱敏，用户自查用）。
- **筛选**：按 finder / kind 筛选值列表；按 provider/model 筛选请求行。
- **清理**：清空当前 session 记录按钮（magpie `Clear` 语义）。

### 8.4 包结构与数据流

```
packages/
  llm/redaction/                    # host 侧（新包组，对齐 llm/ 目录惯例）
    redaction/                      # 核心引擎（P0）：规则表、占位符、span 合并
    redaction-plugin/               # llm/stream waterfall listener + Config + 记录服务
  client/
    ui-redaction-inspector/         # conversation.view tab（§3.4）
    ui-settings-redaction/          # settings section + 预览框
```

数据流：

```
agent loop → llm/stream waterfall（redaction-plugin）
  ├─ 出站：structuredClone(options) → mask(messages, tools) → next(masked)
  │        └→ Record{ sessionId, turn, placeholder[], kind[], finder[], spans, took }
  │            → redactionRecords 服务（内存环形缓冲，默认 1000 条/session，不含明文）
  └─ 入站：包 AsyncIterable → text/reasoning/tool-call delta 还原
           └→ restore 计数回写对应 Record

client（ui-redaction-inspector）
  └→ SDK 订阅 redactionRecords（按 sessionId 过滤）
     → 流程链 + 值列表渲染
```

记录的存储边界（对齐 magpie maskrec 的取舍）：

- **内存**：占位符 ↔ 原值表（还原必需，HMAC key 持久化保证跨重启稳定，§6.2）+ 当前 session 记录。
- **不落盘**：MVP 记录只存内存，dsh 重启即清。magpie 的按天 jsonl 落盘是网关多用户场景的需求，dsh 单用户桌面场景内存够用；后续要持久化走 dsh storage 包，格式不含明文。

### 8.5 分期与验收

| 期 | 交付 | 验收标准 |
|---|---|---|
| P0 引擎 | `packages/llm/redaction/redaction`：规则表（§4.1 移植清单）+ 占位符 + golden 测试 | magpie eval_cases 用例移植通过率 ≥ 95%（剩余用例标注 CJK/模型专属） |
| P1 通路 | redaction-plugin（waterfall + Config + records 服务）+ settings 页 + 详情 tab | 端到端：settings 开 → 发含 sk- key 的消息 → vendor 侧收到占位符 → 回复正常；settings 关 → tab 消失、请求原样 |
| P2 打磨 | kinds 细分、words 修饰符、allow/actions 完整 UI、预览框 | 预览框结果与实际出站一致（同一引擎跑两处） |
| v2 模型 | onnxruntime-node + AstrLink Guard + wait 策略（§2.4 全套） | 长会话（>100KB 历史）下 P99 延迟增量 < 3s（magpie defaultWait 同水位） |

每期都保持"settings 全关 = 零行为变化"这条不变量（含 plugin 未加载路径）。
