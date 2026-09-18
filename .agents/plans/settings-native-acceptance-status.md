# 设置整包验收状态

本页保留截至提交 `59f7facff8` 的设置接入与同版本重装修复验收。后续官方选择性同步、可见启动页和当前 Windows 安装包记录见[官方同步与启动验收](official-sync-2026-09-18.md)；下面的安装包哈希属于前次构建，不代表可被后续构建覆盖的本地产物路径当前内容。

状态：**2026-09-18 已完成同版本 Desktop profile 校准、事务恢复加固、默认启动诊断、定向回归、类型检查、Oxlint、双语配对、Windows x64 打包及 detached 旧 profile 隔离验收。源码提交与远端检查状态以草稿 PR #14 为准。** 本记录区分修复前已发布产物、修复后本地安装包及仍未完成的发布检查，对用户运行目录不执行破坏性操作。本记录对应[实施方案](settings-native-implementation.md)和[字段账本](settings-native-field-ledger.md)。

## 范围与保留项

- 字段账本包含 25 页、148 个唯一原型字段；这是消费者分类的覆盖数，不是全部功能已经实现的声明。未支持字段仍保留其明确限制。
- 用户批准的 [settings-native-preview.html](../../reports/settings-native-preview.html)未修改；最终复核 SHA-256 为 `35BBCB0D0D818E8CE56E523BC0B9DBE3717FCBA2D03D05DDEE468BDA84095C32`。
- 分支为 `fix/settings-native-acceptance`，目标为 `lianyorker/cinlan-harness` 的 `main`。保留既有暂存内容；独立的 `.agents/skills/cinlan-design/`、`.agents/plans/cinlan-design-review.md`、`apps/desktop/coverage-floating/` 不进入本次提交。
- 用户要求恢复环境、先打包验证，再使用现有代理推送；不直接合并或发布安装包。打包文件和本地 `.artifacts` 证据不进入源码提交。

## 最终安装产物

正式命令 `pnpm run package:desktop:win:x64` 本轮最终构建于 `2026-09-18T09:28:41Z` 写出发布记录并以 0 退出。配置 schema 与生产依赖预检、Host/Client/Web/native 构建、运行时准备、seed 离线安装验证、ASAR、NSIS 与 MSI 阶段均完成。完整记录在忽略目录 `.artifacts/desktop-transaction-package-final2.log`。

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| `deepseek-harness-0.1.5-alpha.1-win-x64.exe` | 265,367,687 | `43e7dfb13f66a1c94500534de418ea309e33d6b4e6ccfb9a90e9b3472df301c3` |
| `deepseek-harness-0.1.5-alpha.1-win-x64.msi` | 287,029,144 | `6a6f637b6cf5d933185520bcec11b1e78b8133eb1b6700099d66bc0807cda4ea` |
| `.exe.blockmap` | 277,410 | `41d66eac4741a22b405442df62d7b2894835cdb459ec63eb7ff2257bfa639025` |
| `win-unpacked/resources/app.asar` | 2,464,646 | `1aec4fe609e8ba4e4f8ccb035c3dc7f372642a76de11dffb3980f4a20088575a` |

产物位于 `apps/desktop/.desktop-build/targets/win-x64/artifacts/`。Electron 44.0.0 使用随包 Node `24.17.0`、pnpm `11.7.0` 和版本 `0.1.5-alpha.1` 的离线 seed。上传计划要求非空外部 `.exe.blockmap`，按 EXE → blockmap → 频道元数据排序；本轮打包日志完成 MSI、NSIS 与 blockmap 阶段。最终 EXE 和 MSI 的 Authenticode 状态均为 `NotSigned`。

固定安装包的最终隔离验收见 `.artifacts/desktop-transaction-packaged-final2.log` 与 `.artifacts/desktop-settings-edjRk1/report.json`：旧同版本默认 profile 被复制到隔离 home，新的 seed 替换旧 UI，并保留 rollback、共享 settings 与 Session 目录 sentinel；相同内容重启复用校准后的 profile，完整进程重启后设置仍保留。插件精确版本保留由定向事务回归证明，因为打包 fixture 明确只包含默认 bundles。最终报告为 `passed=true`，两次应用进程退出码均为 0，调试端口已关闭，临时根目录已清理，fixture 源目录未改变。首轮冷启动在仍重建 profile 时达到 300 秒 CDP readiness 阈值；该进程随后由验收脚本正常停止并以 0 退出，没有生成 startup-error 日志。只针对 `--existing-profile` 的阈值提高到 600 秒后，最终首启从应用启动到交互为 274.131 秒，相同 profile 重启为 6.714 秒；这些时间包含验收开销，不是启动性能基准。该验收未安装到当前用户正在运行的 Desktop，也未执行真实更新服务上传。

## 真实 Electron 检查

开发模式此前通过支持的 `pnpm run start:desktop` 入口启动，隔离 Harness home 和 Electron userData；本轮固定包验收没有修改当前用户运行目录。

固定包使用以下命令从 detached 旧同版本 profile 启动：

```powershell
node apps/desktop/tests/settings.integration.mjs --packaged 'D:\Company\cinlan\cinlan-harness\apps\desktop\.desktop-build\targets\win-x64\artifacts\win-unpacked\DeepSeek Harness.exe' --existing-profile 'D:\Company\cinlan\cinlan-harness\.artifacts\desktop-old-runtime-7EZ0Ag\profile'
```

`.artifacts/desktop-settings-edjRk1/report.json` 记录 `passed=true`：实际 `resources/app.asar` 启动并在隔离 home 中安装同版本 seed；旧 profile 的 stale UI 被新 seed 替换，rollback、共享 settings 与 Session 目录 sentinel 保留；相同内容重启复用校准后的 profile；完整进程重启后语言、搜索、Git 偏好、终端偏好和完整 settings 文件仍保留。应用进程退出码为 0，调试端口已关闭，临时根目录已清理。

该验收包含中文/英文设置布局、搜索与焦点、Escape/返回、Git 与终端设置保存；关闭时 remote-stream 503/ERR_FAILED 只作为已知 shutdown 生命周期事件记录，不影响退出判定。没有执行真实更新服务上传、安装到当前用户目录或跨版本更新；当前运行中的 Desktop 和其 `$DSH_HOME` 未被本轮打包与隔离验收触碰。

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

本轮最终 `pnpm run typecheck` 通过；Desktop transaction、startup diagnostic、core package set 和 seed store 共 32 项定向测试通过；目标 TypeScript 文件的 Oxlint 为 0 warnings / 0 errors；两组 Desktop 双语记录定向验证一致。Cordis catalog 121 项产物、inspect catalog、tsconfig paths、159 个 Cordis 配置、82 个包的依赖检查、71 个 Client 包检查及 module graph 3 项产物检查通过；生成内容由官方工具写入。Typert 的映射导出优先 `.ts`、再选择存在的 `.tsx`，8 项文件系统回归和定向 lint 通过，Host/Client 编译面保持分离。完整 lint/doc-sync 不据此标为通过。

锁文件审查覆盖 394 个 manifest/importer、4,510 项直接声明和 589 项 registry 范围，初始结果一致；22 个新 importer 和新增依赖闭包有对应源码。既有 express 的 proxy-addr 从 2.0.7 变为 2.0.8，其余直接 registry 版本没有变化。随后通过 `pnpm --filter @deepseek-ai/dsh-cinlan-browser install --offline --ignore-scripts` 加入捕获页 workspace 依赖，官方锁文件同时校正 http-proxy-agent/pi-ai 的 supports-color peer 后缀。

提交预检的 133 项暂存双语配对通过。Typert sidecar 曾因 5 个 CRLF 与 Git LF 规范化不同而不匹配，已仅规范化换行并按官方流程重记，不改变暂存正文。第三方 notices hook 发现 `ssh2` 的旧式 `licenses` 元数据和 pnpm 未安装平台包的空目录；已核对 MIT LICENSE、沿用元数据例外表并修正扫描器，正式生成器补入 cron-parser、ssh2 和 @types/ssh2，所属 28 项测试和定向 lint 通过。

## 环境恢复与打包故障记录

早期执行器无法遍历依赖 junction，报告 Windows 448 / UNKNOWN；普通终端安装成功后，前一轮执行环境能够运行生成器、测试和正式打包。本轮同版本升级修复开始时也曾遇到该限制；用户在独立 Windows PowerShell 中完成冻结锁文件安装后，后续应用内执行器能够解析依赖并完成定向测试、类型检查、lint 和正式打包。没有停止当前用户的 Desktop、运行旧 profile 修复脚本、修改系统安全策略或改写 `C:\Users\ASUS\.dsh`。

打包故障曾涉及重复类型导出/精确可选属性、Client 引用和 fixture 缺项、缺失组件、MSI `runAfter` 无效字段；配置修正为 `runAfterFinish` 并加入早期 schema 预检。pnpm 11 默认列出全部工作区引发的 EMFILE 由 builder 专用 desktop filter 和单根完整生产树预检解决；源构建和 seed 保留各自的完整依赖图。最终包之前的 BrowserRoutingForm TS7053 已通过显式 `Partial<BrowserRoutingPreferences>` 修正，类型检查和 15 项回归通过后完成正式打包。

## 同版本重装修复

`DesktopProjectManager.applyRelease()` 只有在经过验证的完整核心包描述文件与发布元数据均一致时才复用运行目录；同版本但 SHA-512 不同的包进入既有 staging、精确插件恢复、健康检查和回滚流程。事务 journal 使用同目录临时文件、`fsync` 和原子 rename 提交每个阶段，只接受 UUID 拥有的规范 staging profile，并在新 Host 启动成功后记录 `committed`；提交后清理失败不会回滚正在运行的新 profile。恢复与 orphan 清理都在事务锁内，只删除直接 UUID 根；启动失败写入 `$DSH_HOME/desktop/startup-error.log`，也可由 `DSH_DESKTOP_DIAGNOSTIC_FILE` 覆盖。

新增单元用例覆盖等长不同内容、Node/pnpm 元数据变化、相同内容不重复安装、健康检查失败保留旧目录、插件/共享数据保留、全部 journal 阶段恢复、路径 alias 拒绝、原子 journal 写失败以及提交后延迟清理。打包验收新增 `--existing-profile`，从脱离运行环境的旧 profile 副本初始化隔离 home，验证旧设置 UI 被目标 seed 替换、rollback 保留旧组件、共享设置与会话目录标记字节保留，以及第二次启动复用更新后的目录。会话目录标记不代表真实 Session 加载或迁移通过。旧运行目录的独立测试副本位于忽略目录 `.artifacts/desktop-old-runtime-7EZ0Ag/profile`：307 个 tarball 均通过源码完整性校验，复制过程检查了 37,509 个普通文件和 4,421 个目录，没有复制符号链接/junction；复制前后源目录的清单与设置 bundle 哈希一致。未复制共享设置、凭据或会话，也未启动副本。

本轮 `node --experimental-transform-types --check` 对源码与单元测试通过，集成脚本语法、参数拒绝检查和 `git diff --check` 通过；最终独立复核未发现具体 transaction 阻断项。定向 Vitest 32 项、类型检查、目标 Oxlint、双语配对、正式打包和 packaged 隔离验收均通过。`test:docs` 和仓库级导出 JSDoc/Markdown wrap 检查仍受第 60–62 行记录的全仓问题影响，不宣称文档 aggregate 全绿。

## 剩余验收

1. 处理上面的全仓文档失败，保持草稿 PR 状态，直到需要的审查与 CI 证据齐备。
2. 补齐 1680×1000、1280×800、768×1024、390×844、320px 回流、200% 缩放、明暗主题及中英文组合矩阵；已有部分场景不代表完整矩阵完成。
3. 在可操作原生目录选择器的环境中验证打包应用终端命令，并补充安装器交互、跨版本升级、EV 签名和真实更新服务验收。
4. 获得真实 API 凭据后录制提交对应的真实服务器/模型回合 GUI GIF。当前无 `DEEPSEEK_API_KEY` 或常规凭据文件，未生成此证据。

已知实现限制：路径检查不能阻止另一个进程替换目录。创建结果未知时任务尚未发布，需按诊断检查分配；发布前硬崩溃没有持久化创建日志自动恢复。Cleanup 收据不证明创建过程具有相同恢复保证。[Worktree 生命周期提案](../notes/proposed/feature/2026-09-18-worktree-task-lifecycle-hooks.md)在完整验收确认前仍保留 proposed。
