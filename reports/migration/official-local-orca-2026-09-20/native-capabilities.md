# 三方原生能力审计（源码与装配证据）

审计范围：Browser / browser-use / CUA / computer-use / mobile emulator / SSH / Terminal / Security research / Work Items / Design / voice。仅静态读取当前源码和配置；未运行 GUI、设备、网络、构建、测试或 git。最终提交标识和 main 同步见主报告。本报告不以旧 reports 或旧产物目录证明当前发布可用性。

路径缩写：L = D:/Company/cinlan/cinlan-harness-upstream-016；O = D:/Company/cinlan/deepseek-harness-reference-016（指定 dsh-v0.1.6-alpha.2）；R = D:/Company/cinlan/orca（当前有未提交修改，只能描述工作树源码，不能称已发布）。下列文件:行均相对该缩写根。native 表示直接在 Harness/Orca 内实现或调用受其管理的 SDK，不表示没有 Chromium、模型、OpenSSH、系统权限等运行依赖。

## 结论

本地不是“全面依赖 Orca”，也不是“迁入官方 CUA 后全面 native”。持久 Browser、Work Items、voice、Terminal、Security Research 服务和 SSH 两条实现路径均有本地实现。现有 cinlan-computer-use / cinlan-mobile-device bundle 仍选择外部 Orca CLI bridge。官方 browser-use 与 CUA 已有独立源码及本地公开包 allowlist，但没有因此自动接入本地专用设置页或默认桌面 profile。

默认 Desktop profile 只有 base + web-app（L/apps/desktop/src/project-manager.ts:114、939、965）。“CLI package 声明 bundle 依赖”“可以发布 npm 包”“设置菜单可见”“默认 profile 已挂载”“当前机器可运行”必须分别判断。cinlan-browser/computer/mobile/work-items 是选装层，其条目本身没有 disabled:true；默认 profile 没有引用它们，不应把这个事实改写成“默认已启用”。

## 能力矩阵

| 能力 | 官方 O | 本地 L 的真实实现与默认装配 | Orca R 当前源码 | Orca 依赖 / 限制 |
|---|---|---|---|---|
| Browser（持久 UI/自动化） | web-app 有 ui-sidebar-browser，不能据此认为具有本地持久 Browser facade；官方源码组是 browser-use，未见 L 的 packages/browser 对应组。 | browser Service + browser-playwright Provider + tool-browser + browser-controller；cinlan-browser bundle 指定 provider:local。另保留 browser-cinlan 外部 CLI Provider。默认 Desktop 仅 base/web-app，持久 Browser bundle 选装。 | BrowserManager / Electron webContents，离屏 BrowserWindow backend 与持久 partition；BrowserPane 设置。 | 选 local 无需 Orca；显式选 browser-cinlan 才需 orca/orca-ide。Playwright 默认已安装 Chrome channel、headed；没有证据表明浏览器二进制随 Harness seed 必然提供。 |
| browser-use | Playwright MCP、Chrome DevTools MCP、Stagehand native 三条实验 Provider；每个 Session 管资源，attach 有独占语义。 | 对应源码已迁入；公开实验 allowlist 包含三者和 runtime。不是 browser-playwright facade，也没有加入普通 bundle yml。 | BrowserUsePane 管 CLI/skill 安装与浏览器 profile，启用值来自 localStorage == '1'。 | 官方迁入三条无需 Orca。MCP 两条仍启动 npm server 子进程；Stagehand 需独立 model/apiKey 与 Chrome/CDP。Orca 的 browser-use 名称不是这三个 DSH Provider。 |
| CUA native | @trycua/cua-driver 0.28.0 SDK、进程内 CuaDriver、独占 register、自发布 cua_driver_native__* 工具。 | 已迁入同类 Provider；与旧 computerUse facade Provider 互斥。默认 profile/bundle 未装配。 | 审到的 Computer Use runtime 是自有 macOS helper、Windows PowerShell/Linux Python script provider，不能等同于 @trycua SDK。 | native CUA 无需 Orca CLI，但 SDK 平台二进制与系统权限仍需具备；本轮未验证 SDK 每平台实际运行。 |
| CUA MCP | 默认 command:cua-driver，args:[mcp]；MCP discovery/执行/重连。 | 已迁入、allowlist 可公开打包，默认未装配。 | 未以同名找到等价 Provider；不可用 Orca ComputerUsePane 代证。 | 依赖外部 cua-driver，不是 Orca；“MCP”不等于 native SDK。 |
| computer-use（现有 Cinlan facade） | 官方 computerUse 是供独占工具 Provider 的注册点；官方 CUA 自己出工具。 | computer-use Service + computer-use-cinlan.registerProvider + tool-computer-use；cinlan-computer-use bundle 指定 cinlan，默认命令 Linux orca-ide，其他 orca。 | ComputerProviderLifecycle 选 macOS native helper 或 DesktopScriptProvider；ComputerUsePane 处理权限/skill。 | 仍依赖 Orca CLI/runtime；不是原生迁入完成。Bridge 与 CUA 同时注册会显式拒绝，不是自动 fallback。 |
| mobile emulator | 官方源码组/默认 bundle 未发现专用 mobile-device 能力。 | mobile-device Service + mobile-device-cinlan + tool-mobile-device；bundle 指定 cinlan。Web 有设置/SDK 检查入口。 | Android adb + emulator + scrcpy；iOS simctl + serve-sim；独立后端和 MobileEmulatorSettingsPane。 | 仍依赖 Orca CLI；本地 SDK 探测不是 native device transport。iOS 限 macOS，Android 需 SDK，不能因本地可改 androidSdkPath 就认定 bridge 可脱离 Orca。 |
| SSH | 原生 OpenSSH SshConnection + fs/subprocess/sandbox adapters；需预装且 hash 匹配的远端 Node/helper；客户端仅 Linux/macOS。 | 保留官方 POSIX 路径；另有 execution-host-targets，调用系统 ssh，固定远端 dsh --profile execution-host。Web Hosts 设置和目标管理默认挂载。 | ssh2 连接 + system SSH fallback，SshPane 管 hosts。 | 两条 L 路径均不依赖 Orca，不能把 POSIX 限制扩散到所有本地 Hosts 功能；也不能把 Hosts 目录/worker 操作等同于整个 Agent 远端执行。 |
| Terminal | terminal Service + BashTerminalBackend -> subprocess.spawnTerminal；sdk-minimal 平台条件选择 bash/pwsh；Web terminal controller/UI。 | 同类 model terminal 后端保留；Web 当前用 sidebarTerminals + SidebarTerminalProvider + PtyManager/AgentPtyRegistry，controller 不拥有 PTY。Terminal 设置默认挂载。 | daemon pty-subprocess 使用 node-pty；CLI terminal 与应用终端通道。 | L 原生，不需 Orca。node-pty/native dependency、shell/平台可用性仍需检查；model terminal 与 UI terminal 不是同一配置层。 |
| Security research | 官方指定树未见本地 security 服务组和专用 bundle。 | assessment-scope settings/session/policy、finding-session、artifact-local、NVD provider、tools、skills/prompt 的本地 bundle；选装。Web 状态/范围/报告 UI 默认有入口。 | SecurityResearchPane 是 reverse skill 的发现、安装、更新与 CLI prerequisite 面板。 | L 服务无需 Orca；默认 targets/actions/egress/credentials 为空，默认不能做评估动作。L 不是仅 skill 入口，R 面板也不能证明同等 finding/授权服务。 |
| Work Items | 官方指定树未见本地 work-items 服务组/bundle。 | WorkItems registry + GitHub REST/GitLab REST/Linear GraphQL Provider + tool/controller/UI。cinlan-work-items 选装，三 Provider allowWrites:false，未配置 scope 时不可用。 | GitHub client.listWorkItems 有真实 issue/PR 来源解析；其他集成目录也存在，但本轮未逐个复核所有 Orca backend 写入路径。 | L 直接 fetch HTTP，不走 Orca 或 gh/glab。token、repo/project/team scope、allowWrites 与授权仍必需。不能以“原生”表示无需网络。 |
| Design | 未发现专用 Design Service Provider。 | packages 中未发现 design Provider；能力设置 roster 只有 security/browser/computer/mobile；测试明确不应注册 cinlan-design。 | 当前 renderer 未匹配 DesignPane/cinlan-design/DESIGN.md，skills/resources 未定位 design SKILL；不能沿用旧审计称其当前已有完整 Design 产品能力。 | 三方本轮均无证据可认定完整 Design runtime。可有外部 skill/会话 skill，不等于已集成 service、UI、export pipeline。 |
| voice | 官方指定树未见 voice 组，web-app 未挂 voice。 | voice Service + Sherpa VoiceEngine + models/operations + voice-controller + ui-voice-dictation，web-app 默认挂载。 | STTService 通过 Worker 加载 Sherpa，需 model ready；VoicePane/模型设置。 | L 原生，不需 Orca；需 Sherpa native binding + 已下载 ONNX 模型 + 麦克风权限。本轮未录音、下载或验证 native addon 实际加载。 |

## 关键证据

### Browser、browser-use 与 CUA 不能按名字合并

- L/packages/bundle/cinlan-browser/cordis.patch.yml:5-13 是 browser + provider:local + browser-playwright；:17-25 是权限 policy（observe/navigate/interact 全 ask）和 tool-browser；:28-32 是 controller/元素捕获 UI。
- L/packages/browser/browser-playwright/src/index.ts:56 直接 import chromium from playwright-core；:84-93 配置默认 local、DSH_HOME profile、chrome、headless:false；:545 用 chromium.launchPersistentContext；:1219 注册 browser Provider。L/packages/browser/browser-cinlan/src/index.ts:65 注入 browser/subprocess，:78 默认 orca-ide/orca，:91-97 是可配置命令/worktree。
- L/packages/client/ui-better-sidebar/src/client/browser.ts:4-6 是 iframe 预览，:40-45 处理 iframe 拒绝；这也不能当成 Playwright 自动化或 Orca Electron Browser。
- O/packages/bundle/web-app/cordis.patch.yml:237-241 是 ui-sidebar-browser/ui-sidebar-terminal。O/packages/experimental/browser-use-playwright-mcp/src/index.ts:28-46 解析 @playwright/mcp/cli.js 并由 process.execPath 启动，launch 加 --isolated、attach 指定 CDP；O/packages/experimental/browser-use-chrome-devtools-mcp/src/index.ts:27-39 同样解析 npm server，禁用 usage statistics。
- L/packages/experimental/browser-use-stagehand-native/src/index.ts:25 注入 browserUse（不是 browser）；:28-60 要独立 model/apiKey 和 launch/attach 配置；:99 独占注册 stagehand-native。该类实现不是持久 Browser facade 的 Provider。
- O/packages/experimental/computer-use-cua-driver-native/package.json:24-38 定义发布 lib 文件及 @trycua/cua-driver:0.28.0 依赖。L/packages/experimental/computer-use-cua-driver-native/src/index.ts:60 独占 register；:88-97 import SDK、create、listToolsJson、自行命名 cua_driver_native__* 工具。O/packages/experimental/computer-use-cua-driver-mcp/src/index.ts:32-34 默认 cua-driver mcp，:53-67 由 MCP client 挂载。
- L/packages/computer-use/computer-use/src/index.ts:170-176 拒绝已有 facade Provider 的独占 register；:189-194 拒绝已被 CUA 独占后的 registerProvider；:210-229 facade 方法仅从 providers Map 选实现。故 CUA 注册成功也不会给旧 capabilities()/observe()/click() facade 填入一个 Provider。
- L/packages/client/ui-settings-security/src/client/CapabilitySection.tsx:52-64 只列四个能力并只匹配旧 browser/computer/mobile 包名；不匹配 experimental-browser-use-* 或 experimental-computer-use-cua-*。L/packages/api/device-capabilities-controller/src/index.ts:46-55 调用 computerUse.capabilities()；因此“CUA 工具正常”与“旧设置页显示 ready”可能分离，这是源码可推导的集成缺口，尚未做运行验证。

### Bridge、默认装配与平台资源

- L/packages/bundle/cinlan-computer-use/cordis.patch.yml:5-13、L/packages/bundle/cinlan-mobile-device/cordis.patch.yml:5-13 均选 cinlan；两 bundle 的 :17-21 默认为 ask。L/packages/computer-use/computer-use-cinlan/src/index.ts:64、74、87-89 和 L/packages/mobile-device/mobile-device-cinlan/src/index.ts:45、57、70-72 明确注入 subprocess 并默认调用 Orca 命令。
- L/packages/client/ui-settings-security/src/client/index.ts:50-53 绑定 browser-playwright、assessment-scope、mobile-device 设置，:73-85 分别调用 readiness、SDK check 和 mobile list API。L/packages/api/device-capabilities-controller/src/index.ts:57-61 的设备列表仍来自 mobileDevice Provider，:76-78 的 SDK probe 是独立路径。
- L/packages/bundle/web-app/cordis.patch.yml:118-123 默认装配设备/安全状态 controller；:426-427 默认装配 capability settings。设置页本身并不安装或挂载相应 Provider。
- L/apps/cli/package.json:105-108 声明四个 cinlan bundle 依赖；L/apps/desktop/src/project-manager.ts:114 仅声明默认 base/web-app，:373 在其后附加用户 plugins；依赖存在不能代证 default activation。
- L/scripts/experimental-package-policy.ts:2-9 明确将迁入 browser-use 与 CUA 包列入 public experimental allowlist。对 L/packages 所有 *.yml 的实际搜索未发现这些实验 Provider 装配行；它们是可选源码/包，不是默认 enabled:false 行。
- L/apps/desktop/electron-builder.config.mjs:57-67 打包 shell 与 runtime/seed；L/apps/desktop/scripts/prepare-seed.ts:128-135 校验离线 seed 安装/host runtime 文件。这里没有 Orca helper、Windows runtime.ps1、Linux runtime.py、serve-sim 的额外资源配置。未检查当前 seed 中每个插件的实际二进制，也未从既有 .desktop-build 推断本次发布内容。
- R/src/main/computer/computer-provider-lifecycle.ts:30-48 选择 macOS native 或 script Provider。R/config/electron-builder.config.cjs:313-334 包含 cinlan/orca Windows shims、agent-browser.exe、computer-use-windows/runtime.ps1；:407-412 是 serve-sim 与 macOS helper；:469-474 是 Linux agent-browser 与 runtime.py。
- R/src/main/browser/offscreen-browser-backend.ts:2、25-46 是 Electron BrowserWindow 与持久 partition，:9-14 说明 Linux 离屏依赖虚拟 display。R/src/renderer/src/components/settings/BrowserUsePane.tsx:59-64 使用 ORCA_CLI_SKILL 安装/更新，:75-81 的开关初值必须 localStorage 为 1。
- R/src/main/emulator/backends/android-emulator-backend.ts:65-76 明确 adb/emulator/scrcpy 和 install/launch/permissions/tree/logcat；R/src/main/emulator/emulator-availability.ts:81-97 区分 iOS/macOS 与 Android。R/src/renderer/src/components/settings/MobileEmulatorSettingsPane.tsx:127 默认 enabled !== false，:195-203 修改开关，:298-307 提供 agent control 行。这不能证明 L bridge 暴露了 R 的全部生命周期/streaming 功能。

### SSH、Terminal、Security、Work Items、voice 与 Design

- O 与 L 的 packages/ssh/ssh/src/index.ts:17-25 要 host/node/helper/helperHash；:73-75 限制 POSIX client。L/packages/execution-host/execution-host-targets/src/connection.ts:37-44 使用 ssh -T、BatchMode、StrictHostKeyChecking 并固定远端 dsh --profile execution-host；:74-86 解析并启动系统 OpenSSH。L/packages/bundle/web-app/cordis.patch.yml:150-160 默认装配 execution host/target/controller 与 sidebar terminal；:440-446 挂 Hosts/Terminal 设置。R/src/main/ssh/ssh-connection.ts:4-20 引入 ssh2 与系统 SSH fallback。
- O/packages/bundle/sdk-minimal/cordis.patch.yml:47-64 默认 subprocess-local + terminal，bash 在 Windows disabled、pwsh 在非 Windows disabled。L/packages/terminal/terminal-bash/src/index.ts:174-207 真正由 subprocess.spawnTerminal 执行。L/packages/client/ui-better-sidebar/src/terminal-provider.ts:4-8、36-37 是 SidebarTerminals 的 Provider 和 node-pty/PtyManager；:59、77 在 native dependency 缺失时明确 unavailable。L/packages/api/sidebar-terminal-controller/src/index.ts:18-25 只转接服务。R/src/main/daemon/pty-subprocess.ts:2、558 是 node-pty import/spawn。
- L/packages/bundle/security-research/cordis.patch.yml:12-39 挂 artifact、scope/settings/session/policy，并将 executionHostIds/targets/actions/egress/credentials 设空；:44-62 挂 findings、NVD、skills/prompt 和 tools。L/packages/client/ui-settings-security/src/client/index.ts:88-99 获取状态并 exportReport，:148-167 持久化范围。R/src/renderer/src/components/settings/SecurityResearchPane.tsx:3-10、31-44、65-99 仅路由 reverse skill 安装/更新与 CLI prerequisite，不应直接声称具备 L 的评估/发现持久化服务。
- L/packages/bundle/cinlan-work-items/cordis.patch.yml:3-22 是 registry + 三 Providers + tool/controller/UI，allowWrites 全 false。L/packages/work-items/work-items-github/src/index.ts:307-324 直接 fetch GitHub bearer API；work-items-gitlab/src/index.ts:324-340 fetch GitLab PRIVATE-TOKEN API；work-items-linear/src/index.ts:298-309 fetch GraphQL。三者 Provider 注册行分别 :433、:466、:462。R/src/main/github/client.ts:1405-1433 是 listWorkItems 并区分 issue/PR 来源；R 的其他 Work Items Provider 本轮未逐个验证，不外推等价。
- L/packages/bundle/web-app/cordis.patch.yml:225-232 默认挂 voice/voice-controller/voice-sherpa-onnx，:339-340 挂 dictation UI。L/packages/voice/voice-sherpa-onnx/src/index.ts:107-112 注册引擎/模型/operations；engine.ts:75-89 动态取 Sherpa 并在缺依赖时 VOICE_ENGINE_DEGRADED；:91-134 实例化识别器。R/src/main/speech/stt-service.ts:162-172 先检查 model ready 再启 Worker，R/config/electron-builder.config.cjs:88-97、183-212 处理各平台 Sherpa 资源。模型和麦克风可用性本轮未验证。
- Design 否定结论限于已搜索范围：L/packages 的 **/*design*/src/index.ts 无匹配；L 设置真实 roster 在 CapabilitySection.tsx:52-57，不含 Design；L/packages/client/ui-settings-security/tests/apply.client.spec.ts:92-93 明确断言无 cinlan-design section/items。R/src/renderer/src 对 cinlan-design/DesignPane/DESIGN.md 无匹配，R/skills 与 R/resources 的 design SKILL 路径未发现。外部已安装 skill 不在这项仓库能力结论内。

## 优先建议

1. P0：先修能力身份/状态集成，再决定默认开启。Browser 设置明确显示持久 Playwright、旧 Orca bridge、browser-use MCP/Stagehand；Computer Use 明确显示 CUA native / CUA MCP / Orca bridge。对 CUA 查询独占 providerName 与自有工具 readiness，不能继续用只适配 facade 的 capabilities() 作唯一健康判定；互斥注册错误应在配置选择时解释。
2. P0：以冷安装 profile 清单验收“原生可用”。当前 base/web-app 未挂 browser-use/CUA/四个 cinlan 选装 bundle。公开 allowlist 和 CLI dependency 仅证明打包资格/依赖，不是启用证据。主报告分别记录默认、选装、disabled 条件，不给“一键全能力”的结论。
3. P1：若目标是彻底去 Orca，优先替换 mobile-device-cinlan；它没有已证实的 Harness-native transport。Computer Use 可选择迁入 CUA native 的工具路径，但须先处理设置页/权限/观察结果协议与旧 facade 的不等价。Browser local 路径已可独立保留，旧 bridge 改为明确可选。
4. P1：为每个发布平台列运行前置条件：Chromium/Chrome、@trycua native binary、cua-driver MCP CLI、OpenSSH 与远端 dsh/helper、node-pty、Sherpa addon/模型、Android SDK、macOS iOS/权限。当前报告仅核源码及资源声明；后续需在授权环境完成离线 package inventory 与适当 smoke，不能从当前脏树或既有 dist 代证。
5. P1：保留本地已原生化的 Work Items / Security Research / voice，按原生服务继续完善入口，不再把它们统称 Orca bridge。安全 scope 空集和 Work Items allowWrites:false 是运行策略，不是缺实现。
6. P2：Design 先定义所需产品闭环（skill 安装、设计契约、资产、导出与验证），再评估迁入；当前证据不足以称任一方有完整同等 Design Service。Work Items 的 Orca 全集成覆盖、voice 详细设置注册与所有平台 SDK binary 清单仍需后续专项核验。

## 验证边界

本报告的正向结论来自源码/配置实际读取与限定范围搜索。官方缺少某业务域是目录/默认装配核查结论，不表示通用插件系统不能安装该能力。没有运行设备探测、CLI version、网络请求、构建/测试，也没有更改产品或 git。最终 SHA、发布范围与 Orca 工作区状态见主报告。
