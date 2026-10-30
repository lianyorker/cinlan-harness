# 原生能力收口验证记录（2026-10-19）

## 当前结论（原生接入已验证，持久化迁移进行中）

核心能力的原生包归属、真实后端配置、会话选择和单一开发者设置已接入，定向验收通过；整体目标仍未全部完成，不代表发布认证或全库检查通过。保留所有既有未提交内容，没有提交、推送、发布、替代 GUI 服务或真实子代理调用。

| 能力 | 当前实现 | 已有证据与限制 |
| --- | --- | --- |
| [Auto](../../packages/guard/auto-review/README.zh.md) | 原生 guard 和 Web/Desktop 后端加载；仅当前会话显式选择，保留 EXP 提示 | Loader/权限回归与原生菜单、确认、撤回、冷恢复浏览器用例通过；持久化发布确认及真实 LLM 认证未完成 |
| [开发者设置](../../packages/client/ui-settings-general/README.zh.md) | 唯一 `developer-tools` 分区使用共享偏好，搜索/标题/Ralph/采集控件接真实配置 | 组件、真实配置保存及冷启动测试通过；当前用户 GUI 尚未刷新验收 |
| 搜索与标题 | 原生延迟内容索引与 all-prompts 标题提供者，支持实时开关 | 配置、竞态、Loader、持久化与冷启动定向回归通过；真实 API 标题未验收 |
| [Ralph](../../packages/workflow/tool-ralph/README.zh.md) | 原生 Host policy、默认关闭与轮数上限，预设内动态工具可用性 | 策略、工具和设置保存回归通过；专用任务入口与真实工作流未验收 |
| [只读 Session Inspector](../../packages/client/ui-session-inspector/README.zh.md) | 稳定客户端包、默认 Web 组合、共享开发者偏好 | Loader 和浏览器历史导航通过；完整 live-turn 录制回放仍有运行时上下文和 Windows bash 差异 |
| 高权限 Node 调试 | 独立可选「NodeJS 运行时调试」，网络采集默认关，原生设置能请求开关 | 真实 Worker/CDP 与采集生命周期回归通过；调试后端整体原生启停及跨端验收未完成 |

最终原生能力组合：61 个文件、585 项通过。权限确认及 Auto 冷恢复 Chromium 组合：2 文件、8 项通过；profile/home 路径补充回归：51 项通过。类型、所属构建、静态文案和局部 lint 通过；不是全库测试或覆盖率结果。旧 Auto/Search/Titles/Ralph 可选建议已在真实后端原生接入后移除，发布 app-boot 目录冒烟通过。

持久化检查仍 `finalized-format-changed`：已有 V4 baseline 的破坏性差异需按版本政策处理；Auto 审计事件独立分类为兼容新增。没有改写接受历史或伪造 acknowledgement。完整全库 GUI/doc-sync/workspace/release/隔离/unknown-cast 检查仍有已记录失败；手机/Host 重连、Electron/跨平台、当前用户 GUI 和真实提供方验收未完成。

以下保留各轮操作、失败与修复证据；以本节及“继续推进：持久化前置检查”为当前状态。

## 初始轮次定向测试与构建通过

命令通过 `load_workspace_dependencies` 提供的 Node/pnpm 路径执行；以下为工作区命令参数。

- `vitest run packages/bundle/web-app/tests/session-capability-defaults.spec.ts packages/client/ui-settings-general/tests/apply.client.spec.ts packages/client/ui-settings-general/tests/components.client.spec.tsx`：3 文件、24 项通过。包含真实 Loader 挂载组合中的标题行，固定 LLM 响应、自动标题日志、后续消息更新与手动命名保护。
- `vitest run packages/session/session-title-all-prompts-llm/tests/provider.spec.ts packages/session/session-title/tests/provider.spec.ts packages/session/session-title/tests/rename.spec.ts`：3 文件、16 项通过。
- `vitest run packages/session-query/session-query-sqlite/tests/query.spec.ts packages/session-query/session-query-sqlite/tests/sqlite.spec.ts`：2 文件、70 项通过。
- `tsc -b packages/client/ui-settings-general/tsconfig.client.json`：通过，不代表仓库全量 typecheck。
- `pnpm --filter @deepseek-ai/dsh-client-ui-settings-general bundle`：通过；圆角 token 修正后重新打包通过。
- `node --import tsx/esm scripts/run-oxlint.ts packages/bundle/web-app/tests/session-capability-defaults.spec.ts packages/client/ui-settings-general/src/client/DeveloperToolsRow.tsx packages/client/ui-settings-general/tests/components.client.spec.tsx packages/client/ui-settings-general/tests/apply.client.spec.ts`：0 warnings、0 errors。
- `verify-client-ui-i18n`：通过；三个本轮 README/升级指南的 `verify-translation-pairing`：通过；本轮范围 `git diff --check`：通过。

## 整体检查未通过

- `pnpm run test:gui`：31 文件失败、784 文件通过；111 项失败、11806 项通过、8 项跳过，另有 1 error、3 个失败快照。报告涉及侧栏、composer phase、重复 remote 注册、样式与快照等，未逐项完成归因。不得全部归为无关问题。新增说明区 10px 圆角已修正为共享 token；独立重跑圆角检查仍失败，但不再列出该说明区。未重新运行整个 GUI 命令。
- `pnpm run doc-sync`：退出 1，报告 30 个失败检查，涉及缺失链接、类型文档漂移、归档 hash、配对记录和 README 等。未批量改写不相关文档或更新快照掩盖差异。
- `verify-cordis-config`：已有 ACP fixture 根结构不是 Loader entry array，退出 1。
- `verify-package-dependencies`：15 项导入分类错误，报告指向 automation/sidebar-terminal 控制器和旧侧栏文件；这些文件未由本轮修改。
- `verify-upgrade-guides`：手机连接指南额外 H2 导致失败，本轮新增指南未出现在诊断中。

## Auto 审批验证补充

[Auto Loader 组合测试](../../packages/guard/auto-review/tests/loader-composition.spec.ts)修正了旧版工具结果断言和硬编码 V3 测试头，改为当前格式编码、严格恢复与再次读取。测试区分模型放行、`never` 下硬拒绝、人工批准/拒绝/取消、缺失审批通道、非法模型响应和服务失败，均验证工具执行次数与审批日志。真实 Loader 停用/重载验证 Auto 选项撤回、现有 Auto 会话迁移到 Full access/never，以及重载不自动重新选择 Auto。此迁移是既有生产行为，本轮未修改授权逻辑。

`vitest run packages/guard/auto-review/tests/auto-review.spec.ts packages/guard/auto-review/tests/loader-composition.spec.ts` 最终只读快照运行：2 文件、39 项通过。8 个 owner-local 快照已由测试生成并审查；对应组合测试 Oxlint 为 0 warnings、0 errors。本轮定向用例总数为 149（24 + 16 + 70 + 39），不包含失败的整体 GUI 检查。Auto 稳定晋升消费者已检查，包括 CLI/Web 测试依赖、profile 可选 bundle、tsconfig 引用和权限选择器；未执行包迁移或默认组合变更。

## 稳定晋升前的具体问题

- [Auto 审查请求](../../packages/guard/auto-review/src/index.ts)的发送前精确日志已由轮次 5 补齐并验证恢复；正式持久化兼容确认仍因工作树已有 V4 破坏性差异未完成，不能据此批准稳定晋升。审查输入含敏感内容，沿用 Session 存储、导出及保留策略。
- [Inspector 组合](../../packages/experimental/inspector-profile/cordis.patch.yml)的 fetch 捕获已由轮次 6 改为默认关闭；显式启用 bundle 仍启动高权限调试后端。[安全说明](../../packages/experimental/inspector/README.md#security)指出调试求值允许代码执行，显式网络捕获仍含敏感内容。稳定晋升、单一设置接入与调试授权仍未完成，不能把普通代码视图可见性开关视为授权。

## 目标轮次 1：Auto 资源限制

[Auto 实现](../../packages/guard/auto-review/src/index.ts)新增三个必填配置字段，bundle 明确提供 `maxInputBytes: 262144`、`maxOutputTokens: 1024`、`timeoutMs: 60000`。完整系统策略加封装后的用户输入按 UTF-8 合计计量，超限时不发送模型请求、不截断授权依据；输出上限传给模型提供方。期限信号覆盖异步流读取，晚到放行也不能执行工具；仍等待不配合取消的适配器结清，不宣称强制终止。已更新全部直接测试/e2e 调用、Loader fixture、manifest、tsconfig 与锁文件。[升级指南](../../docs/upgrade-guide/v0.2.1-alpha.1/auto-review-limits/guide.zh.md)说明直接配置的必填字段。

最终 `auto-review.spec.ts` 39 项加 `loader-composition.spec.ts` 9 项，共 48 项通过，快照只读运行；覆盖多字节精确边界、多一字节拒绝、输出上限传递、无效配置、配合取消的超时结清、忽略取消后的晚到放行及计时器清理。Auto 包 `tsc -b` 通过；workspace tsdown 按 Auto 包筛选构建通过；离线冻结锁文件安装补齐链接后，普通 Node 导入构建产物、验证有效配置及缺失配置拒绝通过；4 个目标文件 Oxlint 为 0 warnings、0 errors；4 组双语记录一致；范围内 `git diff --check` 通过。真实 API e2e 仅更新调用配置，未运行。

审查日志缺口已用临时回归复现，但没有引入未完成事件。新增事件前运行 `persistence-changes --check --json`，得到 `finalized-format-changed`：当前工作树相对已确认 V4 基线已有多项 source union 和 title-request 破坏性变化，检查器要求 V5 或更高；这些变化不是本轮添加。未改写已确认基线、未升级会话格式、未生成覆盖全部未知差异的兼容记录。该失败是具体证据，不代表整体目标 blocked；仍需处理审查日志与稳定组合工作。

## 目标轮次 2：自动标题原生设置

[标题服务](../../packages/session/session-title/src/index.ts)新增默认启用的实时 `automaticEnabled` 配置，沿用既有设置表单和 profile 写入。关闭时同步清除待处理自动工作、取消在途自动调用，提交前再次检查开关；不重建服务、不移除已有标题，显式 `refresh()` 仍可用，重新启用只接纳后续消息，手动名称继续固定。本轮不改变 Session 事件或格式。

[通用设置控件](../../packages/client/ui-settings-general/src/client/AutomaticTitlesRow.tsx)使用标准注入 hooks 和 revision-fenced form，按已接受的 Host 值展示；加载、只读及写入期间禁用，拒绝或传输失败保留重试提示。标题命名空间缺失时移除入口和搜索锚点，标题服务关闭重复生成页面。组件文案快照已生成审查并只读回放。

最终 `vitest run packages/session/session-title/tests packages/client/ui-settings-general/tests/apply.client.spec.ts packages/client/ui-settings-general/tests/components.client.spec.tsx packages/bundle/web-app/tests/session-capability-defaults.spec.ts`：11 文件、77 项通过。真实 Loader 回归检查 fiber UID 不变、待处理/在途取消、晚到结果拒绝、显式刷新与重开；真实 profile 编辑器测试确认补丁文件落盘、完整 Host 冷启动回读和清除覆盖恢复默认值。客户端组合测试确认命名空间准入、写入参数、已接受回读、撤回清理。

标题 Host 与设置 Client 的 `tsc -b` 通过，7 个目标文件 Oxlint 为 0 warnings、0 errors；设置包 bundle 与标题 Host 单包 tsdown 构建通过并已收集作业结果；文案归属检查通过；4 组 README/升级指南/决策记录双语配对一致；范围内 `git diff --check` 通过。未重跑已有失败的全库 GUI/doc-sync，不把本轮定向结果当作整体通过。

搜索当前仍通过 profile `openAt` 控制，Ralph 仍默认停用且没有本轮新增的原生开关。没有调用 Ralph 工具或启动子代理。两项控制仍属于后续目标，不以自动标题链路替代。

## 目标轮次 3：会话内容搜索原生设置

[SQLite 搜索服务](../../packages/session-query/session-query-sqlite/src/index.ts)新增默认启用的实时 `searchEnabled` 字段，部署 `openAt: never` 仍优先。关闭准入拒绝新请求，并在队列执行、索引打开后和对账后检查配置版本；关闭再立即重开也不能让旧请求返回结果。初始关闭时 `startup` 和 `first-search` 均不打开索引，开启后在下次搜索时打开。已有索引不删除，精确读取、过滤和追踪不受影响。已有对账可能完成，同步 SQLite 语句不能被开关强行中断，因此这不是数据清除或访问授权。

[内容搜索设置行](../../packages/client/ui-settings-general/src/client/ContentSearchRow.tsx)在通用设置中写入真实 Host 配置，按后端命名空间存在与否注册和撤回入口及搜索锚点。与自动标题共用[布尔偏好控件](../../packages/client/ui-settings-general/src/client/BooleanPreferenceControl.tsx)，统一已接受值展示、只读禁用、保存中保护与失败反馈。没有新增 Session 事件或 SQLite schema 版本。

最终 `vitest run packages/session-query/session-query-sqlite/tests packages/client/ui-settings-general/tests/apply.client.spec.ts packages/client/ui-settings-general/tests/components.client.spec.tsx packages/bundle/web-app/tests/session-capability-defaults.spec.ts`：7 文件、109 项通过，包含快照只读回放。真实 Loader 验证服务 fiber 不变、初始关闭不创建数据库、重开可搜索且已有索引保留；确定性阻塞夹具验证 sessions/events 两个范围的在途和排队请求在快速关开后均拒绝。真实 profile 编辑器测试验证补丁落盘、冷启动读回关闭状态及清除覆盖恢复默认值。客户端组合测试验证注册准入、写入参数、回读和撤回清理。

Host/Client 目标 `tsc -b` 通过，10 个目标文件 Oxlint 为 0 warnings、0 errors；设置包 bundle、SQLite 搜索 Host 单包 tsdown 构建通过并已收集作业结果；普通 Node 导入构建产物可读取 `searchEnabled: false`，非法开关值被拒绝；文案归属检查通过，4 组双语配对一致，范围内 `git diff --check` 通过。没有重跑整库 GUI/doc-sync，没有真实浏览器、手机或 Electron 联调。Ralph 原生控制及 Auto/Inspector 稳定接入仍未完成。

## 目标轮次 4：Ralph 默认关闭的原生策略

[Ralph Host 策略入口](../../packages/workflow/tool-ralph/src/settings.ts)发布为 `@deepseek-ai/dsh-tool-ralph/settings`，Web 组合挂载一次 `ralph-policy`，默认 `enabled: false`、`maxRounds: 64`。Standard/PTC/Creator 预设工具行挂载并设置 `requirePolicy: true`，在策略未提供或关闭时不暴露工具。Host 平面的旧 Ralph 工具行仍停用。开启设置只注册工具及固定的用户明确请求指导，不启动工作流，也不构成用户执行指令。

[Ralph 执行器](../../packages/workflow/tool-ralph/src/index.ts)使用 Host/预设上限较小值；关闭策略撤回工具和指导，并向活动工作流请求取消。执行器检查注册代次和当前准入，旧定义直接调用、关闭后重开及忽略取消后晚到成功均不能绕过。仍由执行调用等待工作流结果并释放运行，不宣称强制终止不配合的实现。独立非 Web 显式组合未设置 `requirePolicy` 时保留原有行为。

[开发者设置](../../packages/client/ui-settings-general/src/client/RalphSettingsControl.tsx)在唯一开发者分区内提供开关与正整数轮数上限，使用 Host 已接受值、有序写入和版本检查。加载/只读/保存中禁用，不存在策略时不显示；无效数字不能提交，拒绝或网络失败保留编辑供重试。字段和搜索锚点随服务撤回清理。

最终定向只读运行：5 文件、56 项通过，包含 Ralph 单元/Loader 固定工作流回归、真实 profile 持久化与冷启动回读、原生组件及表单回读和 Web 组合默认值。测试未启动真实子代理，未调用本会话的 Ralph 工具。覆盖策略服务延迟到达/卸载、旧定义直接执行、在途取消、晚到成功拒绝、上限收紧、配置撤回恢复默认和 UI 快照。

Ralph 与设置 Client 的目标 `tsc -b` 通过，局部 Oxlint 为 0 warnings、0 errors；Ralph 包双入口 tsdown 和设置 bundle 通过；普通 Node 导入两个发布产物，确认策略默认关闭/64 轮、requirePolicy 可解析且 0 轮被拒绝；文案归属和源码别名 freshness 检查通过；5 组双语配对一致；范围内 `git diff --check` 通过。没有本轮真实模型、浏览器视觉、手机或 Electron 验收，也没有重跑失败的整体 GUI/doc-sync。

## 目标轮次 5：Auto 精确审查请求审计

[Auto 实现](../../packages/guard/auto-review/src/index.ts)在模型发送前追加必需的仅记日志事件 `auto-review/request`，捕获完整系统策略、唯一用户文本块、provider/model、输出 token 上限、温度、期限以及 turn/step/native-or-PTC-inner/root-call 标识。事件不进入主模型对话表层，也不被后续审查递归吸收。输入预算拒绝不记录发送尝试；审计追加失败阻止模型及工具体执行。追加后、发送前取消时保留尝试记录而不执行模型或工具。记录不证明提供方收到请求，不保存 reasoning、原始响应或解析后的风险，实时追加也不保证同步文件系统刷盘。

最终 `vitest run packages/core/session/tests/gen-persistence-catalog.spec.ts packages/guard/auto-review/tests/auto-review.spec.ts packages/guard/auto-review/tests/loader-composition.spec.ts`：3 文件、77 项通过（目录生成 26、Auto 42、Loader 9），快照只读运行。真实 Loader 组合验证请求字段与模型入参相等、主模型历史不包含审查策略、当前格式严格编码/恢复/重开完整保留记录；PTC 用例验证内层及根调用标识。生成词表前恢复测试曾以未知必需事件拒绝，生成后通过。

`tsc -b packages/guard/auto-review/tsconfig.json` 通过；3 个目标文件 Oxlint 为 0 warnings、0 errors；Auto 单包 tsdown 构建和普通 Node 导入产物通过，所有作业已收集。完整持久化目录、双语配对、运行时词表与机器 schema 由生成器刷新，`gen-persistence-catalog --check` 通过；5 组作者文档配对一致，范围内 whitespace 检查通过。生成差异同时反映工作树已有 source 联合类型和其他事件变化，不能全部归为 Auto；运行时词表还补齐了已有 `working-directory/change` 声明。没有改写已确认记录或历史格式包。

已实际执行正式 `persistence-changes --record 2026-10-19-auto-review-request-audit --decision same-version --prose .artifacts/auto-review-request-audit.prose.json --json`。命令以 1 退出、`code: finalized-format-changed`，要求处理已有 V4 破坏性变化；新增 Auto 事件独立分类为 `root-added`、`requiresVersionBump: false`，`files: []`。没有写出兼容确认，没有伪造批准或升级整个 writer。精确日志代码已实现但此兼容确认仍未完成，Auto 保持实验包，不加入稳定默认组合。[升级指南](../../docs/upgrade-guide/v0.2.1-alpha.1/auto-review-request-audit/guide.zh.md)明确旧词表读取拒绝及敏感输入保留影响。

## 目标轮次 6：Inspector 网络捕获显式启用

[Inspector schema](../../packages/experimental/inspector/src/index.ts)、[库解析器](../../packages/experimental/inspector/src/host/bridge/controller.ts)及[可选组合](../../packages/experimental/inspector-profile/cordis.patch.yml)将 `captureFetch` 默认设为 false。省略字段或显式 false 均不安装 fetch observer，不克隆请求/响应体，不保留 Host 网络观测；显式 true 保留既有完整、未脱敏采集及预算。Inspector bundle 仍为默认关闭的实验组合，启用后仍有调试端点及运行时求值权限；关闭捕获不是关闭调试或限制可信调试器权限。本轮没有将实验包加入稳定依赖，也没有给普通开发者可见性偏好增加调试副作用。

新增真实 Worker 回归先复现省略字段会替换全局 fetch，修正后通过。最终定向命令覆盖 integration、plugin、Loader composition、fetch observer、worker lifecycle 与 bundle profile：6 文件、39 项通过。测试使用合成本地 HTTP 流量、真实 Worker/CDP 和独立端口，验证默认及显式 false 不采集、Network 域无事件、显式 true 保留 URL/headers/body、SSE/取消路径、捕获结束恢复全局 fetch、启动失败回滚及清理。该证据属于本地组件集成，不是当前 GUI、手机或 Electron 实际验收。

Inspector Host 与 profile 目标 `tsc -b` 通过，6 个目标文件 Oxlint 为 0 warnings、0 errors；Inspector 发布构建通过（包含 Host/Worker 及打包流程）；普通 Node 导入发布产物，启动真实 sibling Worker，确认默认 fetch 未替换、发现接口可达并完成 shutdown。5 组双语 README/决策/升级指南配对一致，范围内 `git diff --check` 通过。未修改已发布 Session 格式、未运行真实模型 API、未启动替代 GUI 服务，无遗留后台作业。[升级指南](../../docs/upgrade-guide/v0.2.1-alpha.1/inspector-fetch-opt-in/guide.zh.md)说明显式配置方法、完整配置覆盖和调试权限限制。

## 目标轮次 7：单一开发者设置中的风险确认与实时捕获

[Inspector 捕获控件](../../packages/client/ui-settings-general/src/client/InspectorCaptureControl.tsx)加入既有开发者分区，只有已加载的 `experimental-inspector` 命名空间提供配置时可用，不导入实验包运行时、不加载缺失后端、不开放新调试端点。每次 UI 开启需明确确认 URL/headers/body 可能含凭据、Cookie 与私人内容；取消、后端撤回或只读会使确认失效。关闭不需二次确认。界面展示已接受的配置请求，不将保存结果宣称为运行状态；异步应用失败由 Host 明确记录日志，可关闭后重试。持久化 true 会在 Host 重启后恢复捕获，不再次确认，文案和升级指南明确该行为。

[捕获句柄](../../packages/experimental/inspector/src/host/bridge/controller.ts)新增可等待的 `setCaptureFetch(enabled)`，按单一队列串行安装或停止 observer，关闭等待旧 observer 清理，不替换 Worker/CDP/bootstrap。关闭实例后拒绝待处理开启动作，失败安装可重试；真实网络测试验证只采集开启时段，关闭不擦除 Worker 旧记录。插件通过实时配置引用与 Loader 提交通知应用变化，不重建自己的 fiber。该配置仍非运行状态 API，尚未实现整个 Inspector 调试后端的原生启停或浏览器重新连接通知。

最终定向只读回归：Inspector integration/plugin/Loader/capture-settings/fetch-observer/worker-lifecycle 与 ui-settings-general apply/components 共 8 文件、77 项通过。覆盖真实 Worker/CDP、本地合成流量、串行开关、失败重试、并发关闭、全局 fetch 恢复、端点不变、真实 profile 文件持久化与冷启动回读、风险确认每次重新勾选、撤回失效、只读和保存错误，以及表单参数/已接受值回读和搜索锚点清理。两项 capture UI 文案快照已审查并只读回放。

Inspector Host 与设置 Client 目标 `tsc -b` 通过；12 个目标文件 Oxlint 为 0 warnings、0 errors；Inspector Host/Worker 与设置 bundle 构建通过，构建作业已收集；普通 Node 导入产物验证实时启用/关闭、端点保持、Worker 关闭及关闭后拒绝再开启。文案归属检查、5 组双语配对和范围内 `git diff --check` 通过。无真实模型调用或实际 GUI/手机/Electron 验收，没有启动替代服务，仍保留全部累积未提交改动。稳定晋升、Auto 兼容确认和整体浏览器联调仍未完成。

## 目标轮次 8：捕获重开身份与停止后的静默保证

复核实时捕获链路发现并复现两项缺陷。其一，每次安装 observer 将请求计数重置，而 Worker 保留原 source generation 与网络记录，重开后的 `fetch-1` 触发重复 ID 拒绝，第二段流量丢失。其二，调用方保存的旧 fetch 包装器及停止后才到达的响应仍继续发布记录。两项回归在修复前分别失败，不是仅凭源码推断。

[fetch observer](../../packages/experimental/inspector/src/host/inspection/network.ts)为每次安装创建独立 UUID 请求命名空间，保留每个请求生命周期的关联，未放宽 Worker 重复 ID 拒绝规则。停止后的包装器直接委托原 fetch；已经发出的请求在等待期间停止时，晚到响应或错误仍返回原调用方，不再发布新观测、不克隆新响应体。停止不取消应用自己的网络请求，已有 clone 清理规则保持不变。

真实 Worker/CDP 回归验证两次开关期间的请求 ID 不同、两条响应体在重开后均可独立读取；两个独立测试进程并发运行该回归均通过，分别绑定自己的临时端口。确定性 deferred-response 用例验证停止后旧包装器仍可正常调用、晚到成功/失败透传而记录数不再增加。最终组合回归覆盖 fetch observer、integration、plugin、Loader、capture settings、worker lifecycle 与设置 apply/components：8 文件、80 项通过，快照只读。

Inspector Host `tsc -b`、3 个本轮目标文件 Oxlint（0 warnings、0 errors）、发布 Host/Worker 构建、两组双语配对及范围内 `git diff --check` 通过。所有本轮命令已完成，无后台作业。该轮未完成 Auto/Inspector 稳定晋升、调试后端整体原生启停、Auto 持久化兼容确认或实际 GUI/手机/Electron 联调；整体目标仍活动。

## 目标轮次 9：只读 Session Inspector 原生晋升

只读检查器完整移动至 [client/ui-session-inspector](../../packages/client/ui-session-inspector/README.md)，发布名改为 `@deepseek-ai/dsh-client-ui-session-inspector`。同步 manifest、tsconfig 聚合与源码别名、动态 bundle 身份、Web 默认组合和依赖、可选调试 bundle、发布族期望及文档策略清单，离线安装刷新锁文件和链接。保留历史 Sidebar 实现 ID 与 `session-inspector-log` kind，不迁移 Session 数据。实验 Node Inspector 和网络捕获仍独立显式安装；可选 Inspector bundle 不再装配另一份只读检查器。目录移动保留原始文件及工作区内容，未执行 reset、clean 或源码删除清理。

只读客户端跟随共享开发者偏好，通过串行子作用域装卸 tab 与 picker；快速关开不重复注册，关闭或卸载释放活动拾取器，旧来源不能重新启动拾取。侧栏引导使用语义图标；Host discovery 保持无操作，不启动调试服务。真实 Loader 测试验证默认原生入口可注册并随卸载消失，Web/base 组合断言仅存在一个稳定包行，不包含实验调试后端。

最终 `vitest run packages/client/ui-session-inspector/tests packages/bundle/web-app/tests/session-capability-defaults.spec.ts packages/experimental/inspector-profile/tests/profile.spec.ts`：28 文件、186 项通过。迁移后目标 `tsc -b`、局部 Oxlint（0 warnings、0 errors）、稳定客户端 bundle 构建通过，客户端打包的实验输入隔离检查通过。`verify-client-packages` 再跑通过：87 客户端包满足模块规则。普通 Node 直接导入 Host 发布入口并核对浏览器产物新身份通过；此前依赖 Loader 的冒烟尝试因包级链接缺失失败，最终改用直接发布入口检查，真实 Loader 已由测试覆盖。源码别名 freshness、4 类包/客户端/config/module 目录生成及 freshness、文案归属和作者双语配对通过。生成目录也反映既有累积差异，不全部归为晋升功能。

已尝试原生组合浏览器回放（未启用 Inspector 调试 bundle），两用例失败：`Choose workspace` textbox 和初始 `treeitem` 导航分别等待 30 秒超时；首用例后续报告无匹配 live Session 与 replay fixture 未消费。失败在检查器操作前，未完成归因，不能据此宣称浏览器验收通过。没有更新快照掩盖差异，没有启动替代 GUI。Web 回放夹具同步停用新的 all-prompts 标题行，防止辅助请求竞争 replay 游标。

额外发布族测试 32 项中 1 项失败，错误为已有 `apps/mobile/package.json must name an @deepseek-ai package`；整库 `verify-default-product-isolation` 失败于已有可选 bundle 清单缺少元数据/依赖和 cinlan-computer-use 的实验 runtime 边，报告未列出新只读检查器。这些检查仍算失败，未顺手改写无关包。高权限 Inspector 原生启停、Auto 稳定晋升与持久化确认及实际 GUI/手机/Electron 验收仍未完成。[迁移指南](../../docs/upgrade-guide/v0.2.1-alpha.1/native-session-inspector/guide.zh.md)说明新包名、避免重复行、共享偏好和旧 tab 身份保留。

## 目标轮次 10：浏览器启动阻断定位与 CLH 测试根隔离

导航现场保留的页面和截图明确显示 `ui-floating-workspace` 激活失败，并非 Session Inspector 入口未装配。[浮动工作区注册](../../packages/client/ui-floating-workspace/src/client/index.ts)同时按实现 ID 与页型 kind 注册 renderer，两次声明同一 `floatingWorkspace.tab.chat` 子槽，真实注册测试复现 4 项失败和 1 个未处理错误。侧栏按注册类型的实现 ID 选择 renderer；修复为仅保留实现 ID 注册，未恢复 kind 别名、未修改共享 slot 框架。回归固定单 renderer、正确 key、单一子槽贡献以及卸载重载清理。4 文件、36 项所属测试通过，Client `tsc -b` 和浮动插件 bundle 通过。浏览器随后越过启动屏障，可操作原生检查器。

录制比较继续暴露本机用户技能污染：scaffold 仅固定 DSH_HOME，而 CLH home 解析不读取它。[scaffold](../../apps/web/tests/scaffold.ts)为整个生命周期固定 CLH_HOME/CINLAN_HARNESS_HOME 到临时 harnessHome，并保留两个变量原始存在性和值。扩展[隔离回归](../../apps/web/tests/scaffold-hermetic.e2e.ts)，分别用两个 CLH 别名注入独立用户技能，验证 preset 作用域目录不可见且 close 后所有变量精确恢复：2 项通过。未重定义 HOME、未修改用户目录；内置提供方技能仍有意保留。

真实 Chromium 原生组合的 `highlights nearby Chat content when the selected recorded call is not displayed` 用例已通过：从持久化种子打开 Session、进入原生 Raw Log、隐藏对应 Chat 工具 occurrence，并验证定位到可见邻近 Chat 内容的预期输出。最终完整 `session-inspector.e2e.ts` 结果为 1 项通过、1 项失败；首个 live-turn 录制比较仍存在新增工作目录 runtime context、内置诊断技能消息，以及 Windows 预设中无 bash 导致 UNKNOWN_TOOL 的差异，不能标记完整回放通过。没有改快照、跳过现有断言、关闭实际产品行为或延长导航超时。

[浏览器用例](../../apps/web/tests/session-inspector.e2e.ts)在工作区或种子导航失败现场保留测试页面文本、控制台与截图，避免 teardown 先关闭页面丢失诊断。本轮曾修正错误使用的 Vitest 钩子，最终采用失败路径内诊断。截图位于临时证据目录，未写入源码快照。4 个最终目标文件 Oxlint 为 0 warnings、0 errors；3 组双语 README/所属测试决策配对与范围内 `git diff --check` 通过。没有启动替代 GUI、真实模型调用或子代理；当前用户 GUI、手机及 Electron 验收仍未进行。

## 目标轮次 11：Auto 原生 guard 与会话选择真实加载

[Auto 后端](../../packages/guard/auto-review/README.md)从 experimental 迁到 `packages/guard/auto-review`，包名改为 `@deepseek-ai/dsh-auto-review`，Cordis 名称为 `auto-review`。Web/Desktop bundle 原生挂载一个明确预算的后端；同步 CLI/Web 依赖、编译引用、源码别名、Loader fixture、发布载荷断言及目录，并从可选 bundle 清单移除旧名称，避免重复开关。旧包目录完整移动，保留累积改动；持久 `auto` 权限标识及 `auto-review/request` 事件不变。旧用户安装需按[迁移指南](../../docs/upgrade-guide/v0.2.1-alpha.1/native-auto-review/guide.zh.md)移除额外实验层，不自动改用户 profile。

原生加载仅提供当前会话选项，不选择 Auto、不改未来会话默认、不向子执行转发 Auto 权限；现有风险确认、逐调用审查、人工审批兜底、技术失败拒绝及卸载 Full access 迁移保留。鉴于持久化确认和完整验收未完成，保留 EXP 风险提示，本轮不宣称发布认证。普通新会话仍工作区权限；没有因加载后端产生审查模型请求。

最终定向 `vitest run` 覆盖 guard Auto 及 Loader、客户端权限选择器、权限预设及 Web 组合：10 文件、140 项通过。原生载荷专项 2 项通过；全 workspace 约束 suite 为 105 通过/3 失败，涉及既有 agent-team-profile 发布元数据及 CLI repository 字段，不算整库通过。Native guard `tsc -b`、单包 tsdown 和普通 Node 产物身份/预算检查通过；局部 Oxlint 及文案归属通过，12 组作者双语配对一致，包/config/module/persistence 目录生成及 freshness 通过。旧 unknown-cast 基线仅迁移路径，未新增 Auto 断言；整库 unknown-cast 检查仍列出其他路径大量差异，不认定通过。实验隔离整库仍被已有 optional bundle 元数据及 computer-use 实验依赖边阻止，诊断不含新 Auto guard。

真实 Chromium 原生默认菜单专项通过：无额外 overlay 提供 Auto，fresh Session 仍工作区权限。风险确认与撤回/重装专项 2 项通过，取消确认不切换、后端撤回后两个入口刷新，重装不自动恢复 Auto。完整 access-confirmation suite 仍为 3 通过/3 失败：Full access 旧图标 ARIA 金文件不匹配后残留 modal 影响后续用例；未刷新金文件或删断言。单独跑 Auto 场景已通过，但不据此把完整 suite 标绿。

冷恢复 Auto approval 浏览器 suite 最终 2 项通过，恢复 native Auto Session 并展示用户拒绝与具体技术错误，保留既有金文件；修复仅将该场景拥有的临时 workspace basename 经已有 replacements 接口标记，未改共享归一化器。此前失败仅该临时名漂移。上述浏览器证据不涉及真实 LLM 审查；真实 API 认证、手机/Electron 及当前用户 GUI 刷新验收未完成。

再次执行持久化检查仍 `finalized-format-changed`，要求已有 V4 破坏性差异完成版本处理；Auto 请求事件独立分类为兼容新增，不生成或改写已接受记录。原生包归属和加载已接入，发布与持久化验收仍未完成，整体目标不标记完成。

## 目标轮次 12：组合验收与遗留期望收口

Full access 原有 ARIA 金文件包含两个装饰 SVG img；现有图标实现已明确 `aria-hidden=true`。先在组件及真实浏览器增加 SVG 存在、隐藏性、无语义图片及同意前确认按钮禁用断言，再仅对所属 Full access 对话框运行一次 refresh，差异仅删除装饰图像节点。增加每用例 modal/menu 清理以阻止失败后的交叉污染。最终只读 replay 同时运行 access-confirmation 与 auto-review-approval：2 文件、8 项通过，含所有 6 个权限确认用例；不再沿用轮次 11 的 3/6 结论。

首次组合回归暴露设置 shell 仍只期待 General 的 3 个过时期望，已按两个真实分区更新 ledger、排序与图标选择断言，保留开发者分区的唯一 ID/group/order 及字段元数据验证。重跑 Auto、权限、开发者设置、只读检查器、搜索、标题、Ralph 与浮动工作区所属回归：61 文件、585 项通过，没有跳过或刷新隐藏的其他预期输出。

删除 OPTIONAL_BUNDLES 中已由真实原生服务替代的 Search/Titles/Ralph 三项，Auto 已在轮次 11 移除；新增组合断言验证实际后端、预算、Ralph 默认关，而非仅验证列表消失。高权限 Inspector 可选包名称改为 NodeJS runtime debugger/NodeJS 运行时调试，与唯一开发者设置分区区分；只读 Inspector 继续原生加载。专项 9 项通过。

对 profile 中三个已弃用 home 调用改用当前 `resolveClhHome`；读取实现确认旧名称本来就是同一函数别名。profile/home 回归 2 文件51项通过，最终6文件局部 Oxlint 0 warnings/0 errors。app-boot、设置 Client、Auto、只读检查器、Ralph、标题、搜索类型检查通过。app-boot 产物构建及普通 Node optional roster 冒烟通过；最后别名清理后再次构建，以最终作业结果为准。三组作者双语文档配对与范围内 diff whitespace 检查通过。

高权限 Node 调试整体原生启停、Ralph 真实任务流程、持久化确认及全库/跨端完整验收仍有剩余，不将部分实现或已通过局部测试解释为全部目标完成。未创建提交或外部发布，没有运行真实 Ralph 或子代理。

## 继续推进：持久化前置检查（2026-10-19）

直接继续请求已将目标轮数上限从12延长到16并恢复活动。重新读取真实检查结果，定位19个版本差异为六个既有source kind组的ContextFormed分支传递变化及标题审计的Message引用；Auto请求审计为兼容新增。没有将分类器放宽、撤回已有源实现或更改接受基线。

历史格式记录只接受tag/PR，不能如实描述未提交工作区。为按版本政策准备V4归档，新增`source.snapshotSha256`，严格固定同目录schema的原始字节，与tag/PR互斥。它只标识归档inventory，不证明源提交、发布、接受状态或迁移安全。解析时先校验64位小写摘要并比较文件SHA-256，再做完整schema/root验证；`--write`不能先刷新文档掩盖不匹配。索引展示完整摘要，不虚构PR或release。

先运行新用例得到原实现拒绝snapshot来源的失败，再实现验证。最终`vitest run scripts/persistence-formats.spec.ts`93项通过，含摘要被改动、单一换行变化、混合来源、双语不一致及失败前不写回断言。现有历史格式命令验证V0–V4的5份参考通过；3目标脚本Oxlint为0warnings/0errors，2组双语配对通过，diffwhitespace通过。接受checkpoint、历史schemaJSON均无git差异；生成器只刷新所属README及配对记录，没有写任何历史Session文件。

writer依然4，尚未创建V4归档或接入V4→V5；这些前置检查不等于兼容确认完成。[V5实施记录](native-session-format-v5-2026-10-19.md)保存边的具体保留、继承切点及delivery代际拒绝要求。下一阶段要原子接入writer、codec、Stage、catalog及新acknowledgement，并验证历史输入字节不变和当前publication，不得仅改版本常量。

## 实际联调与未完成项

没有对当前 GUI 地址刷新后进行浏览器验收，没有确认开发 watcher，没有真实 API 标题调用、手机/Host 重连、Electron 或跨平台验收。Loader 使用固定模型适配器的测试不是实际联调通过。未运行完整构建、视觉断点/主题矩阵或安装包验收；轮次 10 已修复启动阻断并通过一项原生检查器 Chromium 导航联调，完整回放仍为 1 通过/1 失败。

Auto 原生包归属、真实默认后端加载与会话级选择已由轮次 11 接入，持久化兼容确认、真实提供方及完整发布验收仍未完成；只读 Session Inspector 已按轮次 9 晋升并接入原生组合及共享开发者偏好；高权限 Inspector 的稳定晋升和整体调试启停仍未完成。实验隔离要求原子更新包归属、依赖、配置、消费者、文档与验收，不能只隐藏插件列表。Ralph 可用性与轮数配置已按轮次 4 接入，专用任务发起入口和真实工作流联调未完成。整体目标保持未完成。
