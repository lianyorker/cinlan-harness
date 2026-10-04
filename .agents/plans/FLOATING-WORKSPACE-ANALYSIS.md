# 浮动工作区改造分析：把「聊天」做成 UI 面板

本文记录分析与实施结果；两种形态已于 2026-10-02 落地并验证，实施结果见文末。目标来自 2026-10-02 的确认：浮动工作区应该像 Orca 那样是一个面板，内容**只有聊天**；形态可以是**悬浮**，也可以**停靠在右侧栏**。

Orca 的做法是 shell 级（`App.tsx` 里条件挂载 `FloatingTerminalPanel`），面板自带 terminal/browser/markdown 内容；我们的架构里对应物应该是**插件注册的 UI 面板**。下面说明这两种做法的差别，以及我们要付的代价。

## 两边现状

**Orca**：[`App.tsx`](D:/Company/cinlan/orca/src/renderer/src/App.tsx) 用 `floatingTerminalEnabled && (open || visibleTabCount > 0)` 懒加载 [`FloatingTerminalPanel`](D:/Company/cinlan/orca/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.tsx)，面板自己就是一块可拖动/缩放/最大化的窗口 chrome，内容由面板自己渲染（terminal/browser/markdown）。它没有把一个已有的应用面板搬到别处，而是让面板成为内容的所有者。

**我们**：[`ui-floating-workspace`](../../packages/client/ui-floating-workspace/src/client/index.ts) 的 `FloatingRuntime.toggle()` 用 `window.open` 打开**同一个应用 artifact**（`?dsh-floating-workspace=1&dsh-floating-owner=…&dsh-floating-session=…`，见 [`window-route.ts`](../../packages/client/ui-floating-workspace/src/client/window-route.ts)）。子窗口里跑的是**整个应用**：左侧导航、面板列表、主列、右侧栏都在。插件本身只贡献了切换按钮、终端上下文和设置页。

所以「窗口里只有聊天」这件事，今天没有任何机制支持。

## 我们的架构约束（决定了可行方案）

1. **`main` 是 keyed root slot，只有声明者能渲染**。[ui-layout](../../packages/client/ui-layout/src/client/AppFrame.tsx) 的 `AppFrame` 调 `renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })`，**一次只渲染一个面板**。别的包不能调 `renderSlot('main')`。
2. **会话正文是别人的子座位**。[ui-conversation](../../packages/client/ui-conversation/src/client/apply.ts) 注册 `main` 条目（key `conversation`）并声明子座位 `main.conversation`（`single`、`session-maybe`）；这个座位只由 `ConversationPanel` 渲染。功能插件拿不到它。
3. **context 级 `renderSlot` 只接受 `'root'`**；跨包组合的唯一合法方式是「渲染方在自己的 `children` 里声明座位，内容方用 `slots.inject` 注册进去」。
4. **`ctx.layout.selectPanel(id)` 只能切换主列显示哪个面板**，不能把面板搬到别的位置。
5. **一个 slot 条目今天只能渲染在一处**。[`docs/subsystems/slots.md`](../../docs/subsystems/slots.md) 描述的 `reusable: true` / `ctx.slots.renderSessionView()` 在代码里**没有任何使用者**（`reusable: true` 只出现在文档中），也就是说「同一份会话正文同时渲染到主列和悬浮面板」目前做不到。

结论：要做出「只放聊天的面板」，必须先解决**谁拥有并渲染会话正文**。

## 三个方案

### 方案 A：渲染方声明座位，会话正文注入（推荐）

浮动工作区插件注册自己的面板条目，并在注册里声明一个聊天座位；`ui-conversation` 把「会话正文」作为可复用表面注册进这个座位。

- 面板注册：悬浮用 `shell.overlay`（list, root），停靠右侧栏用 `sidebar.right.pane.tab`（keyed, **session** scope，正好带 sessionId）。
- 座位：例如 `floatingWorkspace.chat`，由面板条目的 `children` 声明。
- 内容：`ui-conversation` 把正文抽成一个可复用组件（现在只有内部 `ConversationPanel`），`slots.inject('floatingWorkspace.chat', …)` 注册进去。
- 改动包：`ui-floating-workspace`（改成面板）、`ui-conversation`（抽出可复用正文并注入一次）。
- 代价：`ui-conversation` 需要知道这个座位的 key；两侧都改，但都在既有 slot 契约内，不需要动 slots 运行时。

**变体 A′**：座位改由 `ui-layout` 声明（例如 `layout.chatPanel`），浮动工作区把面板渲染进 `layout.chatPanel`，`ui-conversation` 同时注册内容。这样布局所有权归 shell，但多引入一个中间座位。

### 方案 B：shell 提供第二处渲染位置

`ui-layout` 自己再渲染一次 `main` 的 conversation 条目（悬浮容器或右侧栏），把「把主面板搬到别处」变成 shell 能力。

- 改动集中在 `ui-layout`，功能包不用变。
- **前提是 slots 运行时支持一个条目渲染到两处**，也就是要先把文档里写的 `reusable` 语义实现出来（`ui-slots` + `ui-renderer`）。
- 收益：以后任何面板都能「搬出来」；代价：动核心渲染路径，风险与工作量最大。

### 方案 C：保留另开窗口，窗口里只渲染聊天

继续用 `window.open` 开独立窗口，但子窗口进入「聊天模式」：shell 只渲染会话面板，隐藏左侧导航、面板列表、右侧栏。

- 改动最小，且不碰 slot 架构。
- 缺点：与「我们是 UI 面板」的方向相反，仍然是 shell 特判；窗口 chrome、焦点、多窗口生命周期这套代码（[`apps/desktop/floating-window.ts`](../../apps/desktop/src/floating-window.ts)、[`apps/web/tests/settings-floating.e2e.ts`](../../apps/web/tests/settings-floating.e2e.ts)）继续维护。

## 三个方案对比

| | 面板形态 | 主要改动 | 风险 | 是否符合「UI 面板」方向 |
|---|---|---|---|---|
| A | 悬浮 / 右侧栏 | ui-floating-workspace + ui-conversation | 中（抽正文组件、座位契约） | 是 |
| A′ | 悬浮 / 右侧栏 | 上面两者 + ui-layout | 中高 | 是 |
| B | 悬浮 / 右侧栏 | ui-slots、ui-renderer、ui-layout | 高（动核心渲染） | 是 |
| C | 独立窗口 | ui-layout 的子窗口分支 + 现有窗口代码 | 低 | 否 |

## 建议

先按 **A** 做：座位由渲染方声明、内容由拥有者注入，完全落在现有 slot 契约里，不需要先动 `ui-slots`。等确认「搬面板」是通用需求，再把 B 的运行时能力补上。

## 需要你定的三点

1. **面板形态**：只做悬浮？还是悬浮与右侧栏都做（沿用现有 `toggleButtonPosition`：浮动 / 顶部 / 侧栏）？
2. **聊天范围**：只消息列表 + 输入框，还是含会话头（标题、模型选择）与工具卡片？
3. **旧路径**：是否保留「另开独立窗口」这条路径（保留则它是第三种形态，不保留则删掉 window-route / window-environment / runtime 的窗口部分与相关 e2e）。

## 决策与实施计划（2026-10-02 确认）

已定的三点：**悬浮与右侧栏都做**；内容**只有聊天列表 + 输入框**；**旧的独立窗口路径不再保留**（删掉，不做第三种形态）。

### 关键发现：不需要新座位，会话正文本来就是可复用 Factory

[ui-conversation](../../packages/client/ui-conversation/src/client/apply.ts) 用 slots.registerFactory 注册了会话正文（名字 conversation.content，scope session-maybe）；任何不相关的父级都可以用 renderFactorySlot 渲染一个**独立 occurrence**，并替换它内部的具名局部位置（views、widthControls）。[docs/subsystems/slots.md](../../docs/subsystems/slots.md) 里写的 reusable 与 renderSessionView 与本方案无关，也不需要它。

这个模式在本仓库**已经有现成实现**：[ui-subagent 的 sidebar-chat](../../packages/client/ui-subagent/src/client/sidebar-chat/index.tsx) 把 conversation.content 以 variant embedded 渲染进右侧栏标签页，并用自己选定的 views 组件只显示 chat 视图。**照抄这个模式即可。**

因此上面方案 A / A′ / B 里「抽正文组件、新座位、改渲染核心」的工作都不需要了。

### 关于会话头与工具卡片（回答「你觉得要吗」）

用 embedded occurrence：**不渲染主会话头**（标题、操作、View 标签都不出现），**正文含工具卡片**，输入框与它自带的模型选择一起出现。

- 工具卡片建议**保留**：它是消息流的一部分，去掉会让对话读不懂（模型说调用了工具，却看不到结果与审批入口）。
- 会话头建议**不做**：面板自己有标题与关闭控件，embedded occurrence 天然不带主 Header，正好是「只有聊天列表 + 输入框」。
- 不要为面板单独裁剪一套聊天组件：那会长期跟随会话演进漂移，而 embedded 已经就是这个形态。

### 实施步骤

1. **ui-floating-workspace 改成面板插件**：新增聊天面板组件（renderFactorySlot 渲染 embedded occurrence，views 固定为 chat），按现有 toggleButtonPosition 贡献悬浮（shell.overlay）或右侧栏标签页（ctx.sidebarRightTabs + sidebar.right.pane.tab）；删除 window-route.ts、window-environment.ts 与 FloatingRuntime 的窗口部分。
2. **清理旧窗口路径**：[apps/desktop/src/floating-window.ts](../../apps/desktop/src/floating-window.ts) 与其测试、[apps/web/tests/settings-floating.e2e.ts](../../apps/web/tests/settings-floating.e2e.ts)、[ui-better-sidebar](../../packages/client/ui-better-sidebar/src/client/index.tsx) 里的 dsh-floating-workspace 查询分支、[sidebar-terminals](../../packages/terminal/sidebar-terminals/src/types.ts) 的 floatingWorkspaceContext / floatingTerminalConsumer 契约。
3. **设置页**：保留启用开关与按钮位置；终端目录项随终端能力一起评估（面板不再承载终端时该项应撤）。
4. **验证**：面板内渲染当前会话且能收发消息；pnpm exec vitest run packages/client/ui-floating-workspace；重建 bundle 后重启应用人工确认两种形态。

## 实施结果（2026-10-02 完成）

两种形态都已落地并在运行中的 Web 应用里人工验证：

| 形态 | 触发 | 实测 |
|---|---|---|
| 悬浮面板 | 位置设为「浮动按钮」 | 按钮 / 快捷键打开 role=dialog 的面板，内部是消息列表 + 输入框 |
| 右侧栏停靠 | 位置设为「会话头部」 | 右侧栏出现标题为「浮动工作区」的页签，自带关闭控件，内部同一份聊天 |

### 关键实现决定

1. **聊天内容用现成的 Component Factory**：`ui-conversation` 的 `conversation.content` 以 `variant: embedded` 渲染，`views` 固定为 chat，因此没有主会话头、只有消息列表与输入框（含工具卡片）。模式与 `ui-subagent` 的 sidebar-chat 一致。
2. **面板注册在会话区内的 session 座位**（`conversation.session.header.utilities`），不是 root 级 `shell.overlay`。原因：会话内容需要会话绑定与 Conversation 域提供的上下文；放在 root overlay 里即使套 `SessionProvider` 也不具备该 provide。面板自身用 CSS 固定在会话之上，所以座位选择不影响观感。
3. **不再有窗口生命周期**：`window-route.ts`、`window-environment.ts` 及其规格已删除；`FloatingRuntime` 只管理面板开合。
4. **尺寸偏好继续有意义**：`floatDefaultWidth` / `floatDefaultHeight` 现在决定面板尺寸，而不是新窗口尺寸。

### 设置不可用的根因与修复（本轮修复）

进入「设置 → 个人 → 浮动工作区」曾显示「浮动工作区设置不可用，未使用默认值替代」。根因有两条，缺一不可：

1. **命名空间取的是加载器行 id**。设置文档用 `entry.options.id` 作为命名空间（`packages/settings/settings/src/index.ts` 的 `describe()`），web bundle 里这一行是 `ui-floating-workspace`，而客户端绑的是 `floating-workspace`，两者不匹配。
2. **Host `Config` 必须带 volatile 字段**。`volatileForm()` 只发布含 volatile 的 schema；原先 `Config` 只有部署项 `windowClosedPollMs`，没有偏好字段，于是整条 entry 被跳过。

修复：`src/config.ts` 改为导出 `FloatingWorkspaceSettingsSchema.volatile()`，`FLOATING_WORKSPACE_NAMESPACE` 改为 `ui-floating-workspace`；随窗口一起消失的部署项 `windowClosedPollMs` 已删除。修复后设置页出现开关与位置选择，值写入 profile 的 `cordis.patch.yml`（`enabled: true`、`toggleButtonPosition`）。这与通知页是同一类修法。

### 验证

- `pnpm exec vitest run packages/client/ui-floating-workspace`：44/44 通过（注册规格驱动真实 slot renderer，断言面板开合、座位、页签与设置可用性）。
- `pnpm exec tsc -b packages/client/ui-floating-workspace/tsconfig.json`：通过。
- 运行中的应用：设置页可用、两种形态可开、面板内为聊天列表 + 输入框。

### 仍未做

1. **旧窗口链路的收尾清理**：`apps/desktop/src/floating-window.ts` 与其测试、`apps/web/tests/settings-floating.e2e.ts`、`ui-better-sidebar` 里读 `?dsh-floating-workspace=1` / `window.name` 的分支、`sidebar-terminals` 的 `floatingWorkspaceContext` 与 `floatingTerminalConsumer` 契约。功能已不再使用它们，删除前需确认桌面端是否还有别的入口依赖那条路由白名单。
2. ~~**终端目录偏好**~~（已处理）：面板不启动终端，设置卡片里的目录行与其输入框/选择按钮重叠问题一并撤掉；`floatingTerminalConsumer` 接线保留给真实终端消费者。
3. 快捷键命令只在「浮动按钮」位置生效（监听器挂在悬浮入口上）；「会话头部」位置需要用按钮。

## 现状资产清单（改造时会被替换或保留）

- [`ui-floating-workspace`](../../packages/client/ui-floating-workspace/src/client/index.ts)：`FloatingRuntime`、`browserWindowEnvironment`、`window-route.ts`、`FloatingEntry.tsx`（切换按钮与子窗口关闭按钮）、设置页。
- [`ui-better-sidebar`](../../packages/client/ui-better-sidebar/src/client/index.tsx)：会读 `?dsh-floating-workspace=1` 与 `window.name` 决定是否挂载右栏，改方向后这段要一起清理。
- [`sidebar-terminals`](../../packages/terminal/sidebar-terminals/src/types.ts)：`floatingWorkspaceContext` / `floatingTerminalConsumer` 两个契约，终端目录能力挂在这里。
- [`apps/desktop`](../../apps/desktop/src/floating-window.ts) 与 [`apps/web/tests/settings-floating.e2e.ts`](../../apps/web/tests/settings-floating.e2e.ts)：窗口名、路由白名单与子窗口断言。
