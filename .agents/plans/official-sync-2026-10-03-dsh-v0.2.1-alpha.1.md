# 官方同步计划：dsh-v0.2.1-alpha.1（2026-10-03）

本文件是执行前的计划，不是同步结果记录。沿用 [official-sync-2026-09-18.md](official-sync-2026-09-18.md) 的做法：逐项适配官方改动，不整体合并；验证完成前不得声称已全量合并官方版本。发行说明见 [dsh-v0.2.1-alpha.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)。

## 1. 来源与基线

| 项 | 值 |
|---|---|
| 官方来源 | tag `dsh-v0.2.1-alpha.1` = `5badb15009ae1756c3afe0ae0cef1faafc290ccc`（prerelease，2026-10-03T06:42:19Z 发布，指向 master） |
| 官方上一版 | `dsh-v0.2.0-rc.2`（本次 fetch 后本地已有） |
| 本地起点 | `72848fae42`，分支 `codex/settings-task-navigation`；工作树另有 368 项未提交（187 已修改 / 141 未跟踪 / 40 已删除） |
| 共同祖先 | `4878cdabd87d4041bdaff61d04c966883b9fd07a`（官方 `release(dsh): 0.2.0-rc.1`） |
| 官方领先 | 453 个提交（含合并）、4595 个文件、+83726 / −38343 |
| 本地领先 | 196 个提交、158 个本地新增包（`packages/<组>/<包>`） |
| 重叠文件 | 756 个：`.agents/notes` 364、`apps/web/tests` 29、`docs` 18、`packages/*/src` 27、`packages/*/tests` 10、`apps` 34，其余为配置文件 |

官方"其他变更"一栏的 4 条是对外破坏性变更，并各自附带升级指南（`docs/upgrade-guide/v0.2.0-rc.2/`）。本计划以这 4 条为必改主线，其余按建议采纳与待决策分级。

## 2. 必改项

### 2.1 运行时 invariant 插件整体移除

- 官方依据：`f028f25667 refactor: remove runtime invariant plugins`、`963715344b test: cover paths previously exercised only by invariant companions`、`f1f0dc54ff`；指南 `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants`。
- 官方动作：不再发布 `@deepseek-ai/dsh-invariants`、`InvariantRegistry`、`InvariantInstaller`、`InvariantFailure`、`InvariantError` 及任何 `<package>/invariant` 子路径；`sdk-minimal` 去掉 5 行；四个 emitter 改为记录监听器失败而非重抛。连带删除 `scripts/gen-scoped-events.ts`、`scripts/package-invariants.ts`、`scripts/test-invariants.ts`、`scripts/verify-package-invariants.ts`、`scripts/verify-built-package-invariants.mjs` 及其 spec，以及 `packages/core/scope/src/scoped-events.generated.ts`（scope 包由 4 个源文件减为 2 个）。
- 本地受影响面：
  - 42 个包导出 `./invariant`，其中 4 个是本地自建包：`packages/execution-host/execution-binding`、`packages/mcp/mcp-management`、`packages/security/assessment-scope`、`packages/security/finding`。
  - 2 个本地自建包声明 `@deepseek-ai/dsh-invariants` 依赖：`packages/bundle/security-research`、`packages/compaction/compact-recallable`。
  - 155 处 `.ts` 引用 `@deepseek-ai/dsh-invariants` 或 `<package>/invariant`（绝大多数属于官方包，随官方文件替换消失；本地自建包的伴生需要逐个删除）。
  - 2 个 patch 引用被移除的行：`packages/bundle/sdk-minimal/cordis.patch.yml`（`invariants`、`session-invariant`、`agent-invariant`、`scope-invariant`、`agent-loop-invariant`）、`packages/bundle/security-research/cordis.patch.yml`。
  - 门禁与脚本：根 `package.json` 的 `verify-package-invariants`、`verify-built-package-invariants`、`gen-scoped-events`、`verify-scoped-events`；`scripts/run-gates.ts` 的 `package-invariants`、`built-package-invariants`、`scoped-events` 三处注册（L349、L395/L502/L509/L529/L616、L726-L728、L760-L761、L793）。
  - 文档与目录生成物：`packages/core/scope/README*`、`docs/config-catalog*`、`docs/module-graph*`、`tsconfig*.json`、`AGENTS.md` 中 `@dshScopeScan unsupported` 约定。
- 适配动作：本地 4 个自建包删除 `./invariant` 导出、`src/invariant.ts`、`tests/invariant.spec.ts`、依赖与 tsconfig reference；删除上述 8 个脚本文件、4 个 npm script 与 3 处 gate 注册；同步官方 scope 包；重生成受影响目录与图；`security-research` patch 去掉 invariant 行。
- 验收：`pnpm run typecheck` 无 missing module/export；profile 启动无 module-not-found 与 `patch: entry ... not found`；删除伴生测试后按覆盖率规则补齐原本只由 invariant 覆盖的路径（官方补测提交 `963715344b` 是参照）。

### 2.2 子路径插件显示清单

- 官方依据：`8339f16c1d fix(plugins): read package.json only for package-root plugins`、`f8a274b76e`、`d9a40155c1`（指南 `subpath-plugin-display-manifest`）、`e0358d76bc`、`310c5ae151`。
- 官方动作：子路径插件不再读 `<subpath>/package.json`；标题与描述只来自 `<subpath>/locale/*.json` 的 `meta.title`/`meta.description`，图像来自 `<subpath>/icon`；包根插件保留 `package.json` 与 `icon`；新增 `verify-package-meta` 门禁。
- 本地受影响面：`git grep` 未发现 `./<子路径>/package.json` 导出（只有 4 个 `packages/extensions/*` 导出包根 `./package.json`，属于允许范围），预计无直接改动。本地 `scripts/verify-package-meta.ts` 与 spec 都已存在，并已在 `scripts/run-gates.ts` 注册为 `package-meta` 门禁（L350），但根 `package.json` 缺少 `verify-package-meta` 条目（见 2.6）。
- 适配动作：按官方同步 `scripts/verify-package-meta.ts` 与 `packages/extensions/*` 的清单规则，并补上根 `package.json` 的 script 条目；对本地自建包抽查标题、描述、图标来源。
- 验收：`pnpm run verify-package-meta` 通过；插件管理页中子路径行显示标题、描述与图标。

### 2.3 Automation / Schedule 组合包退役与内置化

- 官方依据：指南 `docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired`、`9633724b40 fix(app-boot): drop the retired schedule bundle from profile manifests`、`699f1a8dc1 feat(schedule): deny the reminder tools to delegated children`、`1b1b09e1fb`；新增包 `packages/schedule/tool-schedule`；`packages/bundle/web-app/presets/{standard,cordis,ptc}.patch.yml` 声明时钟读数与 4 个 `schedule_*` 工具，`minimal` 不声明。
- 官方动作：删除 `packages/experimental/schedule-bundle`（10 个文件）；`@deepseek-ai/dsh-web-app` 在每个 Web profile 挂载 `schedule` 与 `ui-schedule`；加载 profile 时把该 bundle 从 `dsh.profile.bundles` 清除并改写 `package.json`；委派子代理不获得提醒工具。
- 本地受影响面：
  - `packages/experimental/schedule-bundle` 仍存在；引用点：`apps/cli/package.json`、`tsconfig.base.json`、`tsconfig.host.json`、`packages/boot/app-boot/src/profile.ts`（`OPTIONAL_BUNDLES`，L227）、`apps/cli/tests/profiles/web/tests/schedule-timing.expected.e2e.ts`、`apps/web/tests/schedule-after.e2e.ts`、`apps/web/tests/fixtures/time-context-every-step.patch.yml`，以及 `docs/config-catalog*`、`docs/module-graph*`、`docs/subsystems/schedule*`、`docs/user/guide/schedule*`。
  - 本地自建 `@deepseek-ai/dsh-automation` + `@deepseek-ai/dsh-api-automation-controller` + `@deepseek-ai/dsh-client-ui-settings-automation` 在 `packages/bundle/web-app/cordis.patch.yml` 挂载（id `automation`、`automation-controller`）。该包在官方 0.1.7 之后已从上游下线，本地自行保留，与官方本次"自动化任务内置化"是两套重叠能力。
  - 本地 `packages/bundle/web-app/cordis.patch.yml` 不含 `schedule`/`ui-schedule` 行，但 `package.json` 仍依赖 `@deepseek-ai/dsh-client-ui-schedule`。
- 适配动作：先完成第 4 节的决策，再执行；无论选哪条，都要移植 `9633724b40` 的 profile 清理逻辑与 `699f1a8dc1` 的子代理拒绝语义。
- 验收：`dsh.profile.bundles` 不再列出该 bundle；插件页无失败条目；侧栏任务页显示既有提醒；`--profile` 冷启动与已存任务恢复的 e2e 通过。

### 2.4 输入区统计拆分为 activity / usage

- 官方依据：`2190082866 refactor(ui-chat): register composer stats pills as separate dock entries`、`1f8cdc08a1`。
- 官方动作：`conversation.composer.dock` 的单个 `stats` 入口拆为 `activity` 与 `usage` 两个独立入口；覆盖旧 `stats` 整行的插件需要更新注册 ID。
- 本地受影响面：唯一注册点 `packages/client/ui-chat/src/client/apply.ts`（`id: 'stats'`，L286）；本地自建 `packages/client/ui-settings-usage`、`packages/api/usage-controller`、`packages/session-query/usage-query`，以及未跟踪的 `packages/client/ui-dockkit`、`packages/client/ui-shortcuts` 需要核对是否按 `stats` 行 ID 覆盖或读取 `performanceUsage` hook。本地与官方同时改了 `packages/client/ui-conversation/src/client/contract/slots.ts`（dock 契约所在）。
- 适配动作：跟随官方拆分；全仓检索 `stats` 行 ID 的引用（含 patch/overlay 与测试），更新本地插件注册 ID 与 locale 文案归属。
- 验收：`pnpm run test:gui`；输入区统计两个入口各自可展开，旧的单行覆盖不再存在。

### 2.5 账号登录错误码（需核对）

- 官方依据：指南 `docs/upgrade-guide/v0.2.0-rc.2/account-sign-in-errors`：`SignInErrorCode` 新增 `no-response`，用于 fetch 在返回 Response 前失败（含超时）；HTTP 错误仍为 `network`。
- 本地状态：本地已做过 `b9e1b9c088 port rc2 selective integration: sub2api account authorization ...`，需核对本地校验器、`SignInAttemptView.errorCode` 穷尽处理与登录 UI 文案是否已覆盖 `no-response`；未覆盖则按指南补齐。

### 2.6 门禁脚本引用与 package.json 条目不一致（基线缺陷，先行核对）

- 事实：`scripts/run-gates.ts` 引用了 79 个 npm script，其中 12 个在根 `package.json` 中不存在：`test:approval-policy`、`verify-client-route-resolution`、`verify-concrete-terms`、`verify-default-product-isolation`、`verify-dependency-catalog`、`verify-no-unknown-casts`、`verify-package-meta`、`verify-persistence-changes`、`verify-persistence-formats`、`verify-persistence-releases`、`verify-plugin-packages`、`verify-repository-references`。
- 其中 6 个已有实现与 spec（`scripts/verify-client-route-resolution.ts`、`verify-concrete-terms.ts`、`verify-default-product-isolation.ts`、`verify-no-unknown-casts.ts`、`verify-package-meta.ts`、`verify-repository-references.ts`），只缺 script 条目；另外 5 个连实现都不存在（`verify-dependency-catalog`、`verify-persistence-{changes,formats,releases}`、`verify-plugin-packages`）以及 `test:approval-policy`（无 approval 相关脚本文件）。
- 官方 tag 的 `package.json` 中这些名字全部存在，说明本地 `run-gates.ts` 已来自较新的上游谱系而 `package.json` 未同步。
- 动作：P0 先跑一次 `pnpm run check:ci:static` 记录真实失败面，再决定补齐 6 个 script 条目、删除无实现的 gate 注册，还是随本轮同步整体对齐官方 gate 清单。任何情况下都不把该失败算作本轮改动引入。

## 3. 建议采纳项（非破坏性，逐项评估）

| 官方改动 | 官方提交 | 本地适配范围 |
|---|---|---|
| Desktop 默认使用系统分配端口 | `ecd9bf9273`（仅 `apps/desktop-host/src/index.ts` 一行） | 本地未改该文件，可直接采纳；采纳后在 Windows 上验证启动 |
| 插件管理：样式归属、运行时依赖映射、安装版本显示与冷却说明 | `abf8b760ec`、`869afc493d`、`99fce8d4ea` | 本地自建插件管理相关设置页与 `packages/client/ui-settings-general`（6 文件重叠）需回归 |
| HMR 刷新入口与依赖映射配置 | `a59beb8ae3`、`b1c5f861b6`、`d7d2e5fd4e` | 本地 bundle/插件热更新路径，需与自建 bundle 组合验证 |
| 新会话预填未发送提示、草稿跨工作区保留 | `e400349e3a` 等 | 客户端草稿目录与 `ui-better-sidebar`/草稿相关包 |
| Markdown YAML frontmatter 字段列表 | `0cad3a0137`、`39c614a143` | `ui-sidebar-documentpreview` 相关；本地文档预览改动需合并 |
| 会话列表读取提速、侧栏加载动画同步、窄窗自动化详情 | 发行说明"体验优化" | 客户端列表与自动化详情页 |
| Web `--public-url` | `a7c3ad99bc feat(web): advertise a configured public application URL` | 新增 `packages/bundle/web-app/src/public-url.ts` 与 CLI 参数；本地 0 命中，需要落到 `clh web` 与 CLI reference/文档 |
| 开发者工具组合包（会话原始日志、聊天双向定位、内嵌 Host 调试） | `732dd913cf`、`38c45638a2`、`dcdf631ca2`、`ad22e6c80f` | 新包 `experimental/session-inspector`、`inspector-profile`；与本地已改的 `packages/experimental/inspector`（12 文件重叠）冲突集中，需逐文件比对 |

## 4. 待决策项（需要产品结论后进入 P3）

1. **Automation 与 Schedule 的关系**。选项 A：跟随官方，删除 `experimental/schedule-bundle`，采纳 Web 内置 `schedule`+`ui-schedule` 与预设作用域提醒工具，本地 `@deepseek-ai/dsh-automation` 降级或迁移到 schedule 服务之上；选项 B：保留本地 automation 作为产品主线，只移植官方的 profile 清理与子代理拒绝语义；选项 C：双轨并存（会造成两套任务/提醒 UI，不建议）。影响面：`packages/bundle/web-app/cordis.patch.yml`、`packages/automation/*`、`packages/client/ui-settings-automation`、`packages/client/ui-schedule`、`apps/cli/package.json`、`tsconfig*`、四处文档与两个 e2e。
2. **是否采纳 Claude Code Mods 兼容层**（新包 `experimental/claude-code-mods`、`experimental/client-ui-claude-code-mods`）。需要先确认它与本地 skill/mod 能力是否重叠、是否只作实验能力提供。
3. **是否默认启用开发者工具组合包**（官方为可选组合包，内嵌 DevTools 目前为英文界面）。
4. **版本号策略**。本地包版本混杂（330 个 `0.2.0-rc.1`、106 个 `0.1.7-rc.2`），本轮同步是否统一提升、是否发布 `clh-v0.2.1-alpha.1` 需要结论。

## 5. 执行阶段

- **P0 冻结基线**：提交或归档 368 项未提交改动（含整包删除 `ui-browser-element-capture`、`ui-keybindings`，未跟踪 `ui-dockkit`、`ui-shortcuts` 等）；记录基线 SHA；`pnpm install --frozen-lockfile`；先跑一次基线 `pnpm run typecheck` 与 `pnpm run test:gui` 并记录既有红点，作为后续对照。
- **P1 官方文件面适配**：按"官方提交 → 本地文件"逐项 cherry-pick 或手工适配，优先干净替换面（`apps/desktop-host/src/index.ts` 端口、plugin-manager、HMR、客户端体验项）；对 7 个全重叠的 `packages/bundle/web-app` 文件单独处理。
- **P2 破坏性迁移**：按 2.1 → 2.2 → 2.4 →（决策后）2.3 的顺序执行；每步重生成目录/图并跑对应门禁。
- **P3 决策项落地**：第 4 节结论对应的实现与文档。
- **P4 验证与文档**：`doc-sync`、双语文档配对、Agent Note（非平凡改动必须有）、目录与门禁清单回归。

## 6. 验证矩阵

| 层级 | 命令 | 覆盖 |
|---|---|---|
| 安装 | `pnpm install` / `--frozen-lockfile` | 删除包后的 lockfile 与 workspace 解析 |
| 类型 | `pnpm run typecheck` | 移除的模块与符号、tsconfig references |
| 单测 | `pnpm run test`、`pnpm run test:gui` | 受影响包与客户端 |
| 覆盖率 | `pnpm run test:coverage`（必要时分区） | 删除 invariant 伴生后的逐文件 100% |
| 组合 | `pnpm run verify-cordis-config`、`verify-config-catalog`、`verify-module-graph`、`verify-tsconfig-paths`、`verify-package-meta` | patch、目录、图、路径、插件清单 |
| 文档 | `pnpm run test:docs`、`pnpm run doc-sync` | 升级指南引用、双语配对、预算 |
| 回放 | `pnpm run test:snapshot`、`DSH_SNAPSHOT=replay pnpm run test:web` | 键值回放的会话与 Web 行为 |
| 应用 | `pnpm dsh --profile <profile>`（本地 `pnpm clh`）冷启动 + 已存 profile | profile 清理、内置 schedule、插件行 |
| Desktop | `pnpm run build:desktop` / 定向打包冒烟 | OS 分配端口 |

## 7. 风险与未决问题

- 工作树有 368 项未提交改动，且包含整包删除与新增，未冻结前任何同步都会污染 diff。
- 756 个文件重叠、158 个本地新增包与官方能力存在功能重叠（automation/schedule、inspector、browser/computer-use），逐项适配的工作量集中在决策项 1 与开发者工具组合包。
- 覆盖率门禁为逐文件 100%，删除 4 个自建包的 invariant 伴生后，原本只由伴生覆盖的路径必须补测，否则 CI 覆盖率闸门失败。
- 本地 `ui-dockkit`、`ui-shortcuts`、`ui-floating-workspace` 等尚未提交的重构与官方 2.4、体验类改动落在同一批客户端文件上，顺序安排不当会产生返工。
- 本计划基于 2026-10-03 的 `dsh-v0.2.1-alpha.1` 与本地 `72848fae42`；官方若有新 tag 或本地基线移动，需重新计算重叠面。
