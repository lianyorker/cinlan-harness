# Agent Note: 存储根目录落点与派生介质恢复

Status: implemented

[English](2026-07-28-storage-root-and-derived-medium-recovery.md) | 中文

## 问题

持久投影缓存（[决策记录](2026-07-27-session-projection-and-command-log.zh.md)，已作为 `dsh-session-projection-cache` 落地）暴露了它所依托的存储基座的两个缺口。二者都是 domain-KV 栈（[设计](2026-07-24-domain-kv-storage-and-workspace.zh.md)）的属性而非缓存自身的问题，且都首先咬到缓存——因为它是这条栈上第一个*派生*介质。

**文件到底存在哪（根错位已收口，resolve-once 残余仍开放）。** 共享 base 将会话存储默认为全局 harness home（`$DSH_HOME/sessions`，默认 `~/.dsh/sessions`），而出厂 Web overlay 曾给 json 后端相对根 `./.storages`：`workspace.json` 和 `session_projcache.json` 落在 `<启动目录>/.storages/` 下——从两个不同目录启动，会话相同，工作区注册表和投影缓存却各是一份，而缓存存在的意义恰恰是跨会话冷列表，凡上次在别的启动目录下缓存过的会话全部 miss。这一错位已消除：overlay 现以与会话根同一段 `!!js` 表达式把 `storage-json.root` 锚定到 `$DSH_HOME/storages`（`apps/cli/config/web.cordis.yml`）。残余隐患：`JsonStorageBackend` 仍从不 resolve 根——每次打开 unit 都把路径 join 到当时的 `process.cwd()` 上（packages/storage/storage-json/src/index.ts）；出厂 overlay 的根已是绝对路径不受影响，但任何相对根（裸 Loader 启动、测试）仍会被后续 cwd 变化劈开，JSONL 会话后端用「构造时 resolve 一次」防住的正是它（"later process.cwd() changes cannot split one backend across roots"，packages/session/session-persistence-jsonl/src/index.ts）。

**恢复行为。** 在健康介质内部，缓存按设计完全自愈：`stateVersion` 不匹配的行被丢弃重折，日志缩短到行水位以下由带锚的 restore floor 检出并以一次全量重读回答，每次后台写都是 fail-soft。但在*介质*层面完全没有恢复：被截断、被手改或版本被 bump 的 `session_projcache.json` 会让 `openJsonUnit` 以 `malformed-medium`/`version-mismatch` 失败（packages/storage/storage-json/src/format.ts），schema 漂移的记录让域 open 以 `invalid-record` 失败（packages/storage/storage-domain/src/index.ts），拒绝一路穿过 `SessionProjectionCache[Service.init]`，在 CLI 的 fail-loud 启动下整个组装拒绝启动。一个内容完全可从会话日志重建的文件能把启动搞死。这与缓存包自己声明的立场（"a stale or unreadable cache costs a longer tail replay, never a wrong value"）和缓存域 spec 的 JSDoc（"version bumps discard the whole medium"）相矛盾——后者描述的是愿望而非实现。投影缓存半边已被[每会话缓存文件 note](../../archived/architecture/2026-08-19-projection-cache-per-session-files.md) 部分取代：全局 `session_projcache` domain 已移除，本提案的缓存恢复半边不再适用；`workspace.json` 半边仍然有效。per-record 投影缓存的 `invalid-record` 一类如今也已被取代：已发布的域声明了 `invalidRecords: 'backup-and-skip'`（[跨版本读兼容 note](2026-09-02-projcache-cross-version-read-compat.zh.md)），open 时把失败记录备份后跳过，因此下文 reset/destroy 提案仅对权威介质或单文档介质的整介质损坏仍然相关。同一条 fail-loud 路径对 `workspace.json` 却是*正确*的——工作区记录是权威数据，不可派生——所以缺的概念是按域声明权威性，而不是全局改行为。

## 决策

两个独立改动，一个缺口一个。

### 全局唯一存储根，构造时 resolve 一次

- **全局存储根**：出厂 Web overlay 通过 app-boot 提供的 `dshHomePath('storages')`，直接在 `storage-json` 行内把 `root` 锚定到 `$DSH_HOME/storages`（默认 `~/.dsh/storages`，与 `~/.dsh/sessions` 并肩；目录名不带点——home 本身已是隐藏树）。该辅助函数委托给规范的 `dsh-home-paths` 解析器，会话根也使用同一个函数，无需重复其回退和波浪号规则。最终选用按行形态（用户决定）而非「launcher patch + `storageRoot` profile 键」（见 Alternatives）；按行覆盖仍走个人 `~/.dsh/config.yaml` patch 层。web e2e scaffold 把该行 patch 到临时绝对根，测试不触用户 home。
- **构造时 resolve 一次**：`JsonStorageBackend` 在构造时对配置根 `resolve` 一次（`this.root = resolve(root)`），原样采纳 JSONL 后端已记录的理由：后续 `process.cwd()` 变化不得把一个后端劈到多个根下。SQLite 存储后端也已 resolve 其路径。
- **适用 pre-release 立场**：不做迁移垫片。曾在 `<cwd>/.storages` 下缓存过的部署要么全部重新派生（工作区从 header 索引重新 bootstrap；投影缓存惰性重折），要么手动把两个 json 文件挪一次。

### 声明派生介质：损坏时重置而非拒绝

- `DomainSpec` 增加 `recovery?: 'reject' | 'reset'`（默认 `'reject'`）。spec 对象已经是一个域的身份与布局的真源；其介质是权威还是派生属于同类事实，落在同一处。`session_projcache` 声明 `'reset'`；`workspace` 保持默认。
- `KvFacet` 增加一个原语：`destroy(descriptor): Promise<void>`——整体移除该 unit 的介质（json：删文件；sqlite：drop 该 unit 的表）。与 `open` 一样，它是后端存储原语，不是策略。
- `DomainFacility.open` 在 spec 声明 `'reset'` 且 open 恰以损坏类错误失败时——`StorageError('version-mismatch' | 'malformed-medium')` 或 `DomainError('invalid-record')`——记一条命名该域和被丢弃介质的警告，调用 `destroy`，再空开一次。其余一切失败（`backend-not-found`、`facet-unsupported`、`already-open`、I/O 错误）无论声明与否都保持大声：配置错误和环境故障不是介质损坏。重试单发——第二次失败原样传播，持续失败的介质不会成环。
- 有了这个，缓存域 spec 的 version 字段才获得其本意：bump `version`（或让 zod 拒绝漂移行）真正丢弃整个介质，缓存经正常写点和冷读重建——恢复阶梯的最外一档，与已落地的行级各档对齐。

## 备选方案

**保持按启动目录的 `.storages`（改动前现状）**——拒绝：会话是全局的，所以每个从会话派生的介质都与自己的真源劈叉；缓存的动机场景（一次列出全部会话）结构性丢行，工作区注册表索引着从另一个启动目录看不见的会话。

**launcher patch + `storageRoot` profile 键**——未采：一行 yml `!!js` 表达式即达全局根，与会话根的既有分层完全一致；launcher patch 多引入一个改写点，profile 键在有真实消费方前是空席（按行覆盖已有个人 config.yaml patch 层可用）。

**只把投影缓存的 route 指到全局根，`workspace.json` 留在 per-cwd**——拒绝：工作区注册表有一模一样的全局 vs per-cwd 错位，而且用户选择把缓存放在 `workspace.json` 旁边——一个 hub 根让介质同址、心智模型单一。

**缓存插件本地恢复（在 `SessionProjectionCache[Service.init]` 捕获损坏错误、删文件、重开）**——拒绝：插件不越过后端抽象就叫不出介质路径，且未来每个派生域都要重抄同一段 catch；facility 是唯一已经在分类 open 失败的地方。

**损坏时退到内存态临时域**——拒绝：进程余生静默降级为仅内存，损坏文件永不自愈；下次启动照样失败。

**把损坏介质改名旁置（`<unit>.json.corrupt-<ts>`）而非删除**——未选：派生介质的损坏字节没有恢复价值（日志才是真源），残骸无界累积；删除才是诚实的操作。若未来某个*权威*域想要重置语义，旁置改名才是对的——这正是 `recovery` 按 spec 声明的理由。

**所有域一律自动重置（不加 spec 字段）**——断然拒绝：`workspace.json` 是权威用户数据；版本 bump 时静默重置会毁掉工作区。权威性是域的属性，必须由其所有者声明。

## 后果

- **根稳定性**：`JsonStorageBackend` 在构造时解析其根目录，确保运行期 cwd 变化不会把 unit 文件分散到各个目录。所有标准 profile 共享 `$DSH_HOME/storages`（默认 `~/.dsh/storages`）。
- **保留权威数据安全**：域默认采用 `recovery: 'reject'`，确保像 `workspace.json` 这样的权威数据绝不会被静默清空。只有声明了 `recovery: 'reset'` 的派生域才会在损坏时触发单发 destroy-and-reopen。
- **确定性故障处理**：重置严格仅在损坏类解析错误（`version-mismatch`、`malformed-medium`、`invalid-record`）上触发。非损坏与环境故障大声传播，单发重试防范死循环重建。
- **后端契约扩充**：`KvFacet.destroy` 增加了删除 unit 介质的后端原语。它归存储 facility 内部所有，与模型或用户可触及的路径隔离。

## 测试验证

- `storage-json` 单测验证构造时根解析以及针对 single 与 per-record 两种布局的 `destroy` 操作。
- `storage-domain` 测试验证损坏类错误在 `'reset'` 域上触发单发重置，非损坏错误保持大声，`'reject'` 域在任何错误时均大声失败。
- 存储契约测试验证 `destroy` 对不存在 unit 的幂等性，以及 unit 处于打开状态时拒绝销毁。
