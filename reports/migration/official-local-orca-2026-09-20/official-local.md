# 官方 dsh-v0.1.6-alpha.2 与本地集成源码审查

本地集成保留官方的 agent/session/persistence 主干、headless 运行协议、持久化 feedback 与 present/workspace-changes，并将 Settings、MCP 管理、侧栏和 Desktop 扩展为本地产品装配。它不是官方标签的完整源码镜像：消息投影与图像卸载、Office 内置技能、默认 PTC/workflow 隔离装配以及 Desktop 更新体系仍有明确差异。385 个发布成员版本一致仅证明发布版本约束成立。

本文件是三方比较的官方/本地证据附件。Orca 的源码判断由父审查汇总；本文件不以包数量推断 Orca 或任一产品的能力覆盖率。

## 基线与核对范围

- 官方根目录 O：D:/Company/cinlan/deepseek-harness-reference-016。
- 本地集成根目录 L：D:/Company/cinlan/cinlan-harness-upstream-016。
- 本次独立执行的 Git 只读核对：O HEAD、标签 dsh-v0.1.6-alpha.2、L 缓存 upstream/master 都是 ddefc45fbc7f8e46dd73185e68295696d1297887；标签日期 2026-09-17，提交标题为 Merge pull request #4469 from deepseek-harness/worktree/release-dsh-0.1.6-alpha.2。缓存 upstream/HEAD 指向 upstream/master，没有据此假设上游叫 main。
- 最终本地代码提交与 main 均为 1c88551e2d0c27bbc8a208b91ee82e064c27d3ea，main 已安全快进，统计在该提交后刷新。初始审查时的未提交工作树已纳入该提交；不以初始 HEAD 的历史差距推断功能缺失。
- 本次整体核验的远端结果：origin/main=763766ee8a8b076125b287464e1ef84c4a7f5222，本地提交未推送；官方远端 HEAD 与标签仍为 ddefc45fbc7f8e46dd73185e68295696d1297887。远端核验记录见主报告；这不意味着官方源码已完整同步。

下列 O:path:line、L:path:line 分别指上面的实际根目录与一基行号。结论来自读取这些文件及定点 git diff --no-index；全仓文件清单仅用于统计与定位。

## 可信统计与解释

比较脚本 `D:/Company/cinlan/cinlan-harness-upstream-016/.artifacts/main-three-way-audit/compare-source.mjs`通过 git ls-files --cached --others --exclude-standard 枚举现存受控文件及非忽略未受控文件；不统计已删除文件，比较的是工作树。先排除 .git、node_modules、lib、dist、build、out、coverage、.dsh-build、.artifacts、.next、.vite、.cache、target、__pycache__、vendor 路径分量以及 .tsbuildinfo/.map/.node/.dll/.exe/.pyc。仅归一化 CRLF→LF，SHA-256 对归一化后的字节计算。

| 口径 | 官方 | 本地 | 同路径相同 | 同路径修改 | 官方独有 | 本地独有 |
|---|---:|---:|---:|---:|---:|---:|
| packages/*/*/src 与 apps/*/src，全部源目录文件 | 2,204 | 2,541 | 1,299 | 636 | 269 | 606 |
| 上述目录的 ts/tsx/js/jsx/mjs/cjs/css/scss/vue/svelte/html | 2,202 | 2,539 | 1,297 | 636 | 269 | 606 |
| 上述全部源目录文件物理行 | 385,653 | 461,778 | — | — | — | — |
| 上述代码扩展名物理行 | 385,577 | 461,702 | — | — | — | — |
| 包目录（packages 与 apps） | 295 | 396 | 同名 284 | 其中 src 有差异 181 | 11 | 112 |

物理行包含注释和空行；源目录可能包含生成源码，不是去注释 SLOC。生产源码口径不含 tests、snapshots、docs、scripts、native、python；因此这不是全语言总代码量。不能把 JSON 中 repositoryFiles 的物理行总数当源码总量，它还含文档、测试和资源。源文件数量变化并不等价于功能增减，同名 src 有差异的 181 包也包含纯注释变化。

纯版本字段另行判别：只有 package.json 的顶层 version 不同、移除该字段后其余 JSON 相同才标 version-only；依赖版本变化仍标 modified。本次 O/L 已经同版，version-only 数为 0，故排除纯 version 字段前后统计相同。这没有检查或证明 Git 祖先关系、工作树相等、发布 tarball 或安装包内容一致。

[完整机器摘要](source-summary.json)、逐文件状态/哈希/行数（本机集成树 `.artifacts/main-three-way-audit/source-files.json`）、逐包机器清单（同处 `packages.json`）、[全部 407 个联合包目录的人读表](package-inventory.md)可复核上表。[release-members.json](release-members.json)则来自实际调用本地 releaseFamily('dsh').members(root)：385 个成员，版本集合仅 0.1.6-alpha.2。目录口径的 396 包与发布口径的 385 成员是两种集合。

## 关键源码与装配

| 范围 | 官方证据 | 本地证据与结论 |
|---|---|---|
| Agent 生命周期 | O:packages/core/agent-loop/src/index.ts:625 为 ownerCtx 的生命周期 effect；:676 在 publish 中 announce | L:同路径:629 把 loopCtx 的 scope disposer 嵌入 caller owner effect，:639 区分 factory 已失活原因，:684 在 announce 后发 agent/session-start。这是需保留的真实生命周期改造，后续合并要验证 caller dispose、loop unload、失败 setup 回滚与排队输入，不可整文件覆盖。 |
| Session 与 JSONL 主干 | O:packages/core/session/src/types.ts:88 定义 SESSION_FORMAT_VERSION=3；O:packages/session/session-persistence-jsonl/src/generation.ts:538 恢复时传消息投影 | L:packages/core/session/src/types.ts:88 同为 v3；L:packages/session/session-persistence-jsonl/src/generation.ts:531 附近保留 Session.fromRestore 与流校验，但不传 currentSessionMessageProjections。不可称为持久化整体缺失，也不可称为官方 v3 全部事件可互读。 |
| 消息投影与图像卸载 | O:packages/core/session/src/surface.ts:22 定义投影上下文、:35 定义 SessionMessageProjection；O:packages/session/session-format-catalog/src/message-projections.ts:3 导入 imageOffloadProjection；O:packages/compaction/compaction-image-offload/src/index.ts:26 注册投影，:27 和 :33 注册 agent/summary 错误恢复；O:packages/bundle/base/cordis.patch.yml:414 装配 | L:packages/core/session/src/surface.ts:13 只导入已知事件集合，:22 开始普通四类 message surface；L:packages/session/session-format-catalog/src/current.ts:43 恢复不传投影；包目录与 base 中均无图像卸载。此项是明确未等同官方的能力与兼容性缺口。 |
| MCP 基础与本地管理 | O:packages/mcp/mcp-client/src/index.ts:151 开始实例装配，:178 supervisor，:182 server context；已有 stdio/Streamable HTTP、重连和资源能力 | L:packages/mcp/mcp-client/src/index.ts:111 的 launchMcpConnection 扩展 registry/owner/handle，:146 registry 观察，:158 mcpResources 注册；L:packages/mcp/mcp-management/src/index.ts:229 存储提交、:236 串行队列、:279 managed child、:323 credentials 引用解析。L:packages/bundle/web-app/cordis.patch.yml:129-138 实际装配 registry/management/controller；这不是仅添加 Settings 表单。 |
| MCP 连接清理 | O/L 均使用连接 generation 与 reconnect | L:packages/mcp/mcp-client/src/connection.ts:95 managed 模式诊断收敛、:220 重连重新解析配置、:282 关闭超时停止重连防止并发子进程、:347 dispose；L:packages/mcp/mcp-client/src/index.ts:134 注明确认关闭后释放命名空间。应保留管理态观测、凭据引用和关闭确认约束；成功重连/错误态表现仍需集成验收。 |
| Headless | O:packages/bundle/headless/src/index.ts 与 json-stream.ts | 定点 diff 显示 L:index.ts 仅删除 deprecated 注释，L:json-stream.ts 仅增加 catch/default 注释，执行逻辑一致；L:index.ts:255 要求 resume 持久化服务、:272 拒绝借用 live agent、:359 JSON projection、:378 依据 turn outcome 退出。headless 协议不是缺口。但 L:packages/bundle/headless/cordis.patch.yml:21 加载 code-runtime-worker-thread，底层执行装配不同。 |
| Feedback | O/L:packages/feedback/message-feedback/src/index.ts | 服务定点 diff 只有 deprecated 注释；L:同路径:231 开始 live log mutation、:240 flush；L:packages/bundle/web-app/cordis.patch.yml:63 装配 message-feedback。feedback/message-put、feedback/message-delete 的持久化能力已保留；前端 UI 有改造，不宜以组件 diff 推断后端反馈丢失。 |
| Deliverables | O/L:packages/deliverables/tool-present/src/index.ts、types.ts 和 workspace-changes 的全部 8 个 src 文件哈希一致 | L:packages/preset/agent-presets/presets/standard/agent.cordis.yml:241 装配 tool-present；L:packages/bundle/web-app/cordis.patch.yml:45 装配 workspace-changes、:363 装配 ui-deliverables。L:packages/client/ui-deliverables/src/client/index.ts:57 注册 better-sidebar review tab、:79 优先新侧栏、:109 保留官方 sidebarRight 的可选适配。这是已保留持久化交付能力及 UI 适配，不是被本地 artifact 包替代。 |
| Settings | O:packages/client/ui-settings/src/client/index.ts 保留 describe mirror/ScopeBinder；官方已有模型与插件设置 | L:同路径:27 导入 SettingsMetadataService，:61 实例化；L:packages/client/ui-settings/src/client/settings-metadata.ts:17 明确只注册公开文案、:129 section、:155 items；L:packages/client/ui-settings-general/src/client/index.ts:60 依赖 metadata，:75 使用 loopback host facts。新增搜索/分组和 MCP、hosts、automation、security、terminal、usage 等功能贡献，维持 shared describe mirror，不是另起一份 settings 存储。 |
| Sidebar | O:packages/bundle/web-app/cordis.patch.yml:224-244 装配 sidebarRight/documentpreview/browser/terminal/files | L:同路径:198 说明本地 terminal owner，:370 实际装配 ui-better-sidebar；L:packages/client/ui-better-sidebar/src/sidebar-transport.ts:77 共享操作、:81 cwd 检查、:98 HTML CSP；L:packages/client/ui-better-sidebar/src/client/builtins/viewers.tsx:6 导入 OfficePreview、:50 PDF viewer。官方三个 sidebar 包缺失不代表没有浏览器/终端/文档预览；需要按 UI 功能逐项验收。L:packages/client/ui-better-sidebar/src/index.ts:436 的 sidechat.start/prompt/cancel/dispose 明确 501，Side Chat 属于真实本地未实现项。 |
| Desktop transport | O:apps/desktop/src/main.ts:398 custom protocol，:441 将请求转入 Host cookie/origin；官方也有 Electron 隔离，:136-138 | L:apps/desktop/src/main.ts:37 注册 scheme，:99-101 保持 nodeIntegration=false/contextIsolation=true/sandbox=true，:241 protocol.handle→active.fetch；L:apps/desktop-host/config/desktop.cordis.patch.yml:20 禁用 webserver、:23 禁用 web-runtime、:32 注入 credentials；L:apps/desktop-host/src/index.ts:235 remote stream handler、:356 shared fetch handler、:365 fetch、:498 transport failure 清理。这是实际原生载体改造，不能称为遗漏 HTTP 服务造成 Desktop 不可用。 |
| PTC / workflow | O:packages/bundle/base/cordis.patch.yml:376 ptc-runtime-node、:379 workflow-ptc；O:packages/workflow/workflow-ptc/src/index.ts:1-3 明确共用 Session 文件策略的进程执行 | L:packages/bundle/base/cordis.patch.yml:370 workflow-worker-thread，L:packages/bundle/web-app/cordis.patch.yml:60 与 headless patch:21 加载 code-runtime-worker-thread。L:packages/code-runtime/code-runtime-worker-thread/src/index.ts:2-5 明确 containment 不是安全边界；L:packages/ptc-runtime/ptc-runtime-node/src/code-runtime.ts:28 为可选适配。PTC 包源码存在且大量相同，不等于默认已使用官方隔离装配。 |
| Desktop 发布/更新 | O:apps/desktop/src/main.ts:32-40 引入 update journal/schedule/mandatory policy/dialog，:347 检查活动任务、:366 锁任务再退出 | L:apps/desktop/src/main.ts:233 coordinator、:323 检查与安装 IPC、:553 10 秒后检查；官方 mandatory-update-policy/update-journal/update-tasks 等文件在 L 不存在。本地具有独立更新/seed 体系，不能宣称官方强制更新、任务锁与恢复路径已等价移植。 |

## 官方独有包：缺口与非缺口

| 官方独有目录 | 判断 |
|---|---|
| packages/compaction/compaction-image-offload | 明确能力与日志兼容缺口，见上表；优先于 UI 数量比较。 |
| packages/skill/skill-office | 官方源 index.ts:12 指定 office-docx/pptx/xlsx，:43 注册 provider，:46 要求 check_office.py；本地缺此 provider/assets/checker。Office 预览仍存在，文档生成技能与预览是不同能力。 |
| packages/workflow/workflow-ptc | 默认执行/隔离实现不同；已有 workflow-worker-thread 不能自动视为等价安全策略。 |
| packages/boot/hmr | L:packages/bundle/base/cordis.patch.yml:21 使用 cordis-plugin-hmr 且默认 disabled；Desktop overlay:6 启用 config-only HMR，host index.ts:347 校验它。属于实现与装配差异，不是完全没有热更新；不扩展评审 vendor 内部源码。 |
| packages/client/ui-sidebar-browser | 本地 better-sidebar/browser 改造需按功能验收，不是无浏览器能力的证据。 |
| packages/client/ui-sidebar-documentpreview | 本地 OfficePreview/PDF viewer 与 office-to-pdf 装配存在，属于替代 UI；官方 Office authoring skill 缺口另计。 |
| packages/client/ui-sidebar-terminal | 本地 sidebar-terminals/terminal provider/controller 存在并装配，属于替代实现，终端权限/重连/恢复仍需独立检查。 |
| packages/experimental/ptc-runtime-python | 本地存在 experimental/code-runtime-python，但包目录与执行协议不同，本审查不声称等价。 |
| packages/test-support/remote-mock | 测试支持包，不直接计为产品功能缺口；影响移植官方测试的成本。 |
| packages/util/chunked-list | 内部数据结构包；Session 本地仍有私有数组日志，不能仅凭缺包断言功能缺失或性能回退幅度。 |
| packages/util/lazy-require | 内部装载辅助包；不是用户能力缺口，需跟随具体使用方核对。 |

本地独有 112 包的完整目录见 [package-inventory.md](package-inventory.md)。主要按职责集中在 browser/computer/mobile 的 capability-provider-tool 与 bundle、MCP 管理、Settings/侧栏扩展、execution-host、work-items/workspace/coordination、artifact/automation、security、git/terminal/voice/notifications。它们是代码与包清单事实；除上表明确跟踪装配的部分，本审查不把“存在包”直接写成“默认启用且运行通过”。

## 风险与后续验收优先级

1. **高：同版 Session 不等于事件互读。** 官方 known-event-types.ts:43 包含 image/offload、:59 包含 subagent/catalog；本地 known-event-types.ts:28-29 增 assessment 事件、:42 增 finding/change，却无上述两种官方事件。未知必需事件的 refusal 是有意保护，而不是应绕过的障碍。需以官方含图像卸载日志和本地 assessment/finding 日志验证双向拒绝/支持预期；没有实测不能宣称数据丢失，也不能承诺无损互读。
2. **高：执行策略要按默认装配审计。** Node PTC 的源码已经保留，不代表 headless/Web 默认 worker-thread CodeRuntime 获得其文件 sandbox。需决定是否维持本地模型代码信任约定，或接入可选 PtcCodeRuntime，再跑相应路径验收。
3. **中高：Desktop 发布行为是独立实现。** 保留本地原生 transport、窗口与 startup/seed 的同时，应明确官方 task-lock/mandatory-update/journal 是否产品要求；产品版本相同不能证明这些行为或安装包资源已迁移。
4. **中：MCP/Settings/侧栏是真实保留改造。** 后续上游更新最易破坏 registry 生命周期、managed credentials 引用、Settings metadata、共享 fetch 与 optional sidebar adapter。审查范围内存在测试文件并不等于本次执行过测试；实际运行验收记录见主报告，独立于本附件的静态审查。
5. **中：Office 的预览、生成技能与许可证分别验收。** 本次同步已补齐 LibreOffice MPL 精确例外、源码义务声明、THIRD_PARTY_NOTICES 与生成器，并通过29项回归及freshness检查；Office创作技能仍是独立缺口，既有安装包未因此重建。

## 发布拓扑与执行记录

L:scripts/release/families.ts:124 从 patterns 发现成员、:132 排除 private；:326 排除一般 experimental、:328 加精确允许列表，:357 仅要求成员版本集合单一。L:scripts/experimental-package-policy.ts:2-9 列出七个公开实验导入。发布域独立于根 workspace、vendor 和 native 的包版本；root package.json:3 的版本也不是 Git 同步证明。L:apps/desktop/src/release.ts:21 的元数据校验与官方执行逻辑相同，仅文案将 bundled runtime 表述为 seed；Desktop 装配与更新实现仍明显不同。

本附件统计执行了 Git 身份/缓存 ref/提交计数读取、定点源码 diff、compare-source.mjs、package-inventory.mjs 和 release-members.mjs。git diff --no-index 返回 1 是发现差异的正常状态，已读取差异内容。未运行产品、构建、测试、安装、文档生成器或发布命令，未修改产品或 Git。统计证据由 Node 生成。

本附件的源码统计时间与最终 refs 保存在 source-summary.json，已在 main 快进至 1c88551e2d0c27bbc8a208b91ee82e064c27d3ea 后重新执行比较脚本。文中的行为判断仅承诺到已读源码与装配的证据范围。
