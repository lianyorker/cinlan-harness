# 实机验收修复清单（0.2.2-alpha.2 unsigned 首装）

> 建立日期：2026-11-12
> 验收环境：`D:\CodeTools\Cinlan Harness`（NSIS 静默安装，`package:desktop:win:x64:unsigned` run 728 产物）
> 原则：先修复可用性阻断项（会话/预设/插件），再处理品牌与样式，最后处理决策项。每项修复后回写状态。

## P0 阻断项

### 1. Agent 预设全部加载失败 → 新建会话被拒（#3/#6 合并）

**症状**：标准/PTC/创造模式标"加载失败"；新建会话报 `agent-preset/invalid: tool-subagent: toolFilter is no longer supported`。

**根因**：合并漂移。`packages/bundle/web-app/presets/{standard,ptc,cordis}.patch.yml` 的 delegation 段保留了旧 config（`toolFilter.deny`、`backgroundMode`、`modelSelectionSettings`）。上游在 subagent-preset-composition 迁移中已删（见 `docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/`），`tool-subagent` `apply()` 现在对 `persona`/`toolFilter` 硬抛错。上游还删掉了 `tool-subagent-codex`/`tool-subagent-claude-code` 两个 disabled 行。

**修法**：三文件 delegation 段对齐 upstream/master；保留 Cinlan 刻意的 `order` 偏移（minimal 4、cordis 5，来自 P0 冻结提交 `878c38710d`）。`schedule_*` 不再隐藏是上游接受的行为。

**已修（2026-11-12）**：
- `presets/{standard,ptc,cordis}.patch.yml`：删 `toolFilter`/`backgroundMode`/`modelSelectionSettings` + codex/claude-code disabled 行，与 upstream 一致
- `experimental/agent-team-profile/cordis.patch.yml` + `bundle/security-research/presets/.../agent.cordis.yml` + `apps/web/tests/agent-team-{worktree,panel}.overlay.yml`：同步删 `backgroundMode` 死字段（schema 已不含，静默忽略）
- `agent-team-profile/tests/profile.spec.ts`：断言改为 provider/toolName
- 测试：`agent-team-profile` profile.spec 1/1 通过
- 快照 `snapshots/sdk/*/cordis.yml` 里残留的 `backgroundMode`/`enableRunInBackground` 是 fixture，不动

**状态**：✅ 已修（待重装实机复测）

### 2. 已安装插件全部"异常 + 未安装"（#4）

**症状**：`@cinlan/cinlan-browser`、`cinlan-computer-use`、`security-research`、`web-capability-defaults` 标"异常"+"未安装"。

**根因**：两层叠加。
1. **旧 profile 残留旧包名**：`~/.clh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 写的是改名前的 `@cinlan/cinlan-browser`、`@cinlan/cinlan-computer-use`、`@cinlan/security-research`、`@cinlan/web-capability-defaults`；包实际名是 `@deepseek-ai/dsh-cinlan-browser` 等（`6d5f15943e` 已修 `bundles.ts` 模板，但旧 profile 没有迁移机制）。这些名字解析不到任何包 → skippedBundles → UI "异常+未安装"。
2. **`dsh-web-capability-defaults` 不在 runtime 闭包**：`apps/cli/package.json` 依赖了另外三个 bundle 却漏了它，package-set 闭包收不进去 → 即使名字对了也解析不到。

**已修（2026-11-12）**：
- `official-bundles/bundles.ts`：新增 `RENAMED_BUNDLES` 映射（4 个旧名 → 新名）
- `app-boot/profile.ts`：`loadProfileDirectory` 里 `readProfileManifest` 后先跑 `renameLegacyBundles`（有旧名才回写 manifest），再进 `dropRetiredBundles`
- `apps/cli/package.json`：补 `@deepseek-ai/dsh-web-capability-defaults` 依赖；`pnpm install --lockfile-only` 已同步
- 测试：app-boot `profile.spec`+`profile-sanitize.spec` 41/41 通过

**状态**：✅ 已修（待重装实机复测）

### 3. SSH 主机 `executionHostController` unavailable

**症状**：SSH 远程主机页报 `executionHosts/follow: active Service "executionHostController" is unavailable`。

**根因**：兼容性门禁版本列车漂移。`app-boot` 的 `evaluatePluginCompatibility` 对每个 `@deepseek-ai/dsh-*` peer 拿 **runtime 版本**（`0.2.2-alpha.2`）比 peer range；`workspace:^` 在 `pnpm pack` 后变成 `^<该包自身版本>`。Cinlan 的 78 个 `dsh-*` 包停留在 `0.1.7-rc.2`/`0.2.0-rc.1`/`0.2.1-alpha.1` → pack 后 peer range `^0.1.7-rc.2` 不被 `0.2.2-alpha.2` 满足 → **行被静默 disabled**（只 stderr 一行，UI 无声）。`execution-host-targets`/`execution-host-local`/`execution-binding` 链全拦 → `executionHostTargets` 不挂 → `executionHostController` inject 缺依赖 → unavailable。workspace 内 `workspace:^` 被视为"当前 runtime"永远过，所以只有打包实机炸。浏览器/移动设备/安全族同理受创（browser、cinlan-browser 等行同被拦——与 #2 的"异常"叠加）。

**已修（2026-11-12）**：77 个 `dsh-*` 包版本统一升到 `0.2.2-alpha.2`（dsh 家族本来就不变式要求全家族同版本，`releaseChecks` 被本地打包跳过低才漏检）；`pnpm install --lockfile-only` 已同步；复查 workspace 无字面 pin 旧版本的 dep 范围。`@cinlan/*` 包走 CinlanFamily 独立版本线，保留原样。

**状态**：✅ 已修（待重装实机复测）

## P1 功能项

### 4. 权限选择下拉无效（#2）

**症状**：仅可查看/工作区内修改/完全权限 点击无反应。

**根因推断（代码走读，2026-11-12）**：写/读分离，写路径单独挂即可复现"菜单能开、点击静默回退"：
- 读：`PermissionCatalogDirectory` → `remote.permissionPresets.catalog()`（`ui-permission-presets/catalog.ts`）；catalog 能渲染说明 `PermissionPresetService` 已挂载
- 写：`PermissionSelect.submit` → `sessions.binding(sessionId).session.command('/permission <preset>')`（`ui-permission-presets/index.ts:133-142`）
- `/permission` 命令由 `PermissionPresetService` 经 `ctx.inject(['commands'])` 注册（`interaction/permission-presets/index.ts:254`）——**commands 注册表缺席时命令不存在**
- `submit()` 三种失败（binding 缺失 / `result.error` / `!matched`）全部被 `.catch(() => false)` 吞掉（上游设计），UI 静默回退
- `locked = removed || inert || !live || blocked || parentOffline`（`InputBar.tsx:154`）也会让整个触发器 disabled——session 不 live 时点击无反应
- 旧装机上 `dsh-commands`/`dsh-approval`/`dsh-agents` 随 #9 版本列车被拦 → 命令注册表缺席或命令未挂载 → 症状成立
- PermissionSelect.tsx 为上游原样（末次改动 10-09，非合并漂移），`.catch(() => false)` 不改，避免下游 workaround 漂移

**复测要点**：实机复测时若仍无效，看 devtools console/网络里 `/permission` 提交是否 `matched:false` 或 `result.error`（静默设计不报 UI）。

**状态**：✅ 推断已修（#1/#9 连带，待实机复测确认）

## P2 品牌与样式

### 5. 悬浮名称仍 DeepSeek Harness（#1）

**症状**：侧边栏 logo 悬浮 tooltip 显示 "DeepSeek Harness"；侧边标题 "DSH 本地构建"。

**根因定位**：托盘悬浮文字来源是 `apps/desktop/src/locale.ts` 的 `aboutProduct`（`tray.ts` 里 `tray.setToolTip(messages.aboutProduct)`），不是侧边栏 locale。侧边标题是 `ui-sidebar` 的 `brand.localBuild`。

**已修（2026-11-12）**：
- `apps/desktop/src/locale.ts`：8 语言 `aboutProduct`/`aboutMenu`/`welcomeTitle`/`startupFailed` 等 `DeepSeek Harness→Cinlan Harness`、`DSH→CLH`；小写 `dsh` 命令引用保留（P7 决策项）
- `apps/desktop/src/main.ts`：About 面板 `applicationName` 改 Cinlan Harness；顺带修两个隐藏 bug——`cliCommandMenu` spread 重复两行导致菜单出现两个"管理命令"入口（合并残留），dev 模式 About 图标 `icon.png→icon-windows.png`（对齐 spec 期望，darwin 原生 About 不渲染该图标）
- `ui-sidebar/locales.ts`：8 语言 `brand.localBuild` 全部 `DSH→CLH`（zh 曾被并行编辑覆盖回 DSH，已纠正）
- 测试断言与快照全量同步：tray/quit-confirmation/background-notice spec + `expected/` 下 about-panel/application-menu/fatal-*/welcome 共 15 个文件；`Roaming\DeepSeek Harness` 路径类字符串保留（productName 派生，属 P8）
- **测试基建修复**（main-startup.spec 此前 150/151 全红）：
  1. `vi.stubGlobal('process', {...process})` 展开拷贝丢 EventEmitter 方法，pino transport `onReady` 调 `process.removeListener` 崩 → 每个用例 5s 超时。改为 `Object.create(process)` + `defineProperty` 链式 stub（保原型方法、保 beforeEach 覆盖继承，`platform` 是只读 getter 不能 `[[Set]]`）
  2. 去 pino 崩溃后暴露 logger 写 `desktop-test-logs/harness.log` 的 teardown ENOENT（rmSync userData 后异步 flush），加 `vi.mock('../src/harness/logging/logger.ts')` no-op
- 验证：`tray`/`quit-confirmation`/`background-notice` 20/20，`welcome-renderer`/`fatal-recovery` 全过，`main-startup` **151/151 通过、0 unhandled errors**
- `packaging/README{,.zh}.md`：`DSH Local Build`/`DSH 本地构建` 标签描述同步改 CLH

**残留（不属于本项）**：`cli/dsh*.cmd`、`installer/locales`、electron-builder 协议名、模型系统提示词 "powered by DeepSeek Harness"（`harness-dev-context`/`runtime-loader` spec）——分属 P7/P8/模型身份决策。`cliCommandInstallApp`/`cliCommandNewTerminal` 等明细文案 en/zh 仍提 `dsh`（命令名事实如此），与 `cliCommandMenu` 的 clh 并存，待 P7 统一。

**状态**：✅ 已修（待重装实机复测）

### 6. 工作树任务输入框无样式（#5）

**症状**：工作树任务设置页输入框是裸 input，无边框/背景。

**根因推断（代码+装机包走读，2026-11-12）**：
- 输入框：`WorktreeTaskSection.tsx:311` 原生 `<input>`（建单 5 字段）+ `WorktreeDefaultsForm.tsx` 用 `Input` primitive——都被 `WorktreeTaskSection.module.css` 的 `.formRow input, .formRow select` 规则覆盖（border/background/color 齐全，规则 09-14 就在）
- 规则随包发出：新装机 `app.asar` 字节级搜到完整 `.formRow input{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);...}`，tagId 仅一份无重复注入
- **裸 input 机制**：`border: .5px solid var(--未定义)` 属 IACVT → 整条声明无效 → `border-style` 回落 `none`、background 回落透明、文字仍可见 = 正是"无边框/背景裸 input"。充分条件是 `--dsw-alias-*` 变量缺席
- 变量来源：`ui-theme` 的 `design-platform.css`（body{} 作用域，07-19 起就有这些定义），由 `dsh-client-ui-theme` client 插件 `installThemeStyles` 注入 `document.head`
- 旧装机上 `ui-theme` client inject = `['slots','locale','remote','configForms']`——全在 #9 被门禁的 dsh-client-* 家族 → 插件不激活 → 全部 `--dsw-alias-*` 缺席 → 所有用变量的控件都裸（输入框最显眼）；与"插件全部显示异常"同根
- 源码无缺陷；源码与新包均验证正确

**复测要点**：若仍裸，devtools 看 `document.head` 里是否有 `style[data-plugin-css*="dsh-client-ui-theme/design-platform.css"]`，及 `<input>` computed 的 `border-style`/`background-color`。

**状态**：✅ 推断已修（#9 门禁连带，待实机复测确认）

### 7. 打包命名仍 dsh（#8）

**症状**：侧边栏 "DSH 本地构建"、安装目录/快捷方式名为 Cinlan Harness（已对），但内部称号/版本串 `0.2.2-alpha.2+desktop-build.dirty` 仍带 DSH。

**待查**：desktop app 的 display name / build label 来源（`apps/desktop` 配置 + locale.ts）。与 #5 一起做品牌收口。

**状态**：⬜ 未修

## 决策项

### 8. dsh.cmd 与 clh.cmd 是否并存（#7）

**决策（2026-11-12，LY 拍板）**：A——只保留 `clh.cmd`，不要 `dsh.cmd`，避免与官方产品的 `dsh` 命令冲突。

**执行内容**：
- 删除 `apps/desktop/cli/dsh`、`cli/dsh.cmd`（死文件：`prepare-cli.ts` 本来就只拷 `clh`，且 exe 名还指着 DeepSeek Harness）
- `command-management.ts` POSIX 探针 `command -v dsh` → `command -v clh`（改名遗留 bug：装的是 clh 却探 dsh），stdout 标记 `DSH_COMMAND` → `CLH_COMMAND`
- `command-path.ps1` 内部函数 `Invoke-DshCommandPath`/`Send-DshCommandEnvironmentChange`/`DshCommandEnvironment` → `Clh` 系列
- `locale.ts` 8 语种 `cliCommand*` 残留命令名全部 `dsh`→`clh`（ja/es/fr/de/ru/pt 的 Menu/Title/Selected 也曾漏改），`startupAddressInUse` 的 "dsh web" → "clh web"
- fixture：win32 `command-path.ps1` 的机器 PATH 用例 `dsh.exe`→`clh.exe`；`command-manager-flow.spec.ts` 假 shell 标记同步 `CLH_COMMAND`；`command-management.spec.ts` 遮蔽路径/目的地改 `clh` + `Cinlan Harness` 目录；`cli-launcher`/`command-installation` fixture 命令名统一
- README{.md,.zh.md}：Manage clh Command、`/usr/local/bin/clh`、`clh --version`、`cli/bin/clh`(`clh.cmd`)、CLI clh
- 4 个 command-management 快照已随测试重新生成；`command-management`/`command-manager-flow`/`cli-launcher`/`command-installation` 全绿
- 保留不动：`dsh://`/`dsh-app://` 协议、`DSH_*` 环境变量、`app.asar/dsh` 目录、`@deepseek-ai/dsh*` 包名、`dshOnboarding` 等内部标识

**状态**：✅ 已修（随本次打包生效；桌面应用侧 macOS destination `/usr/local/bin/clh` 原本就对）

## docs/dev 关联功能（验收顺带覆盖）

来自 `官方功能差距对比.md` 未完成项，验收时顺带确认实机表现：

- Phase 9 共享包、Phase 8 TUI：未开始，不在本次验收范围
- 通用设置行（工作区目录/CLI 注册/更新检查等）：设置页逐项过
- 终端迁移项（GPU 渲染/OSC52/粘贴选项等）：终端面板实机过
- 语音：转写空结果已知问题复测
- 手机模拟器/计算机控制/浏览器：对应设置页 + 插件装得上与否
- 任务来源：Gitee Provider 待实施
- Git：Commit Message AI / 自动重命名分支 / API 预算显示 待实施

## 验证流程

每项修复后：
1. `pnpm run typecheck`（改动涉及的包）
2. 相关包的单元测试
3. 全部修完后重跑 `package:desktop:win:x64:unsigned` 验证封包冒烟 + 实机安装复测
