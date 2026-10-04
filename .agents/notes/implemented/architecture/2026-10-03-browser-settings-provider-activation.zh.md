# Agent Note：浏览器设置呈现 Browser Use 安装流程并编辑实时偏好

Status: implemented

[English](2026-10-03-browser-settings-provider-activation.md) | 中文

## 问题

设置 → 浏览器对明明已经装载浏览器能力的组合显示“未配置匹配的服务提供者”，全部浏览器偏好字段显示“不可用”，运行时区块以安装和修复为首要操作。

改动前在本机 `web` 组合上实测：`pluginManager.listPlugins()` 返回 `include:browser-playwright`，其 `moduleName` 为 `'@deepseek-ai/dsh-browser-playwright'`、`enabled: true`、`fiberPhase: 'active'`，即 Host 清单本身正确。客户端区块却按“每种能力一个精确模块名”过滤该列表，于是任何由 bundle 行、改名后的提供者行或元素捕获工具提供同一能力的部署，都会被报告成“未配置”。匹配到但配置档补丁无法寻址的条目（`readOnlyReason: 'unaddressable'`）只是把按钮置灰，区块整体仍像坏掉。

偏好表单与链接路由表单通过 `settingsScope.bind` 绑定设置命名空间。设置服务只为 **Config schema 含 volatile 字段** 的 Loader 条目发布命名空间，而 `@deepseek-ai/dsh-browser-playwright` 一个都没有：`describe()` 列出 24 个命名空间，其中没有 `browser-playwright`，两个表单因此都退化为不可用，什么都保存不了。

## 决策

**能力条目按角色匹配，不再只认一个模块名。** [capability-matchers.ts](../../../../packages/client/ui-settings-security/src/client/capability-matchers.ts) 同时给出页面组件诊断用的 `CAPABILITY_MATCHERS` 与每个页面可启停条目的 `PROVIDER_MATCHERS`；每个模式既列出提供该能力的包，也列出把这些条目组合成一行的 bundle（`@deepseek-ai/dsh-cinlan-browser`、`@deepseek-ai/dsh-cinlan-computer-use`、`@deepseek-ai/dsh-cinlan-mobile-device`）。带 `readOnlyReason` 的条目渲染运行状态与一句“由配置档管理”，不再渲染控件，于是 bundle 管理的部署报告“已加载”而不是“未配置”。各页面启停控件消费的插件管理器回调位于 [capability-shared.ts](../../../../packages/client/ui-settings-security/src/client/capability-shared.ts)；逐个打印匹配条目的独立区块已删除，因为每个页面自己拥有它展示的条目。

**浏览器条目自己拥有实时设置命名空间。** `@deepseek-ai/dsh-browser-playwright` 的 Config 中八个用户偏好字段标记为 `volatile()`，这正是设置服务发布 `browser-playwright` 命名空间的依据；`apply()` 注册 `settings.configure({ auto: false })`，使页面表单成为唯一编辑入口，不再生成重复的配置页。读取配置时用 `configValue` 解开 Loader 的实时引用，使经命名空间编辑的值与 `cordis.yml` 中的普通值解析结果一致（[index.ts](../../../../packages/browser/browser-playwright/src/index.ts)）。

**“现有会话”是一种显式连接模式。** `attach` 与 `attachPort` 让 Provider 通过 `chromium.connectOverCDP` 连接正在运行的 Chromium，而不是启动自己的持久浏览器，于是 Agent 工作在用户已登录的会话里。被连接的浏览器属于用户：Provider 接收一个释放钩子，销毁时断开 Playwright（对 CDP 连接调用 `browser.close()`），而不是关闭被连接的上下文。连接失败会指明端点与启动它所需的 `--remote-debugging-port` 值。该模式下不申请托管运行时租约。

**已保存的配置由属主列出、由自身动作关闭。** Provider 通过能力缝回答配置清单（`BrowserProvider.listProfiles` → `browser.listProfiles`），因此设置页提供的是 Host 真正保存的配置——`default` 加上 `storageDir/harness-profiles/profile-<name>` 下的每个目录——并标明所选配置是否已存在，而不是让用户盲填名称。该清单不通过 Remote 暴露目录。连接模式下，运行时区块报告“已连接”并提供「断开」而非「关闭」，因为销毁只是断开。

**新增的 `zoom` 偏好是真实的启动输入。** `BrowserPreferences` 增加 `zoom`（0.25–5，默认 1）；提供者按 `视口尺寸 / zoom` 布局页面、再按配置尺寸栅格化，因此大于 1 的缩放会放大 Agent 读到的每个渲染像素，而截图尺寸保持配置值不变。

**页面把 Browser Use 呈现为三项用户步骤。** 设置卡片以 0/3 进度表示 Browser Use 启用、tool-browser skill 条目和一次成功的 Cookie 导入；skill 步骤显示官方更新命令并支持复制，不执行本地 shell 命令。示例区包含三条可复制提示。主页、搜索引擎、默认缩放、聊天链接路由和已保存配置保持为独立设置。Provider 名册、运行时安装、连接、页面检查、历史、网络与传输操作收在「高级设置」折叠内。

**计算机控制使用官方 skill surface，而不是实验性 Provider 表单。** 官方 `@deepseek-ai/dsh-computer-use` 能力由可选 `@deepseek-ai/dsh-cinlan-computer-use` bundle 提供。设置页采用安全研究式下载卡，显示官方更新命令 `cinlan skills update --skill computer-use`，并保留 profile bundle 安装状态与运行详情。页面不再渲染实验性 CUA Provider 启停区块。

**手机模拟器由一张设置卡与一张智能体卡组成。** 设置卡包含本页检查开关、带状态徽标与重新检查的可用性、含下载/使用检测到/清除动作的 Android SDK 行、自定义 SDK 路径和默认设备。智能体卡以 0/2 徽标把能力条目与工具条目列为两步，列出 `dsh --profile device-control` 与 `mobile_*` 工具名，并提供三条可复制示例提示。可用性与工具链探测保持只读；只有开关、SDK 路径和默认设备参与草稿表单。

**运行时维护被降级。** 安装、修复、移除、取消与关闭浏览器移入标题为“详情与维护”的 `details` 折叠；资源来源、版本、修订号与安装事实仍然可见。页面把能力呈现为已组合的能力，而不是待下载的资源。

**链接路由改用聊天拥有的偏好。** 该区块读写 `ui-chat` 的 `linkOpening`（“应用内侧边栏浏览器”或“系统浏览器新标签页”），不再在 `dsh-better-sidebar` 下维护同一决定的第二份副本——本组合从不挂载后者。内侧选项需要已随包发布的 `ui-sidebar-browser` 条目，因此该区块经插件管理器读取该条目，并在它存在、被停用且可寻址时就地提供一个启用动作，同时说明在此之前链接不会打开。

## 考虑过的替代方案

- **在 web 组合里挂载 `dsh-better-sidebar`，让链接路由处处可用。** 否决：其 host 半调用 `settings.register(ns, schema)`，而本检出中的设置服务并未实现该 API，命名空间依旧不会出现，条目还会激活失败。
- **保留精确模块匹配，另加一份提供者名称回退表。** 否决：bundle 行本身就是该能力的一等提供者，名称表只是把同样的过期问题挪个位置。
- **只存 `zoom` 而不接消费者。** 否决：不产生任何效果的偏好比没有这个偏好更糟。
- **为浏览器命名空间单独建一个设置属主包（`dsh-git-settings` 模式）。** 因范围否决：把提供者自身的偏好字段标为 volatile 就能得到同一命名空间，无需新增工作区包与额外 profile 行。

## 后果

- 从页面保存会把整行 `browser-playwright` 写入配置档补丁，因为配置编辑器会具体化取自 bundle 层的条目。与组合默认值相同的值不改变行为。
- 保存后的偏好需重启当前配置档生效，页面已如此说明。
- 启用不会启动浏览器，保存成功也不会授予任何操作批准。
- 链接路由写入官方聊天偏好，因此被路由的链接会落在聊天与内置浏览器本就一致认可的位置；内侧选项在 `ui-sidebar-browser` 启用前不生效，而页面现在就地提供该启用动作。

## 测试

- `node_modules/.bin/vitest.CMD run packages/client/ui-settings-security` —— 131 项，包含“由 bundle 提供的能力必须报告已加载与配置档管理行、而不是未配置文案”、两种语言下默认缩放的草稿与保存路径、现有会话开关与其端口，以及配置的选择、新建、拒绝与“Host 无法列出”的回退。
- `node_modules/.bin/vitest.CMD run packages/browser/browser-playwright` —— 66 项，包含缩放校验、volatile 引用读取、缩放后的启动视口、没有设置提供者时仍可挂载，以及连接现有浏览器（指名 CDP 端点，销毁时调用连接自身的 close 而非被连接上下文的 close）。
- 两个包的 `node_modules/.bin/tsc.CMD -b`，以及 `node --import tsx/esm scripts/verify-client-ui-i18n.ts` 对 `packages/client/ui-settings-security` 零命中。
- 实机 `--profile web` 运行：配置控件列出已保存的配置；在页面上新建 `research` 后 profile 补丁写入 `profileName: research`，重启后字段回读该值；连接模式开启时运行时区块显示“已连接”说明。
- 以 `--remote-debugging-port=9222` 启动的 Chrome 上做实机 `--profile web` 运行：保存连接开关后 profile 补丁写入 `attach: true` 与 `attachPort: 9222`，重启后的 profile 在页面选择器里列出了该浏览器真实打开的标签页；Host 进程退出后该 Chrome 的 `/json/version` 仍有响应，证明销毁是断开而非关闭。
- 实机 `--profile web` 运行：启用区块显示 `@deepseek-ai/dsh-browser-playwright` 已加载并可停用；偏好表单渲染出可编辑控件（含默认缩放）；保存 1.5 后配置档补丁写入 `zoom: 1.5` 且字段回读为 1.5；运行时区块显示折叠的“详情与维护”。
