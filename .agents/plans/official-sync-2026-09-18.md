# 官方同步与 Desktop 启动验收

## 来源和保留范围

官方来源为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，本轮固定到 `master` 的 `ddefc45fbc7f8e46dd73185e68295696d1297887`（`0.1.6-alpha.2`）。本地分支为 `fix/settings-native-acceptance`，同步起点为 `59f7facff8cfd9ca71f5cf4c574837d285e96c1b`。共同祖先为 `5dda764ed3aa172535a7967b06ff95d9cbfe536a`，官方有 1970 个本地未包含的提交；采用逐项适配，不能将结果称为已全量合并官方版本。

用户要求保留当前设置风格。视觉基准为[已接受的设置 HTML](../../reports/settings-native-preview.html) 和本地前次打包验收 `.artifacts/desktop-settings-edjRk1/settings-zh.png`（1264×775）。本轮不替换设置组件或其样式，启动页继承当前产品的主题和字体。基准 HTML SHA-256 为 `35BBCB0D0D818E8CE56E523BC0B9DBE3717FCBA2D03D05DDEE468BDA84095C32`；起点的 `ui-settings/src/client`、`ui-settings-general/src/client`、`ui-better-sidebar/src/client` Git tree 分别为 `3ac8d33f1685e862488ab657ac2d7b60edbf522c`、`3d5d6f4e173dd04b61a2c65db21dd701ce102d4b`、`5f9a1e4eb4779867bebbc172e567b1b8c0c074cc`。

会话开始时待提交的设计技能更新已作为 `2ac3a5da29` 提交并通过 `http://127.0.0.1:7890` 代理推送。后续实现分为 Windows 修复 `f838871172`、CI/SSH 夹具修复 `5b37af0c2c`、可见启动与菜单 `7550fbf964`。生成的 `apps/desktop/coverage-floating/` 未加入提交。

## 选定内容

| 内容 | 官方来源 | 本地适配范围 |
|---|---|---|
| 后端就绪前先显示本地页面 | [4feb87da34](https://github.com/deepseek-ai/deepseek-harness/commit/4feb87da34c74a1e799b707472bbbb4606f4ab0d) | 参考启动顺序，保留现有自定义协议与 profile 事务；启动页显示真实初始化阶段，耗时 profile 准备放入 worker |
| 系统编辑与 macOS 窗口菜单 | [380994942d](https://github.com/deepseek-ai/deepseek-harness/commit/380994942d4fe0018c90cf45776095b07c72f681)、[b9fde8d063](https://github.com/deepseek-ai/deepseek-harness/commit/b9fde8d0639f85ddd5c3c76e715bddf0b3b26eb4) | 仅适配 Electron 原生菜单角色，保留本地设置 UI |
| Windows 后台命令不闪控制台 | [f8b1309fe5](https://github.com/deepseek-ai/deepseek-harness/commit/f8b1309fe55ad29d54451886049d0c541be94d5a) | runner 的 `windowsHide` 与共享 Win32 启动结构的 `STARTF_USESHOWWINDOW` / `SW_HIDE`；保留 Job、控制台继承和标准流 |
| 修复 CI 可选构建策略 | 本地修复，无对应官方提交 | 将 `cpu-features` 和 `ssh2` 的占位字符串改为 `false`；SSH2 的可选原生加速缺失时使用已有可移植实现 |

未选择官方 Electron HTTP/认证架构重写、共享插件管理界面替换、依赖原地 profile 模式的恢复代码和 Session 格式迁移。官方 Windows drive-relative 修复针对的缺陷在本地实现中不存在。Node 26 ZIP 提取适配保留为后续独立候选。应用版本不因这次选择性移植而宣称升级为官方完整 `0.1.6-alpha.2`。

## 验证记录

- 初次文档更新：15 个文件经独立审查；66 个 Markdown 链接/锚点、CSS 解析与变量引用检查通过。按下输入框占位文字的对比度问题已修复，浅色为 8.40:1，暗色为 6.97:1。
- `pnpm run verify-skill-invocation-metadata` 通过；该技能没有跨产品元数据配对，命令报告 0 对。
- `pnpm run doc-sync`：21 通过、13 失败；失败包括已有文档代码块、生成目录、双语配对、导出 JSDoc 和 README 规范，日志为 `.artifacts/official-sync-initial-doc-sync.log`。不能宣称文档全库通过。
- 修改可选构建策略后，`pnpm install --frozen-lockfile` 退出码 0，lockfile 未重新解析，日志为 `.artifacts/official-sync-frozen-install.log`。
- SSH 真实组合回归首次为 19/20 通过，一项在夹具密钥生成期间失败。已确认 `ssh2@1.17.0` 的 Ed25519 生成器错误地移除公钥开头的零字节；夹具改用 P-256 后 20/20 通过，认证拒绝、主机密钥拒绝、取消、连接丢失和清理仍通过真实 OpenSSH 客户端验证。日志为 `.artifacts/official-sync-ssh-tests.log` 与 `.artifacts/official-sync-ssh-tests-fixed.log`。
- Windows 修复：9 个相关套件共 90 项通过，涵盖全部改动单测、5 项真实 Win32 进程测试和 14 项真实 ACL runner 测试。新控制台用例在修复前观察到 `{attached:true,visible:true}` 并失败，修复后观察到 `{attached:true,visible:false}` 并通过。加入相邻 `spawn-runner.spec.ts` 的组合结果为 119 通过、2 失败、1 跳过；两个失败来自未改动的 symlink 夹具创建 `EPERM`。MSVC x64 ABI 探针、两个所属包的 no-emit 类型检查和 16 文件定向 lint 通过。已收集输出的转录记录（非原始 stdout）为 `.artifacts/official-sync-win32-checks.txt`。
- Desktop 修复：11 个相关测试文件共 70 个唯一用例均有最终相关通过结果，涵盖先显示后准备、取消和延迟完成、失败诊断、原生菜单、locale、Host 启停、同版本事务，以及清理重试期间继续持有锁与 staging。Desktop 类型检查、构建、定向 lint、独立 preload 与生产 eval-worker smoke 均通过。独立审查发现的探测 Host 清理问题已修复并经复核关闭。
- 开发模式 Electron 验收通过，报告 `.artifacts/desktop-settings-Ji5rc6/report.json`。实际验证了可见标题、状态和退出按钮，以及中文/英文设置布局、搜索、焦点恢复和语言持久化；退出码 0、调试端口关闭、临时根目录清理。首次脚本尝试在启动页导航到应用时遇到 CDP execution-context 销毁，修正该导航观察竞态后通过，不计为应用启动失败。
- 启动页浅色/暗色、键盘焦点、减少动效和 390px 回流的 Chromium fixture 证据保存在 `.artifacts/official-sync-startup-visual/`；已查看截图。它属于页面渲染证据，不替代打包应用或真实模型 GIF。
- 最终一次全库 `doc-sync` 仍为 21 通过、13 失败，与初次结果一致，没有 Desktop 或本轮 Windows 端口的新发现；日志为 `.artifacts/official-sync-final-doc-sync.log`。本轮六组修改/新增双语文档均通过定向配对；后续 Desktop 清理说明改动又在提交 hook 中通过配对。全库 Client UI locale 检查只报告 `ComputerObservations.tsx` 的五个已有标题键问题。仓库文档与全库 UI locale 不宣称全绿。
- 正式打包完成 Host 构建后执行全仓 `pnpm run lint:contracts-ready`：4231 文件、90 规则，3 警告、2090 错误。日志 `.artifacts/official-sync-full-lint.log` 中的文件定位与本轮改动范围交叉检查，无本轮新增/修改 TypeScript 文件的发现；示例包括未改动的 sidebar、workspace 与旧 Desktop 打包测试。该结果不算通过，也不替代本轮定向 lint 的通过记录。
- `pnpm run package:desktop:win:x64` 从 `7550fbf964` 的实现构建并退出 0，完成记录时间为 `2026-09-18T14:56:59.6824373Z`。配置/依赖预检、Host/Client/Web/native 构建、离线 seed 验证、ASAR、MSI、NSIS 和外部 blockmap 均完成，日志为 `.artifacts/official-sync-package-win-x64.log`。最终 ASAR 的主入口、worker、两个 preload 和三个启动页资源共 7 个文件逐字节匹配当前构建/源码；worker 仅使用 Node 内置 require，preload 独立捆绑，记录为 `.artifacts/official-sync-asar-source.json`。
- 环境及仓库根目录没有可用的 `DEEPSEEK_API_KEY` 或 `.env`。本轮 GUI 验收使用隔离且无密钥的真实 Electron 应用；不能据此宣称已完成要求真实模型轮次的 PR 演示 GIF。

## 本轮产物和真实应用验收

产物位于 `apps/desktop/.desktop-build/targets/win-x64/artifacts/`，Electron 为 44.0.0，随包 Node 为 24.17.0、pnpm 为 11.7.0，应用与 seed 版本均为 `0.1.5-alpha.1`。EXE 与 MSI 的 Authenticode 状态均为 `NotSigned`；本地验证不代表发布签名或安装器交互已验收。

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| `deepseek-harness-0.1.5-alpha.1-win-x64.exe` | 265,330,681 | `1af8fb09da39411e723252e9ac75e2007624489b966170f8ea9d042fa752e604` |
| `deepseek-harness-0.1.5-alpha.1-win-x64.msi` | 287,004,568 | `55cc644ed9ee33c6a58129c162216fb3a764a1458db1479cbc221e8442e3c641` |
| EXE 外部 blockmap | 277,366 | `58e03c100a358ba63f309effb869cbeac07e8165dc145d60de09d177632a3142` |
| `win-unpacked/resources/app.asar` | 2,746,038 | `d4c3875b9d67515e2ecbdb4a73f01e07300256da2c740b606e41602134cba161` |

首次安装模式 `node apps/desktop/tests/settings.integration.mjs --packaged '<win-unpacked>/DeepSeek Harness.exe'` 已通过，报告为 `.artifacts/desktop-settings-SnwyXp/report.json`。本机实际观测到启动页在 379ms 出现，后台准备完毕后 137,364ms 进入应用；相同 profile 重启时启动页在 465ms 出现，5,425ms 进入应用。数值包括调试和测试开销，是单次观测而非启动性能保证。中文/英文布局、搜索、焦点恢复、Git 与终端偏好保存及完整进程重启后的持久化均通过；两次退出码为 0、调试端口关闭、临时根目录已清理。

已打开本轮 `startup-1.png`、`settings-zh.png` 并与前次 1264×775 设置截图比较；280px 导航、64px 工具栏及原有字段布局保持。三个设置/侧栏 Client 源码 tree 与接受的 HTML 哈希再次验证均未变化。

旧同版本替换模式 `--existing-profile '<detached old profile>'` 已通过，报告为 `.artifacts/desktop-settings-gykt1y/report.json`。旧 UI 被新 seed 替换，rollback 与共享设置/Session 目录 sentinel 保留，源快照未改变；内容相同重启复用 profile。启动页/应用分别在 474ms / 148,579ms 观测到，重启为 496ms / 5,740ms。归档提取期间 1116 次生产 preload 状态请求的最慢观测为 4ms，安装期间 147 次也为 4ms，说明耗时准备期间主进程仍能回复；这些是局部观测，不是通用性能上限。

无效 profile 模式 `--fail-profile` 已通过，报告为 `.artifacts/desktop-settings-lJdLXT/report.json`。只在隔离 home 写入 `BAD_JSON!`，断言错误确实来自该内容，页面持续显示诊断路径与重启/退出按钮；点击退出后进程返回 0，锁已释放、原 fixture 和共享设置不变，临时根目录已删除。实际错误页截图已打开检查。测试验证重启按钮显示和安全状态；没有点击重启来修复刻意损坏的 fixture。

安装中退出模式 `--close-during-startup` 已通过，报告为 `.artifacts/desktop-settings-wfWO4F/report.json`。观察真实 `installing` 阶段且事务锁 owner 是独立 pnpm PID 后点击退出；安装进程实际退出后 Electron 返回 0。锁、日志、staging 已清理，尚未激活新 profile，共享设置字节未变，调试端口关闭，临时根目录已清理。该运行从点击前确认安装到退出约 39.5 秒，验证的是安全等待而不是立即强杀。旧 profile 取消保留由事务测试覆盖，本次真实取消运行使用首次安装 fixture。

四种 packaged 模式全部通过；它们没有修改当前安装版 Desktop。安装器交互、EV 签名、真实更新服务上传、跨版本升级、完整 viewport/theme/zoom 矩阵和 macOS 运行时仍未验收。没有把六次真实打包应用启动或静态页面 fixture 当作真实模型会话证据。

所有运行验收使用临时 `DSH_HOME` 和独立 Electron user-data；不停止当前安装版 Desktop，不修改现有设置、凭据或会话。前次安装包的结果不作为本轮新代码的打包证据。
