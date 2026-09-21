# 官方主干与原生功能迁移执行记录

## 范围与基线

按[执行方案](official-harness-native-feature-plan-2026-09-20.md)执行六阶段迁移。主目录为 `D:/Company/cinlan/cinlan-harness`，长期开发分支 main。起始提交 `2604e4ab8a35f10eddb9839ee5f4630528674926`；本次固定官方 `dsh-v0.1.6-alpha.2`、`ddefc45fbc7f8e46dd73185e68295696d1297887`。GitHub 本轮查询超时，未宣称重新确认最新远端 HEAD；采用本地已验证发布标签。

## 交付物归档

旧集成树的 3,346 个非受控文件共 4,507,017,638 字节已复制到 `D:/Company/cinlan/releases/harness-016-baseline-2604e4ab`，每个常规文件均核对源／目标 SHA-256。归档清单：[ARCHIVE-MANIFEST.json](../../../releases/harness-016-baseline-2604e4ab/ARCHIVE-MANIFEST.json)。未将可再生 node_modules、包 lib、tsbuildinfo、.dsh-build 作为用户交付物归档。

旧记录中的 `D:/Company/cinlan/cinlan-harness-upstream-016` 路径是历史位置。需要读取其 `.artifacts` 或 `apps/desktop/.desktop-build` 文件时，使用上述归档根目录拼接相同相对路径；归档内容保持原字节，内部历史路径不改写。原 main 的 `apps/desktop/coverage-floating/` 保留。

历史验收安装包（不代表后续新提交）：[EXE](../../../releases/harness-016-baseline-2604e4ab/apps/desktop/.desktop-build/targets/win-x64/artifacts/deepseek-harness-0.1.6-alpha.2-win-x64.exe)、[MSI](../../../releases/harness-016-baseline-2604e4ab/apps/desktop/.desktop-build/targets/win-x64/artifacts/deepseek-harness-0.1.6-alpha.2-win-x64.msi)、[元数据与哈希](../../../releases/harness-016-baseline-2604e4ab/.artifacts/official-016-audit/windows-016-artifacts.json)。

## 阶段状态

| 阶段 | 状态 | 证据／剩余工作 |
|---|---|---|
| 0 工作树与基线 | 已完成 | 3,346 个非受控文件已逐文件 SHA-256 校验并归档；旧集成工作树与临时分支已正常移除；main 离线 frozen-lockfile install 通过；官方只读参考树保留用于迁移 |
| 1 官方核心 | 已完成本轮范围 | 七批本地提交止于 `88f1b251b2`；Host／Client／Web 构建、真实 Office 托管载荷、Headless 源码／built 回放、最终 SDK exe 的 ACL／图像恢复／PTC 与 workflow 验证通过。浏览器预设 6/7 通过，余项为旧侧栏 ARIA 期望；权限切换 3 项行为通过，afterAll 差异是基线已有模型路由与 workspace/changes 录制债。全局文档和 Windows 符号链接权限的既有失败仍保留，未宣称全部检查通过。 |
| 2 菜单／资源下载 | 安全资源已提交；语音／浏览器／CUA 收口中 | Voice Host 任务、原子模型替换、精确取消和独立录音测试页已实现；Browser 原生组件管理和官方插件启停已接入；CUA 工具目录就绪与权限状态独立展示。统一 Host／Client 类型检查及运行包／Web 构建通过；真实 Voice Loader 与托管 Chromium 验收通过。默认 profile 升级和最终浏览器场景／分批提交继续收口。 |
| 3 Orca bridge 替换 | CUA 原生替换已实现；Mobile provider 已实现，真机仍未验收 | 官方 CUA 0.28 已替换默认 Computer Use bundle 的旧 CLI；实际 Windows 专用窗口的 UIA／截图／写值／点击验收通过，真实 Harness 权限执行链已通过 7 次请求／决定和清理验收。原生 Android ADB provider 与官方 device-control profile 已装配；本轮 Loader fixture 40 项通过，使用受控 ADB transport，未连接真实 Android／iOS 设备。ADB 设备发现仍为空，原生镜像、截图和输入没有物理设备证据。 |
| 4 SSH／手机配对 | SSH 远端已完成实证；手机为浏览器配对完成，真机仍未验收 | Windows-to-Debian SSH acceptance 已通过真实外部 Debian 12 QEMU peer，覆盖运行时安装与 digest、目标 revision、Workspace／Session 绑定、远端文件／Subprocess／Bash／read-only Landlock／Git／Terminal／Agent PTC、取消、Session Controller 热重载后的冷恢复及清理。手机配对的真实 HTTPS/WSS Chromium 390×844 流程 2/2 通过，覆盖授权 Session 隔离、刷新、停止生成、正式 ask_user_question、一次性受限写入、持久化与撤销；原生 ADB Loader fixture 40 项通过，但没有物理设备或原生手机安装包证据。 |
| 5 剩余功能／安装包 | committed-main EXE/MSI 构建已完成；签名与安装运行验收未宣称 | SDK 最小 profile 环境说明已修正并经真实进程请求验证；Plugin Manager 与 HMR 统一生命周期已通过既有回归；终端标题／恢复已通过真实 Chromium 刷新和最终回放。`pnpm run build:official` 和 `node --import tsx/esm apps/desktop/scripts/package-target.ts win-x64` 均从 committed main 完成；安装器未执行，签名状态为 NotSigned。 |

## 本轮可复核证据

完整 SSH 命令：`$env:DSH_WINDOWS_LINUX_SSH_SCENARIO=(Resolve-Path .artifacts/native-migration/windows-linux-ssh-scenario.json).Path; $env:DSH_SNAPSHOT="replay"; node node_modules/vitest/vitest.mjs run --config vitest.web.config.ts apps/web/tests/windows-linux-ssh.acceptance.e2e.ts`。官方 Loader 组合在真实 Windows-to-Debian Debian 12 QEMU peer 上通过 1 个测试，最终运行时间约 76 秒；该验收不是目录检查，也没有执行 Windows 安装器。

本轮源码与生命周期回归命令覆盖 FileUploads resolver、Node PTC Cordis shadow、ToolRuntime PTC、远程 runtime provisioning，6 个文件共 `165 passed, 3 skipped`；受影响编译面 `tsc -b` 通过，定向 Oxlint 为 0 warning／0 error。Session Controller 禁用再启用路径已在上述真实 SSH acceptance 中实际执行并通过。

`pnpm run build:official` 已成功完成，官方构建记录 `287 client artifact(s)` 和 4 个 public values；构建输出有既有 Vite chunk-size warning，不是失败。构建后再次运行同一 SSH acceptance 仍通过。

Committed main 的 Windows packaging 命令 `node --import tsx/esm apps/desktop/scripts/package-target.ts win-x64` 退出 0。EXE 为 447,596,531 字节，SHA-256 `b08362fb320896549205fb2c2f00e7f6dff2126e45e313e7012fa2488873e552`；MSI 为 474,886,884 字节，SHA-256 `b4d41fdcef4d32bed8f635d459bcaac3b16a36c5387a7c3b2e903dfbafe90575`；blockmap 为 464,424 字节，SHA-256 `52c91f131f02f11bdcfa758c5d4a5134af2b0ffcdbf2f9ddc098aa1a02609883`。`Get-AuthenticodeSignature` 报告 EXE 与 MSI 均为 `NotSigned`。没有执行 EXE/MSI，也没有宣称签名或安装后运行验收。

手机证据命令为 `node node_modules/vitest/vitest.mjs run --config vitest.web.config.ts apps/desktop/tests/phone-pairing.e2e.ts apps/desktop/tests/phone-interactions.e2e.ts`，2 个真实 HTTPS/WSS Chromium 手机视口测试通过；`packages/bundle/cinlan-mobile-device`、mobile-device runtime 和 tool suites 合计 40 项通过。前者是浏览器配对，后者是受控 ADB fixture，二者都不证明物理设备、原生 APK/IPA 或真机截图输入。

文档 quick gate 仍被基线债务阻断：旧 docs/dev 双语缺失、既有 Markdown wrap、README Summary／Model Experience／Limitations 失败以及既有 doc-standard 失败；本轮新增和修改文档的 Agent Note format、classification、三组 bilingual pairing 定向检查均通过。完整全库 lint 的既有失败也未被改写为通过。

## 架构核验补充

官方 Desktop update journal 是可选脱敏诊断日志，不承担本地 profile／seed 事务恢复；迁移时保留本地 activation journal 的独占恢复职责。官方任务锁需接入本地真实 RPC 与流请求入口，不能只复制一个本地不会触发的事件监听。PTC Windows 控制管道、ACL 和 source launcher 必须与默认装配一起迁入。

基础 profile 已挂载官方 Node PTC 与 workflow-ptc；Headless/Web 不再重复挂载 worker runtime。产品预设移除外部 Codex／Claude CLI 工具模板，保留 Harness 原生子代理。Office 技能 provider 与检查器已迁入；托管解释器和依赖查询的实际 owner 是 Desktop Host 与 Desktop 载荷，正在补齐这条交付链。

Windows 受限 PTC 的控制管道源码回归已通过；初次失败来自源码测试加载旧 built ACL runner，fixture 明确选择源码入口后恢复。阶段 1 Host build 后，PTC 与 workflow 两个 built smoke 均通过，验证实际 `lib` 入口与受限写入；最终 main 安装包仍需重新构建和验收。

锁文件由主协调工作统一生成并备份。一个并行子任务误还原共享 lock 后，已按当前 manifests 重新离线安装恢复。Host、Client 和 Web 构建已通过；公开类型等价检查 428 个主块及双语对应通过。权限 live catalog、稳定命令身份、预设切换策略和 Plugin Manager 工具已补齐。新 SDK 图像卸载场景已通过真实 profile 回放，未修改既有 JSONL。

Python SEA 构建脚本内部的 `pnpm exec pkg` 曾触发 pnpm 11 生产依赖同步并移除开发依赖链接；构建器已改用直接 Node 入口，依赖已恢复，受影响的 Office 回放与定向检查已重跑通过。根 `.npmrc` 将隐式依赖同步设为失败退出，依赖变更由显式安装统一处理。Office Windows 载荷已通过真实下载、SHA 校验、生产安装器复制和载荷内 Python 的 DOCX／PPTX／XLSX 生成重开检查；共 8,104 个文件、294,431,271 字节。Headless 源码与 built smoke 均通过，持久化场景显式等待 backend 就绪。Python 实际 exe 的图像卸载通过；Windows read-only ACL 通过，workspace-write 首轮失败已定位到 Python 临时目录的私有 OWNER RIGHTS ACL，源码与 exe 在同目录均失败；用正常继承 ACL 的隔离工作区复验后，read-only 拒写、workspace-write 写入、显式子目录和越界拒写全部通过，未放宽产品沙箱权限。PowerShell 5.1／7 的受限语言 UTF-8 前缀已修复并实测；最终 exe 三组 smoke 全部通过，SHA-256 为 `cd6a521bfdb8ba662186add60534aa191b708b6ebe8e6b2525421de3a2c3454d`，与 Python carrier 一致。本记录不把上述单项验证当作最终安装包验收。

## 安全资源验收

资源管理器在 Web Host 根挂载一次，全局 provider 使普通 standard／PTC／Cordis 会话能够发现已安装技能；安全研究预设保留作用域覆盖。下载、重新下载、更新、移除和显式内置安装由 Host 持有，离开设置页不会取消任务。空安装记录也保存递增 revision，拒绝跨 Host 的过期提交；原子指针替换开始后以提交结果为准。已加载文件保留至所属 realm 释放，全局消费保留至 Host 关闭。

真实浏览器测试验证受控 HTTP 下载进度、切页持续、取消、503 后重试、重新下载、更新、复用同一 home 的两次 Host 启动、移除，以及四个普通 Agent 的目录与技能正文读取。最终移除指针为 `schemaVersion: 1, revision: 4, installed: null`。另有真实 Agent Loop 使用官方技能工具加载根路由与 JavaScript 逆向技能，模型请求正文与重新打开 Session 后的持久化正文逐字一致；外部模型用脚本适配器替代，未调用外部模型服务。历史 Session JSONL 未改写。

本地资源包为 `security-skills-1-0217f0389395d297.zip`，7,912,213 字节，SHA-256 `ef6ee244cef4d409dd9762046e655a6b00504556a51a9d2114294f12347c72c8`。正式模块入口重新构建得到相同哈希。清单没有公开下载 URL；发行内容保留来源与许可不完整的声明，安装不会执行附带脚本或配置外部 Agent／MCP。

写锁持有者崩溃后仍需确认进程停止再人工恢复锁文件，该限制保留在包 README。全库 lint 实际执行得到 14 个警告和 2,544 个错误，诊断路径与本批修改文件没有交集；依赖检查仍因既有 `ui-deliverables` 的 `FsError` 身份分类缺失失败。未放宽检查规则，也未将这些检查写成通过。

本批前两笔本地提交为 `491f5e9707`（资源管理、Provider、打包及回归）和 `5f0c900fea`（独立资源设置页、Remote 与普通会话装配）。生成目录收口修复了显式子入口被自动别名区域覆盖、全局事件误用作用域扫描注解，以及 Windows CRLF 导致重复生成漂移的问题；生成目录新鲜度和 13 项配对／区域回归通过。没有远端推送。

文档全量 34 个检查叶子通过直接 Node 入口执行，包含 quick 子集且不重复运行；本批问题修复后 24 项通过，余 10 项是基线既有文档／格式问题，原始失败与逐项分类保存在本地验收日志。生产文档站构建及 3,054 个内部片段解析通过。完整阶段 2 的其余菜单证据见下节；安全资源完成不代表全部菜单或最终安装包已经交付。

## 语音、浏览器与 CUA 验收

语音模型管理由 Host 持有任务身份与取消，下载／重下／更新保持已验证旧代可用；持久 revision、跨进程 CAS 与 recognizer lease 防止过期下载复活已移除模型或删除仍在识别的文件。初始 104 个 Host／Remote／资源用例通过；独立审查随后发现响应头早拒绝时未消费 HTTP body 的清理缺陷。五个持续保持连接的 HTTP 回归在修复前四败一过，修复后完整传输文件 20 项通过，定向 lint 和 Provider 类型检查通过；独立审查确认该 P2 已关闭，随后完整语音定向回归 10 个文件、109 项通过。

本机 EN20M 四个模型文件逐个 SHA-256 与固定清单匹配。直接 Sherpa 原生引擎和真实 Loader／VoiceRuntime／生产 Provider 两种验收均实际识别 6.415 秒的 Windows System.Speech 合成音频；Loader 验收使用隔离缓存副本，验证旧文件接管为已验证代、原生识别、持久移除及清理，没有改动用户模型目录。输出为“N FOX JUMPS OVER THE LAZY DOG THIS IS A LOCAL SPEECH RECOGNITION TEST”，首句开头有漏字，不宣称逐字准确率。设置页浏览器流程已通过下载、切页取消、重下、固定清单更新、录音测试、移除的首次验收及重复回放；录音硬件及外部识别模块为明确测试夹具，真实浏览器录音／PCM／Remote／Host 资源事务保持执行，另有上述真实原生识别证据。

浏览器组件通过维护中的 Playwright 1.61.1 安装器安装 Chromium revision 1228／149.0.7827.55，安装器只使用任务私有目录。61 个 Host／Provider／Controller／bundle 用例及关联元素捕获 Loader 用例通过，资源组件与观察器 23 项通过。真实 Harness Loader 使用系统 Chrome 与托管 Chromium 的两条路径均通过隔离 profile 启动、回环页面导航、页面观察、运行中拒绝移除、关闭、组件移除及清理。首次无代理下载在 600 秒超时；使用机器已配置代理的官方安装器验收通过，未创建额外网络路径。运行时不自动导入 Windows 系统代理，此限制已记录。

CUA 设置显示真实 SDK 工具目录状态，不虚构旧 facade 的协议版本或支持矩阵；系统权限保持 unknown。官方策略默认 ask，所有 cua_driver_native__ 工具均受执行器权限检查。111 个相关 Host／权限／消费者用例通过；共享设置新增启停与目录回归后整包 105 项通过。实际 CUA SDK 在专用 WinForms 窗口完成精确 PID／窗口定位、UIA 与截图观察、set_value、按钮 click，再通过新 UIA、应用输出文件和截图确认结果，窗口已正常关闭。随后真实 Loader／Tools.execute 验收通过：7 次调用均经过官方 ask 策略，1 次拒绝的原生分派计数为零，6 次批准完成读取、写值与点击；实际 Session 保存 7 个请求与 7 个决定。三张持久附件截图和应用输出逐项确认，父协调独立查看最终截图。Loader 关闭后 provider 释放、原生工具数归零、测试进程退出。上述工作区 built 验收不代替最终安装包验收。既有 CUA Session 在 Windows 回放于首个请求目录的 bash／pwsh 平台差异失败；没有改写历史 JSONL 或掩盖失败。

本批构建日志、独立审查和原生报告保存在 .artifacts/native-migration。新增默认 Web／Desktop 装配通过末尾配置 bundle 关闭两个可选 Provider，设置页使用官方 Plugin Manager 修改真实 entry；模型资源管理器保持可读。默认 profile 的旧精确元组升级、用户覆盖保留与官方 Plugin Manager 持久启用已通过 101 项相关测试。真实 Web 元素截图验收发现 Controller 在可选服务模式下仍通过严格属性读取 attachments，已修正并实际复验通过。新资源页暴露的 Provider 启用后 Settings 名称空间通知缺失已沿官方服务事件、Remote 转发和 Client 唯一镜像修复并提交 `a1c7d98e48`，204 项定向检查通过。实际动态 Client 产物重新构建后，Browser 三文件七场景回放通过；通用 Voice 页面新增两份资源／禁用状态预期并刷新、回放通过。Provider 资源界面与这些浏览器回归已提交 `aceb074d25`。

本批已有本地提交 7fd5c7353a（Voice Host 资源事务）、b3f69df797（Voice 模型与录音测试页）、1c065a7f6c（原生 CUA 与默认可选装配）、51d2f1124f（Browser 原生组件管理）。提交钩子的配对、空白与 lint 检查均通过；部分轻量 staged lint 对类型 lint 抑制注释报告未使用警告。没有远端推送，尚未生成本批 Windows 安装包。

SDK 最小 profile 的 Bash／PowerShell 描述不再假定禁网或存在 apt／pip 镜像，明确由 Host 环境决定。实际官方 CLI profile、SDK initialize／prompt 和本地模型 HTTP 请求验证了描述；断言按当前 Messages 协议读取工具 name／description。提交 `9c8477d1a4` 的定向 lint、双语配对和真实 profile 验收通过。
