# 设置整包验收状态

状态：**2026-09-18 最终 Windows x64 正式打包成功，实际打包应用的启动、设置操作和完整进程重启验证通过。捕获 bundle/Session 草稿交接修正已纳入最终包；元素捕获、Git、Worktree 与通知等设置的最终 Web 回放通过。全仓文档检查仍有失败，安装、升级和部分交互验收未完成，本分支按草稿 PR 提交审查。** 本记录对应[实施方案](settings-native-implementation.md)和[字段账本](settings-native-field-ledger.md)，区分源码、开发版、打包产物及未完成的发布检查。

## 范围与保留项

- 字段账本包含 25 页、148 个唯一原型字段；这是消费者分类的覆盖数，不是全部功能已经实现的声明。未支持字段仍保留其明确限制。
- 用户批准的 [settings-native-preview.html](../../reports/settings-native-preview.html)未修改；最终复核 SHA-256 为 `35BBCB0D0D818E8CE56E523BC0B9DBE3717FCBA2D03D05DDEE468BDA84095C32`。
- 分支为 `fix/settings-native-acceptance`，目标为 `lianyorker/cinlan-harness` 的 `main`。保留既有暂存内容；独立的 `.agents/skills/cinlan-design/`、`.agents/plans/cinlan-design-review.md`、`apps/desktop/coverage-floating/` 不进入本次提交。
- 用户要求恢复环境、先打包验证，再使用现有代理推送；不直接合并或发布安装包。打包文件和本地 `.artifacts` 证据不进入源码提交。

## 最终安装产物

正式命令 `pnpm run package:desktop:win:x64` 于 `2026-09-18T03:44:08Z` 开始、`03:56:23Z` 以 0 退出。配置 schema 与生产依赖预检、Host/Client/Web/native 构建、运行时准备、seed 离线安装验证、ASAR、NSIS 与 MSI 阶段均完成。完整记录在忽略目录 `.artifacts/windows-package.log`、`.artifacts/windows-package-console.log` 和 `.artifacts/windows-package-result.json`。

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| `deepseek-harness-0.1.5-alpha.1-win-x64.exe` | 265,429,994 | `fd5766d520a7235faf50accd90064e00883d0cb991bd849d383d87ca6da3163d` |
| `deepseek-harness-0.1.5-alpha.1-win-x64.msi` | 287,008,664 | `434456af621ca354bdaf796d6e8436748dc4f92370ff749c6819f95b89ad1559` |
| `.exe.blockmap` | 277,866 | `c9f1416bd0eed69cc5ac9e85fccb54ea16f0bef5b40aeaf3c4af2ee375a959f2` |
| `win-unpacked/resources/app.asar` | 实际启动路径已验证 | `9dba494dc5ea306deefaff4a13f016a9bf71893d378592649aa65d2321aa9420` |

产物位于 `apps/desktop/.desktop-build/targets/win-x64/artifacts/`。Electron 44.0.0 使用随包 Node `24.17.0`、pnpm `11.7.0` 和版本 `0.1.5-alpha.1` 的离线 seed。上传计划要求非空外部 `.exe.blockmap`，按 EXE → blockmap → 频道元数据排序；8 项上传计划测试通过。先前的 `.artifacts/windows-package-inspection.json` 只对应 `02:20:16Z` 完成的旧包及修复前的上传校验，不能作为本表最终文件的证据。

最终独立校验见 `.artifacts/windows-final-inspection.json`：`alpha.yml` 的 EXE 大小与 SHA-512 匹配，外部 gzip blockmap v2 的 12,693 个数据块覆盖完整 265,429,994 字节；ASAR 包与 6 个入口存在。使用完成记录中的 test origin 和明确的假 bucket 运行 `createDesktopUploadPlan('win-x64')` 成功，顺序为 EXE、blockmap、alpha.yml，没有网络上传。`Get-AuthenticodeSignature` 确认本表 EXE/MSI 均为 `NotSigned`，无签名者。这些是本地验收产物，不是签名发行包；未执行真实更新服务测试、安装器交互安装或跨版本升级，本地默认更新地址为占位地址。

## 真实 Electron 检查

开发模式通过支持的 `pnpm run start:desktop` 入口启动，隔离 Harness home 和 Electron userData。六项设置检查通过：首次提示处理、中英文布局、搜索与焦点、语言持久化、Escape/返回与刷新。开发模式回执为 `.artifacts/desktop-settings-hMLXx1/report.json`，与最终打包证据分开保留。

最终实际产物使用以下命令验证：

```powershell
node apps/desktop/tests/settings.integration.mjs --packaged 'D:\Company\cinlan\cinlan-harness\apps\desktop\.desktop-build\targets\win-x64\artifacts\win-unpacked\DeepSeek Harness.exe'
```

`.artifacts/desktop-settings-7jkEDs/report.json` 记录 `passed=true`：`app.isPackaged=true`，应用路径是实际 `resources/app.asar`；随包 Node 启动独立 home 中已安装的 Desktop Host，应用、seed、dsh、Host 版本均为 `0.1.5-alpha.1`。Git 的 branchPrefix/groupOrder、终端字号 16 和英语偏好通过 UI 保存；退出进程并重新启动后仍保留，设置文件字节一致。两次应用均以 0 退出，调试端口关闭，临时根目录已清理。截图涵盖中文、英文、搜索、Git、Terminal 和重启结果。

隔离 home 的首次启动包含 seed 离线安装，准备预算为 300 秒；测试 startup-to-interaction 阶段间隔为 236.143 秒，重启为 6.544 秒，这是测试阶段计时，不是单独测量的应用启动性能。冷启动期间 Chromium NetworkService 发生一次崩溃或终止后自行重启，原因未查明；记录在该目录 `launch.log` 第 6 行，随后交互检查通过。终端设置的保存与重启持久化已验证；实际打包应用内执行终端命令为 `not-run`，因为隔离 home 没有 Workspace/Session，创建需要 renderer CDP 无法操作的原生目录选择器。

关闭阶段的 `POST dsh-app://app/.dsh/remote-stream` 失败单独记录为生命周期事件；只有精确 URL/方法/请求起始时间/响应时间均对应关闭阶段且最终正常退出时才允许，其他 503 仍失败。13 项反例验证了此限定。早期打包启动探针的 Playwright 默认 30 秒 CDP 超时已改为显式、有界的 300 秒准备预算，未跳过 UI 检查。

## 功能验收

| 能力 | 已验证行为 | 剩余边界 |
|---|---|---|
| 通知免打扰 | 组件与实际投递组合、FileSettings 持久化/冲突、真实 Web 偏好保存/重置和最终回放通过。起止时间原子写入，自动提醒按本地时区抑制；显式测试仍受总开关和权限约束。 | 操作系统授权弹窗和每种声音不在当前浏览器检查范围内。 |
| Worktree 默认值、审查与生命周期 | Provider 66 通过、1 跳过；Controller 三项回归及 UI 测试通过。真实 Web 最终回放验证保存默认值、创建、captured base/patch 审查、hibernate 不执行 cleanup、archive 收据。 | 默认 Web 仍不挂载可选 Worktree，真实场景通过正常 overlay 启用。任意外部 hook 效果不承诺恰好一次。 |
| 元素捕获 | 真实 Chromium 选择/取消、裁剪预览、附加原 Session 草稿、另一个草稿不变、没有新增 `user/message` 全部通过；最终 expected 回放通过。注册测试使用真实受限 Cordis 子 scope，三项通过。 | 可选 `cinlan-browser` bundle 挂载页面；通用 Web 不自动启用 Browser。 |
| Git | 生命周期/Remote 等待及 Host 测试通过；assembled sidebar Git 最终 Web 回放读取 Session 仓库文件，未出现原 `reading 'status'` 错误。打包应用 Git 偏好跨重启保留。 | 未在真实用户仓库中执行应用内提交、推送或破坏性 Git 操作。 |
| 浏览器与设备 | 五项 native-browser-settings 场景通过，包括偏好、真实 Chromium 操作、主页/搜索、历史/网络、文件传输和 Cookie。设备三项场景通过，按实际挂载的安全研究页面检查配置状态。 | 页面未检查的系统权限不被标记为已授权；这两组本轮证据为场景运行/refresh，不并入下面的最终 replay 数量。 |
| 原生终端 | 两项真实 Loader/PTY 回归通过：空偏好、共享/停泊、无效程序恢复、带空格绝对路径、重附加和精确进程退出。修复 inspectUi 参数与 YAML 路径断言后通过。 | 打包应用仅验证终端偏好 UI 与持久化，未完成全部 Shell/PTY/前台交互矩阵。 |

最终 `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts ...` 覆盖 `settings-element-capture.e2e.ts`、`settings-sidebar-git.e2e.ts`、`settings-worktree-tasks.e2e.ts` 和 `settings-feature-pages.e2e.ts`，共 7 项通过。后一个文件还覆盖并行度/搜索、语音偏好刷新、窄屏和放大后的控件可用性。首次 Worktree replay 的行为断言通过，但 expected 含双重转义后的随机临时路径；已修正该场景的精确替换、重新生成 expected 并独立 replay 通过，保留程序文本和真实 hook 收据断言。日志为 `.artifacts/settings-final-web-replay.log`（含首次失败）、`.artifacts/settings-final-worktree-refresh.log` 与 `.artifacts/settings-final-worktree-notifications-replay.log`。

其他通过的定向组包括：Desktop package-target 12 项、签名配置 10 项、通知/Worktree/捕获/安全页面 146 项、设置 scope/metadata/Git/Host 74 项、通知组合与 Worktree Controller 10 项、Browser bundle 2 项。`test:gui` 实际运行 511 个文件，6,429 项通过、7 项跳过、1 项 Worktree 审查区滚动条样式失败；补齐主题令牌后所属 21 项通过，未重跑整个 GUI 命令。侧栏 lint 修正后 142 项定向测试和包级类型检查通过；Provider/Controller/浏览器偏好组合为 84 通过、1 跳过，最后浏览器草稿显式类型修正的 15 项回归通过。

终端历史证据仍按时间区分：原 stream-error 为 10:36:25，截断 Shell `C:\Program` 保存于 10:39:28，后者不能解释前者。

## 文档、生成器和锁文件

最后一次 `pnpm run doc-sync` 实际结果为 **21 通过、13 失败**，耗时 168.87 秒，日志 `.artifacts/settings-final-doc-sync.log`。随后 README model-experience 的标题锚点修正经独立命令验证通过；generator fixture 的临时包路径误报已消除，package-path gate 仍报 19 条 `docs/dev` 引用。全仓 aggregate 未再运行，不宣称文档全绿。

仍需处理的失败包括 doc-typecheck 示例、doc graph 缺少 36 个角色分类、config catalog 的 25 项源码/schema/JSDoc 违规、tool catalog 的移动设备描述、双语覆盖/记录、Markdown wrap、导出 JSDoc、README Summary/limitations、Agent Note 格式和文档标准测试。失败属于当前树，不能统一标为与本 PR 无关。缺失真实模型凭据也使 GUI 演示 GIF 未完成；没有以 fixture GIF 替代。

`pnpm run typecheck` 通过。Cordis catalog 121 项产物、inspect catalog、tsconfig paths、159 个 Cordis 配置、82 个包的依赖检查、71 个 Client 包检查及 module graph 3 项产物检查通过；生成内容由官方工具写入。Typert 的映射导出优先 `.ts`、再选择存在的 `.tsx`，8 项文件系统回归和定向 lint 通过，Host/Client 编译面保持分离。暂存源码只读 lint 通过，另有未使用的 lint-disable 警告；完整 lint/doc-sync 不据此标为通过。

锁文件审查覆盖 394 个 manifest/importer、4,510 项直接声明和 589 项 registry 范围，初始结果一致；22 个新 importer 和新增依赖闭包有对应源码。既有 express 的 proxy-addr 从 2.0.7 变为 2.0.8，其余直接 registry 版本没有变化。随后通过 `pnpm --filter @deepseek-ai/dsh-cinlan-browser install --offline --ignore-scripts` 加入捕获页 workspace 依赖，官方锁文件同时校正 http-proxy-agent/pi-ai 的 supports-color peer 后缀。

提交预检的 133 项暂存双语配对通过。Typert sidecar 曾因 5 个 CRLF 与 Git LF 规范化不同而不匹配，已仅规范化换行并按官方流程重记，不改变暂存正文。第三方 notices hook 发现 `ssh2` 的旧式 `licenses` 元数据和 pnpm 未安装平台包的空目录；已核对 MIT LICENSE、沿用元数据例外表并修正扫描器，正式生成器补入 cron-parser、ssh2 和 @types/ssh2，所属 28 项测试和定向 lint 通过。

## 环境恢复与打包故障记录

早期执行器无法遍历依赖 junction，报告 Windows 448 / UNKNOWN，导致 tsx、TypeScript 和测试入口不可用；普通终端安装成功后，当前执行环境已能运行 pnpm、生成器、测试和正式打包。没有关闭系统安全策略。

打包故障曾涉及重复类型导出/精确可选属性、Client 引用和 fixture 缺项、缺失组件、MSI `runAfter` 无效字段；配置修正为 `runAfterFinish` 并加入早期 schema 预检。pnpm 11 默认列出全部工作区引发的 EMFILE 由 builder 专用 desktop filter 和单根完整生产树预检解决；源构建和 seed 保留各自的完整依赖图。最终包之前的 BrowserRoutingForm TS7053 已通过显式 `Partial<BrowserRoutingPreferences>` 修正，类型检查和 15 项回归通过后完成正式打包。

## 剩余验收

1. 处理上面的全仓文档失败，保持草稿 PR 状态，直到需要的审查与 CI 证据齐备。
2. 补齐 1680×1000、1280×800、768×1024、390×844、320px 回流、200% 缩放、明暗主题及中英文组合矩阵；已有部分场景不代表完整矩阵完成。
3. 在可操作原生目录选择器的环境中验证打包应用终端命令，并补充安装器安装、升级、签名和真实更新服务验收。
4. 获得真实 API 凭据后录制提交对应的真实服务器/模型回合 GUI GIF。当前无 `DEEPSEEK_API_KEY` 或常规凭据文件，未生成此证据。

已知实现限制：路径检查不能阻止另一个进程替换目录。创建结果未知时任务尚未发布，需按诊断检查分配；发布前硬崩溃没有持久化创建日志自动恢复。Cleanup 收据不证明创建过程具有相同恢复保证。[Worktree 生命周期提案](../notes/proposed/feature/2026-09-18-worktree-task-lifecycle-hooks.md)在完整验收确认前仍保留 proposed。
