# Cinlan Harness 设置与产品导航方向守卫

本文件记录 2026-10-02 确认的产品方向与已经落地的改动，用于在上游同步（`feat(upstream): sync …`）、分支合并或冲突解决时判断该往哪边取。

谁改动本文件列出的方向，必须在同一 PR 里说明理由并更新本文件；冲突时默认按本文件的方向解决，而不是按上游或旧分支。

## 总原则

设置界面只保留**官方实现**；同一产品概念只留**一个入口**。为此撤掉 Cinlan 自建的重复页与重复入口，把官方页放到产品导航的位置上。

自建实现只有在官方没有对应能力时才保留；一旦官方提供了同名能力，自建页要么并入官方页，要么整块撤掉。

合并时不要把下列"已撤掉"的注册、挂载行、页面当成"丢失的功能"补回来。

## 已落地的方向性改动

### 1. 快捷键只有一个入口

`ui-shortcuts` 同时持有个人分组的 `keybindings` 设置分区与 `shell.overlay` 的 Mod+/ 浮层，两者渲染同一个组件（[`Reference.tsx`](../../packages/client/ui-shortcuts/src/client/Reference.tsx) 的 `ReferenceSurface`）。列表先列窗口内 `shortcuts` 目录，再列 `keyboard` 注册表的命令（"其他操作"分组）。

通用设置不再有快捷键行（`settings.general.item` 注册已删除）。`ui-keybindings` 包已删除，不要重新引入。

### 2. 官方四个设置页归位

| 官方包 | 设置位置 |
|---|---|
| `ui-settings-shell` | 工作区 → 终端（groupId 已由 `execution` 改为 `workspace`） |
| `ui-settings-agent-loop` | 智能体 → Agent 循环（导航名由"工具执行"改为"Agent 循环"） |
| `ui-settings-subagent` | 智能体 → 子智能体 |
| `ui-settings-web-search` | 连接与扩展 → 联网搜索 |

这四个包不再注册 `plugins.item`，侧栏「插件」面板里不再出现它们的入口。

### 3. 撤掉 Cinlan 自建页

从 [web bundle](../../packages/bundle/web-app/cordis.patch.yml) 卸载且不要恢复：

- `ui-keybindings`（包已删除）
- `ui-settings-terminal`（自建"工作区 → 终端"，管集成终端的 Shell/字体/回滚）→ 由官方 `ui-settings-shell` 接管该位置
- `ui-orchestration`（自建"智能体 → 编排"）
- `ui-settings-automation`（自建"执行与安全 → 自动化"页 + 主面板 + 侧栏入口）

包目录可以留在仓库里，但不进 web bundle。

### 4. 浮动工作区是面板，不是窗口

浮动工作区是**应用内面板**（悬浮面板 + 右侧栏停靠页签），内容只有聊天列表与输入框：渲染 `ui-conversation` 的 `conversation.content` Factory 的 embedded occurrence，`views` 固定为 chat。面板注册在会话区内的 session 座位（`conversation.session.header.utilities`），不要改回 root 级 `shell.overlay`：那里拿不到 Conversation 域的 provide。

旧实现（`window.open` 打开同一 artifact 的第二个窗口、`window-route`/`window-environment`、子窗口聊天模式）**已废弃**，不要恢复。

### 5. 自动化的形态：设置里只有一个开关

**设置 → 执行与安全 → 自动化** 是一行开关，不是页面：由 [`ui-plugin-manager`](../../packages/client/ui-plugin-manager/src/client/AutomationSection.tsx) 注册 `settings.section`（id `automation`），开关读写 `pluginManager.listBundles` / `setBundleEnabled`，控制组合包 `@deepseek-ai/dsh-experimental-schedule-bundle`（即插件面板里的"自动化任务"卡片）。

放在 `ui-plugin-manager` 是刻意的：它不随被控组合包卸载，关掉自动化后仍能从设置里开回来。不要把这个开关挪进 `ui-schedule` 或那个组合包。

官方的 [`ui-schedule`](../../packages/client/ui-schedule/README.md) 继续提供任务管理器面板、任务详情与会话任务卡片。它**不**注册设置分区；不要再把 TaskManagerPage 挂进 Settings。

### 5. 通知页需要 live-editable schema

[`NotificationSettingsSchema`](../../packages/notifications/notifications/src/settings.ts) 本身保持普通 schema；入口注册的是 `NotificationSettingsConfig = NotificationSettingsSchema.volatile()`。设置文档只发布带 volatile 字段的 schema，去掉这个包装会让通告页回到"当前连接无法使用主机通知偏好"的不可用状态。

## 已知未修问题（同一根因，别当成已修）

下列命名空间因为 Host 侧标识或 schema 不匹配而从未被发布，客户端 `settingsScope` 会一直显示不可用；合并时不要以为它们"本来就这样"：

- ~~**浮动工作区**~~（已修）：命名空间改为加载器行 id `ui-floating-workspace`，Host `Config` 改为带 volatile 的偏好 schema；详见 [浮动工作区分析](FLOATING-WORKSPACE-ANALYSIS.md)。
- **快捷键 → 其他操作**：键盘服务绑 `keybindings`，Host 行 id 是 `keyboard`，且 Host 半边调用的是当前设置服务并不存在的 `settings.register`（静默 no-op）。

## 设置命名空间纪律（同一族缺陷已出现三次）

设置文档用**加载器行 id**作为命名空间键（settings 包的 describe()），并且只发布**含 volatile 字段**的 Config schema。这两条各挂掉一次就表现为「设置不可用 / 加载设置失败」，且不会有别的提示。已经踩过的三次：

| 页面 | 命名空间错配 | volatile 缺失 |
|---|---|---|
| 通知 | 无 | 有（已修） |
| 浮动工作区 | 客户端绑 floating-workspace，行 id 是 ui-floating-workspace（已修） | 有（已修） |
| Git 与源代码控制 | 行 id 是 git-settings，消费者读 git-source-control（已修） | 有（已修） |

新增或改动设置页时必须同时确认两件事：**行 id 与所有消费者绑定的命名空间逐字相同**；**该行的 Config 是偏好 schema 的 volatile 形式**。二者缺一即整页不可用。

## 施工与验证流程

启动应用必须用 Cinlan 的 home，否则会落到空的 `~/.dsh` profile：

```powershell
$env:CLH_HOME='C:\Users\ASUS\.clh'
Remove-Item Env:DSH_HOME,Env:DSH_PROFILE,Env:DSH_PROFILE_DIR,Env:DSH_SESSION_ID,Env:DSH_SHELL,Env:DSH_WEB_URL -ErrorAction SilentlyContinue
node --import tsx/esm apps/cli/src/bin.ts web --no-open
```

`pnpm run build` 目前在根包 tsdown 入口（`lib/types/{index,invariant,startup}.js`）上失败，这是既有问题。改客户端插件后按包重建，Host 半边用 `tsc -b` 加一次 tsdown：

```powershell
pnpm --filter @deepseek-ai/dsh-client-ui-shortcuts run bundle
pnpm exec tsc -b packages/notifications/notifications/tsconfig.json
```

注册表服务的是 `lib/client.js` 与 `lib/index.js`，不重建就看不到改动。

核对清单：`pnpm exec vitest run packages/client/<包>`、`pnpm run verify-client-packages`、`pnpm run verify-translation-pairing`、`pnpm run verify-client-ui-i18n`。

## 相关文档

- [浮动工作区改造分析](FLOATING-WORKSPACE-ANALYSIS.md)
- [Git 与源代码控制设置对齐 Orca 的方案](GIT-SETTINGS-PLAN.md)：分阶段补齐，设置项必须先有消费者。
- [执行主机完整端点模型方案](SSH-ENDPOINT-HOSTS-PLAN.md)：把执行主机做成 Orca 式 SSH 目标管理（含四层改动与策略变更说明）。：把聊天做成悬浮/右侧栏 UI 面板的三条路线与架构约束（待确认，未实施）。

- [Cinlan 设置架构](../../reports/design/cinlan-feature-navigation.md)：导航分组与功能归属的现行权威。
- [单快捷键入口 Agent Note](../../.agents/notes/implemented/architecture/2026-10-02-single-shortcut-reference-surface.md)：快捷键合并的取舍与验证。
- [UI 插件槽位纪律](../../packages/client/AGENTS.md)：跨包只能通过 slot 与服务协作，功能插件之间不得互相值导入。
