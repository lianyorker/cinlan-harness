# 移除设计设置与 Windows 重打包验收

## 范围

实现提交为 `d63274fd64399a1c554b342a275e7c6b64a963ec`，分支为 `fix/settings-native-acceptance`，GitHub PR 为 [#14](https://github.com/lianyorker/cinlan-harness/pull/14)。移除 `ui-settings-security` 中的 Design Studio 导航、页面、搜索字段、组件匹配器与中英文文案，保留安全研究、浏览器、计算机控制和手机模拟器。`cinlan-design` 技能独立于此设置页，未删除。相关包说明、设计参考和所属 Agent Note 已同步。

沿用版本 `0.1.5-alpha.1`。同版本 profile 通过发布内容指纹替换旧包，不以版本号相同推断代码相同。安装包、截图和日志保留在本地，不提交二进制或发布远程更新；用户当前安装版 Desktop、真实设置、凭据和 Session 未被修改。

## 相关检查

- `pnpm exec vitest run packages/client/ui-settings-security/tests packages/client/ui-settings/tests --maxWorkers=2`：11 文件、152 项通过。修正测试中未绑定方法引用后，所属 `apply.client.spec.ts` 的 10 项再次通过。
- `pnpm run build` 通过。最终 Windows 包使用独立的 `package:desktop:win:x64` 正式构建流程。
- 七个相关浏览器文件具有最终通过结果，共 48 项：`settings-chrome` 与 `device-capabilities` 16 项通过，另五个文件修正过时定位器及快照后，refresh 与 replay 均为 32 项通过。初次扩展回放的 14 项失败已经修正，没有删除业务断言、跳过用例或修改归一化器。
- 模型、预设、插件与 onboarding 的快照修正反映当前分组导航、默认模型/推理设置及默认预设控件。定位器明确选择可见预设行按钮和“插件配置”面板中的终端展开按钮，避免隐藏 option 或导航中的同名文字。
- 定向 TypeScript lint 均为零警告、零错误；提交钩子的双语配对、staged lint、空白及 vendor 检查通过，未绕过钩子。
- 三组修改文档的双语配对通过。`DESIGN.md` 配对位于配对工具明示排除的目录范围，按双语事实同步，不创建工具拒绝的 sidecar。
- 本轮 `pnpm run doc-sync` 为 21 通过、13 失败，与前轮结果一致。剩余失败属于文档代码块、生成目录、全库配对/换行、JSDoc、路径、README 和旧 Agent Note 规范；不能宣称全库文档通过。日志为 `.artifacts/remove-design-doc-sync.log`。
- 未生成真实模型 GUI GIF：环境没有可用的普通 API key 配置；本轮证据是无密钥真实应用与 Chromium 回放，PR 保持 draft。

浏览器修正的最终 replay 日志为 `.artifacts/remove-design-browser-9b780eb063ad4f75a4f303bb849c1ef3/replay.log`，同目录保留 refresh 与定位器 lint 日志。

## 构建一致性

首轮 Windows 打包退出 0，首次启动验收 `.artifacts/desktop-settings-YK85M2/report.json` 与独立旧 profile 升级验收 `.artifacts/desktop-settings-Tgw0Vt/report.json` 均通过。全包核验发现并行 `doc-sync` 会重建 Host 与部分静态客户端产物，使 `ui-better-sidebar/lib/client-editor.js` 的 CSS export 属性排列与归档不同。因此这些结果仅作为首轮检查；最终交付重新从固定实现提交串行打包，避免同时运行任何构建命令。

核验脚本对能够映射到工作区 `packages/*/*`、`vendor/*`、`apps/*` 所有者的归档 `lib/`、`dist/` 普通文件，按流计算其 SHA-256 并与当前构建逐文件精确匹配，不归一化差异。它不覆盖 native 包、其他资源、配置或缺失归档条目的完整性；安装器只记录哈希，不解包或运行安装流程。同时验证 capability settings tarball 的大小与 SHA-512，并要求打包、当前构建和实际安装的 capability settings bundle 一致。实际验收报告另外绑定本次可执行文件、ASAR 与 seed integrity 哈希，防止复用旧包报告。

## 最终安装包

`pnpm run package:desktop:win:x64` 从固定实现提交串行构建并退出 0，日志为 `.artifacts/remove-design-package-final-win-x64.log`。最终 EXE 修改时间为 `2026-09-19T00:01:36.851Z`，blockmap 为 `2026-09-19T00:01:47.493Z`。应用与离线 seed 版本均为 `0.1.5-alpha.1`，Electron 为 44.0.0，内置 Node 为 24.17.0、pnpm 为 11.7.0。EXE 与 MSI 的 Authenticode 均为 `NotSigned`。

文件位于 `apps/desktop/.desktop-build/targets/win-x64/artifacts/`：

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| `deepseek-harness-0.1.5-alpha.1-win-x64.exe` | 265,405,357 | `b4186eb6808472283c083de8da77ab2f5c9088fb08a27ca5e55fc5bc8b16d27e` |
| `deepseek-harness-0.1.5-alpha.1-win-x64.msi` | 287,037,336 | `4536a649cf6f9ae9e7028a469bbd552639fb2d477940ecdea6d202be8cbd9f7b` |
| EXE 外部 blockmap | 276,856 | `7f2b8e0077667ceaf7f8035d0095897fae64755c062afb3d60c466c1c4acad30` |
| `win-unpacked/resources/app.asar` | 2,746,038 | `d4c3875b9d67515e2ecbdb4a73f01e07300256da2c740b606e41602134cba161` |

最终映射核验覆盖 329 个包、2,812 个编译文件，全部与当前构建逐文件一致。capability settings bundle 为 169,256 字节，SHA-256 为 `d58d393b61b1ed490bad91dc9ddf94ad8cb95360aaca07f0cc8aa4ff04c66d30`，包内不含 Design 页面或文案。核验 JSON 为 `.artifacts/remove-design-windows-artifacts.json`。

最终实际应用验收 `node apps/desktop/tests/settings.integration.mjs --packaged '<win-unpacked>/DeepSeek Harness.exe'` 退出 0，报告为 `.artifacts/desktop-settings-dshU6L/report.json`。中英文导航均保留四个能力，搜索“设计 / Design / cinlan-studio”均无结果，Browser 搜索正例正常。中文布局、语言持久化、搜索焦点、Git 与终端偏好保存及完整进程重启后的持久化全部通过；两次应用进程均干净退出，调试端口已释放，临时 home 已删除。已查看最终中文设置与英文无结果截图。

本机首次启动页在 603ms 被观察到，175,210ms 进入应用；重启为 450ms / 5,526ms。它们是包含调试器与测试开销的单次观测，不是性能保证。

核验脚本接受最终报告并确认实际安装的 capability settings bundle 与包内及构建结果相同，同时匹配可执行文件、ASAR 和 seed integrity。旧首轮报告作为反例因 seed 哈希不同而被拒绝，日志为 `.artifacts/remove-design-stale-acceptance.log`；最终 seed integrity SHA-256 为 `e64d8ad4fc66a2424b7a629928c0fdb0fd8cb4d50e59f2133c66a06f12d18cfc`。核验完成时间为 `2026-09-19T00:06:17.215Z`。

本轮未运行最终安装器的交互安装流程、生产签名或远程更新发布。首轮旧同版本升级通过，但不把其报告冒认为最终包验收；最终包已独立完成新 profile 的安装、应用检查与完整重启。
