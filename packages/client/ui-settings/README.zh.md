---
description: "dsh Web 客户端的设置持久化、schema 操作、本地化搜索元数据与类型化页面导航。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings

[English](README.md) | 中文

## 概述

本包使 Web 客户端功能能够公开由宿主设置文档支持的可编辑偏好设置，而无需自行实现传输或 schema 处理。每项功能都可按命名空间读写、原子更新多个字段、校验 schema，并避免静默覆盖并发更改。功能可以为设置页面分组，并让公开字段标签按当前语言参与搜索。类型化扩展点支持设置页面、插件标签页和引导流程。设置外壳由单独的包渲染。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

功能插件用本包存储与编辑自己的偏好设置，而无需重新实现传输层或 schema 处理。每个组合挂载一次即可；它注入 `remote` 服务及其 `settings` 命名空间，并持有浏览器中唯一的 `settings.describe` 读取方。

### 绑定命名空间

功能调用 `ctx.settingsScope.bind(spec)` 并传入按命名空间的 spec，得到一个由共享文档镜像派生的 scope。scope 快照携带解析后的分区、组合 `base`、原始 `user`、revision、可写性以及 host/内存模式；字段只要出现在 `user` 中即视为覆盖，即使其值与 `base` 相等，`unset` 会清除该覆盖。写入经 scope 进行：`set` 与 `unset` 提交一个操作，`mutate` 则原子提交多个有序操作。每次写入都以命名空间 revision 作为 `expectedRevision` 围栏，因此来自另一界面的并发写入会被拒绝，而不是被静默覆盖。暂存编辑器可以把开始草拟时读取的 revision 作为固定围栏传入；否则 scope 使用最新排队或镜像 revision。

### 填充设置 slot

设置界面会注册进本包声明的 slot 类型。外壳（`sidebar.settings` 占位方、导航、界面框架）位于 ui-settings-general；功能页面注册 `settings.section` 贡献；「插件」分区承载 `settings.plugins.tab` 页面；首次使用引导步骤注册 `settings.onboarding`。跨命名空间的表面（schema 内省、已服务命名空间目录、`hasDocument`）通过 `ctx.settingsScope.describe()` 读同一面镜像。

### 设置分组与搜索

页面所有者调用 `ctx.settingsMetadata.registerSection({ sectionId, groupId })`；字段所有者调用 `registerItems(sectionId, items)`，传入稳定的条目 id、分区内唯一的锚点 id、本地化标题解析函数，以及可选的说明与关键词解析函数和标签页 id。省略关键词时解析结果为空数组。解析函数复用可见的 locale 文案，不得返回当前值、凭据、令牌或用户目录内容。服务只发布声明的元数据字段。[元数据类型](src/client/settings-metadata.ts) 定义了六个分组 id 与可接受字段。

在同一个 `slots.inject` 生命周期中注册元数据与对应组件，并 yield 各自返回的 disposer。重复的分区 id、条目 id 或锚点会使注册失败；条目和锚点必须在整个分区的所有标签页之间保持唯一。条目可以先于分区元数据注册。删除分区归属不会删除独立所有的条目；外壳将元数据与存活的分区 slot 联接后才展示导航或搜索结果。页面标签、排序和图标仍归 slot 所有。

通过注册时的 `inject.hooks` 传递稳定的元数据 observable。快照在变更之间保持引用一致，每次 locale revision 变化都会重新解析文案，包括字典的注册与移除。外壳可通过分区和插件标签页可选的 `target` owner prop 传入 `SettingsNavigationTarget`；页面先激活 `target.tabId`，再由外壳定位对应的 `data-settings-anchor`。

### 可观察的成功与失败

`mutate` 仅在 Host 接受此次修改信封时解析为 `true`。Host 拒绝、内存模式或发送前释放均解析为 `false`；传输失败在所需的最新写入恢复后继续拒绝。若更新的排队写入或释放抑制了已发送结果的发布，接受结果仍为 `true`。保存处理器必须要求明确接受，并保留领域专用的原始值与有效值检查；仅读回匹配值不能证明自身写入成功。调用方需在页面或草稿已变化时抑制过期反馈。`set` 与 `unset` 仍是 `Promise<void>` 便捷方法，会等待并丢弃接受结果。

绑定后的 scope 会立即反映当前文档 revision；提交成功的写入把应答折回镜像、不再重读。被拒绝或失败的最新写入触发一次镜像恢复读取；被取代的写入把恢复留给后继者。若 spec 未提供 `decode`，则分区不是普通对象或未通过 schema 重建时一律不发布任何值，于是行渲染自己的缺失状态，而不是一份半解码的值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包持有共享的设置文档镜像，以及独立的公开导航元数据注册表。偏好设置读取方从镜像派生数据；设置外壳从元数据注册表派生分组与字段搜索。

### Describe 镜像

插件注入 `remote` 及其 `settings` 命名空间，从固定的 `remote.$host` 事实一次性解析 Host 持久化模式，并持有浏览器中唯一的 `settings.describe` 读取方：一面共享镜像，在每次转发的 `settings/document-updated` 事件与 `connection/reset` 时刷新（首次连接也包含在内，关闭「提交落在急切读取与 SSE 订阅之间」的窗口）。跨命名空间表面通过 `ctx.settingsScope.describe()` 读它，这是一个读取/折叠面（`getSnapshot`/`subscribe`/`ensure`，另有把写应答折入的 `acceptView`）。

### Scope 派生

`ctx.settingsScope.bind(spec)` 在调用方的 context 上返回一个由镜像派生的按命名空间 scope：scope 的 disposer 归调用方 fiber 所有，绑定不新增任何线路读取，某一行的激活绝不会阻塞在设置传输层上。写入仍归各 scope：`set` 与 `unset` 是 `mutate` 的单操作形式，后者会复制操作列表，并把多个有序字段操作排在同一个作为 `expectedRevision` 的命名空间 revision 之后。提交成功的 mutation 把应答折回镜像，被拒绝或失败的最新 mutation 触发一次恢复读取，被取代的 mutation 把恢复留给后继者。冷启动读取次数由 `../../../apps/web/tests/startup-rpc-budget.e2e.ts` 钉住；客户端代码中新增直连 `settings.describe` 调用即是对它的回归。

### 元数据生命周期

[元数据服务](src/client/settings-metadata.ts) 将注册归属于各调用方的 Cordis effect 生命周期，并在注册或释放成功后发布不可变快照。locale 插件依赖 `settingsScope`，因此元数据通过子注入观察 locale revision，避免阻塞设置服务的激活。元数据仅存在于浏览器内，不读写设置值。

### Schema 服务

`ctx.settingsSchema` 为设置插件执行同步 schema 重建、校验与不可变路径编辑。若 spec 未提供 `decode`，则分区不是普通对象、未通过其重建后的 schema 校验、或携带本客户端无法重建的 schema 信封时，一律不发布任何值。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖设置界面家族及其背后的持久化 seam。

- [ui-settings-general](../ui-settings-general/README.zh.md)——设置外壳：触发控件、导航、「通用」分区、引导投影。
- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——「插件」分区及其可配置宿主平面卡片。
- [ui-settings-models](../ui-settings-models/README.zh.md)——建立在本底座之上的 Models 页面与 DeepSeek 引导。
- [settings](../../settings/README.zh.md)——持久化用户设置 seam 及其文件提供方。
- [ui-sidebar](../ui-sidebar/README.zh.md)——底部席位承载设置触发控件的侧边栏外壳。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明设置传输层够不到的地方；它们是当前包约束。

- **非 loopback 页面没有持久化设置**：本 Client 在那里禁用 Host 持久化，因此 scope 以 `unavailable` 起步且从不跨线路；尽管 Connection 认证覆盖 API，它支撑的每一行仍在那里无效。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。元数据注册表在注册时拒绝归属冲突，并直接从注册项派生快照；设置 scope 从同一份共享文档镜像派生。本包没有需要在运行时比较的独立观测值。
