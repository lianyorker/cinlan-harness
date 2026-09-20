# Orca 32 个固定 Settings 导航项与本地入口对照

本地 L=D:/Company/cinlan/cinlan-harness-upstream-016，已读取 HEAD 1c88551e2d0c27bbc8a208b91ee82e064c27d3ea；该工作树当前分支为 sync/upstream-dsh-v0.1.6-alpha.2，main 已快进到同一 SHA。Orca O=D:/Company/cinlan/orca，沿用本轮只读工作树基线 HEAD 9c192525aaca8ab82ac751999b863ece07138676、初始 dirty 330；不宣称其工作树改动已发布。

表内 N:行 指 O:src/renderer/src/hooks/useSettingsNavigationMetadata.ts 的精确固定 id；该文件总共32个固定 id，显示条件随 desktop/Web/macOS/dev 改变，并非每个平台同时显示32项。M 表示默认 web-app 配置挂载对应插件，S 表示源码/注册存在但默认挂载未确认，U 表示未核验或未发现对等入口。全部仅静态源码核对，未启动服务、测试或构建；UI存在不等于完整后端等价。B 指 L:packages/bundle/web-app/cordis.patch.yml，其行号给出默认挂载证据。E 编号见文末精确证据索引。已覆盖的宏观差异仅简写，不重复 orca-product.md 的26条事实。

| Orca 固定 id / 导航行 | 当前 L 对应入口及挂载 | UI 与后端等价判定 |
|---|---|---|
| agents / N:156 | Agent Presets，E01:197；M，B:419 | 有可管理 preset 的真实页；外部 Claude/Codex/Grok 的CLI安装/管理与preset不同，不能视为全等价。 |
| accounts / N:170 | Models/provider credentials，E02:131；M，B:324 | 有模型凭据页；未见对等外部CLI多账号池入口。后端区别见产品稿账号域。 |
| orchestration / N:185 | Orchestration，E03:31；M，B:459 | 页已存在，可改并行度/看plugin覆盖；不等于Run/Dispatch运行控制台。 |
| security-research / N:196 | cinlan-security，E04:47、E05:53；M，B:426 | 有capability页、assessment scope与报告回调；完整研究工具执行验收未核验，不能只凭页名宣称等价。 |
| computer-use / N:212 | cinlan-computer，E05:55；M，B:426 | 有设备能力观测入口；原生操作/录屏/平台权限等后端完整等价本表未核验，由专项审查补充。 |
| voice / N:223 | Voice，E06:84/103；M，B:225/339 | 有engine/model管理与dictation真实Remote，非占位；麦克风、模型下载及转写运行未测。 |
| orca-account / N:238 | U：未核验到对等云账号/设备/订阅 Settings | Models/API凭据不能冒充Orca产品账号；不存在判断不延伸到未审外部部署。 |
| setup-guide / N:251 | Welcome + DeepSeek onboarding，E02:158/164；M，B:318/324 | Orca独立步骤清单页（E07:23/49）；本地有首次欢迎/模型配置引导与onboarding slots，不是同一开发工具/技能安装清单。 |
| general / N:284 | General，E08:192；M，B:318 | 槽位式真实页，功能各自拥有持久设置；Orca的应用启动/更新/任务默认等全字段等价未逐项核验。 |
| integrations / N:295 | Integrations，E09:29/40；M，B:463 | 有GitHub/GitLab/Gitee状态检查，:34调用integrationPreflight；不是所有外部服务账号/写操作完整接入。 |
| mobile / N:308 | U：未发现等价手机配对页；不要映射到cinlan-mobile | Orca是手机访问/配对产品。L的cinlan-mobile是设备/模拟器管理，后端概念不同。 |
| automations / N:321 | Automation，E10:30；M，B:140/437 | 持久同Host作业页与Remote已存在；远端计划ownership/new-per-run worktree差异见产品稿。 |
| artifacts / N:332 | U：未核验到对等Artifacts Settings | 文件/交付物能力存在不能代替artifact发布目标/预览/安装设置；本轮不推定其默认UI或全后端等价。 |
| git / N:344 | Git Source Control，E11:34/39；M，B:165/467 | 设置写入git namespace且另有sidebar-git实际操作；分支前缀等偏好不等于托管PR/CI。 |
| tasks / N:364 | Work Items，E12:25/71；S，B未找到该UI挂载 | UI调list/get/prepareWrite/confirmWrite/关联Remote；源码有真实任务面，默认可见性需profile配置，不等于PR。 |
| terminal / N:375 | Terminal，E13:74；M，B:445 | 真Settings持久写入/重置并检查capability；L的全部终端行为/渲染偏好是否与Orca一致未逐项验收。 |
| quick-commands / N:386 | U：未发现对等保存终端命令库；L ui-commands（E14:1）为slash命令目录 | Orca QuickCommands（E15:3/17/34）有global/project/host归属与编辑；本地slash命令、快捷键和shell工具不能算同一功能。 |
| browser / N:399 | cinlan-browser，E05:54；M，B:426 | E04:169 调pages/open/history/network/download/cookie等Remote，已有实际UI命令，非仅插件清单；原生浏览器与专项差异见主报告。 |
| mobile-emulator / N:414 | cinlan-mobile，E05:56；M，B:426 | 有设备/SDK相关设置与能力页；不是手机配对；安装/启动/镜像/性能后端全等价本表未核验。 |
| floating-workspace / N:430 | Floating Workspace，E16:36/80；M，B:428 | 有独立窗口runtime、持久设置、快捷键、Session选择和terminal消费能力观察；并非只有CSS布局。与Orca本机全局窗口行为等价未测。 |
| appearance / N:441 | General内Appearance/Font Size，E17:455/479；M，B:290 | 有light/dark/system与字号持久偏好。Orca页另含window/sidebar/tray/icon与终端主题导入（E18:14/28/44），不能以主题切换覆盖全部外观设置。 |
| input / N:456 | U：未发现等价primary-selection开关；近邻聊天显示偏好 E19:85 | Orca Input实际是选区中键粘贴（E20:15/24/66）；本地transcript compact/normal、聊天输入或剪贴板调用都不能证明其等价。 |
| notifications / N:469 | Notifications，E21:42/59；M，B:69/293 | 有settings namespace和本地通知owner，旧“无owner”过时；系统通知权限、聚合、sound等运行行为未测。 |
| shortcuts / N:485 | Keybindings，E22:24/28；M，B:430/432 | 真实keyboard registry供命令、capture/set/reset回调；有可编辑快捷键产品能力，但宿主系统global hotkey与浏览器绑定不能混同。 |
| stats / N:496 | Usage，E23:52；M，B:171/443 | 有Harness Session聚合统计页；外部CLI账号账期、配额与Orca应用生产力统计不等价。 |
| ssh / N:509 | Hosts，E24:38/44；M，B:150/440 | 有增改删/连接/断连/目录检查Remote；完整跨Host Session/PTY/Git路由另核，不再是仅身份字段。 |
| servers / N:522 | U：未核验到对等远端Harness服务器配对页；E24 Hosts只证明SSH目标管理 | Orca RuntimeEnvironments验证pairing code并新增（E25:456/484），语义不同于SSH alias；Web连接底层/可填URL不证明服务器注册、设备授权与handoff等价。 |
| developer-permissions / N:538 | U：未发现对应macOS隐私权限管理页 | O只在desktop+mac显示（N:535）；后端E26:13/25/38/48/59实际管摄像头/麦克风/屏幕/Accessibility/Full Disk等。L Agent permission preset/安全scope不是OS隐私授权。 |
| advanced / N:556 | U：未发现等价Electron网络兼容开关页 | O E27:23/30/35管理HTTP/1.1兼容并重启；E28:75主进程真实disable-http2。不得以模型高级参数/插件设置算等价；无需在非Electron宿主照搬。 |
| dev / N:573 | U：未发现同款演练页；不是生产缺口 | O N:570严格desktop+import.meta.env.DEV+isDev门控；E29:12/41是toast/UI状态演练。无需把开发便利工具列生产迁移P0。 |
| experimental / N:589 | L若干页归experimental分组（E13:75、E24:45、E23:53），不是同一开关集合 | O E30:11/38/57含native chat/dashboard/hibernation等实验设置并有隐藏组。L分组名相同不证明行为等价；逐开关未核验。 |
| plugins / N:602 | Plugins，E31:33；M，B:424 | 有按feature提供tab/namespace的配置页，deployment未暴露namespace时不呈现（B:422）；不能据此证明Orca市场安装/升级/rollback完整等价。 |

## 精确证据索引

所有路径相对各自O/L根；行号均为当前源码1-based。默认挂载B只保证配置声明，不证明运行环境依赖就绪或全部控件可操作。

- N：O/src/renderer/src/hooks/useSettingsNavigationMetadata.ts:156，32个固定id按上表原序；动态项目不是第33个固定id，:614按项目跨Host合并，:628生成repo-<representativeRepoId>。L的Worktree Task与项目映射见产品稿，本表不额外扩成动态行。
- B：L/packages/bundle/web-app/cordis.patch.yml:69、:140、:150、:165、:171、:225、:290、:293、:318、:324、:339、:419、:424、:426、:428、:430、:432、:434、:437、:440、:443、:445、:459、:463、:467。
- E01：L/packages/client/ui-agent-preset/src/client/index.ts:197。
- E02：L/packages/client/ui-settings-models/src/client/index.ts:131、:158、:164；模型页、欢迎与首次凭据向导各有独立注册。
- E03：L/packages/client/ui-orchestration/src/client/index.ts:31。
- E04：L/packages/client/ui-settings-security/src/client/index.ts:47、:169；注册四个capability section，实际浏览器操作绑定Remote。
- E05：L/packages/client/ui-settings-security/src/client/CapabilitySection.tsx:52；security/browser/computer/mobile四项枚举。实际section id使用cinlan-前缀，E04:189。
- E06：L/packages/client/ui-voice-dictation/src/client/apply.ts:84、:94、:103；index.ts:2转导出apply，非空实现。
- E07：O/src/renderer/src/components/settings/SettingsSetupGuidePane.tsx:23、:49。
- E08：L/packages/client/ui-settings-general/src/client/index.ts:139、:192；onboarding有实际slots，General按feature贡献。
- E09：L/packages/client/ui-integrations/src/client/index.ts:29、:34、:40。
- E10：L/packages/client/ui-settings-automation/src/client/index.ts:30。
- E11：L/packages/client/ui-git-settings/src/client/index.ts:34、:39。
- E12：L/packages/client/ui-work-items/src/client/index.ts:25、:37、:71；写入分prepare/confirm/cancel，不是纯静态卡片。
- E13：L/packages/client/ui-settings-terminal/src/client/index.ts:35、:40、:62、:74；写入校验ready/writable/host，并复查接受值。
- E14：L/packages/client/ui-commands/src/client/index.ts:1、:50；会话slash目录，非终端命令收藏库。
- E15：O/src/renderer/src/components/settings/QuickCommandsPane.tsx:3、:17、:34、:65；命令编辑记录host与connectionGeneration。
- E16：L/packages/client/ui-floating-workspace/src/client/index.ts:36、:41、:45、:71、:80；FloatingRuntime与窗口生命周期、terminal消费能力、keyboard实际接入。
- E17：L/packages/client/ui-theme/src/client/index.ts:1、:455、:479；主机settings保存theme与font size。
- E18：O/src/renderer/src/components/settings/AppearancePane.tsx:14、:28、:44。
- E19：L/packages/client/ui-chat/src/client/apply.ts:85；此项只登记transcript-view。
- E20：O/src/renderer/src/components/settings/InputPane.tsx:15、:24、:66；primarySelectionMiddleClickPaste。
- E21：L/packages/client/ui-notifications/src/client/index.ts:42、:59。
- E22：L/packages/client/ui-keybindings/src/client/index.ts:24、:28、:46；基于真实registered commands而非独立假命令表。
- E23：L/packages/client/ui-settings-usage/src/client/index.ts:52、:53。
- E24：L/packages/client/ui-settings-hosts/src/client/index.ts:38、:44、:53；回调来自remote.executionHosts。
- E25：O/src/renderer/src/components/settings/RuntimeEnvironmentsPane.tsx:456、:484；verifyAndAddFromPairingCode，非单纯保存字符串。
- E26：O/src/main/ipc/developer-permissions.ts:13、:25、:38、:48、:59；off-mac明确unsupported。
- E27：O/src/renderer/src/components/settings/AdvancedPane.tsx:23、:30、:35、:91；更改影响Electron networking并需重启。代理分项未在本表逐项核验。
- E28：O/src/main/startup/configure-process.ts:50、:75；读取持久compatibility设置后传disable-http2。
- E29：O/src/renderer/src/components/settings/DevToolsPane.tsx:12、:41。
- E30：O/src/renderer/src/components/settings/ExperimentalPane.tsx:11、:27、:38、:57。
- E31：L/packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.tsx:33。

本轮通过glob定位本地真实文件并读取，没有假设builtins.tsx存在。未发现项限于当前设置注册/默认bundle/指定功能检索；未核验项保持未知，不推导为整个产品绝无相关能力。本稿仅新增此文件，不改产品代码与既有orca-product.md。
