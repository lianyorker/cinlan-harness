# Cinlan 独立功能菜单集成包

本次在官方 `dsh-v0.1.6-alpha.2` 选择性集成基础上落实按功能导航：移除“侧边卡片”汇总入口，新增工作区布局、文件、任务管理和侧边对话；Git、浏览器、终端功能设置归入各自原有页面。文件预览格式归于文件页面，插件提供的可见功能各有独立入口。

这是当前 Cinlan 产品结构的实现。Linear.app 记录为后续视觉方向，本次继续使用当前主题、280px 导航、64px 顶栏和原生 Settings 控件；现有功能面板、传输方式及持久化键保持兼容。

## 功能与行为

| 功能 | 设置入口 | 归属 |
|---|---|---|
| 面板布局 | 工作区布局 | 个人偏好 |
| 文件与预览 | 文件 | 工具与设备 |
| 子代理与后台任务面板 | 任务管理 | AI 与模型 |
| 辅助对话 | 侧边对话(beta) | AI 与模型 |
| Git 与 Diff | Git 与源代码控制 | 开发工作流 |
| 浏览器 | 浏览器 | 保留原生页面 |
| 终端 | 终端 | 保留原有实验分组 |

功能关闭后设置入口保留，允许再次启用；已打开页签与 Host 工具的可用性仍由各自机制管理。插件卸载会移除对应菜单、图标和搜索项，文件预览插件的配置也会随生命周期同步。

原生 Git/浏览器/终端表单保持其保存语义。面板偏好写入改为一次原子 mutation，Host 返回拒绝时显示本地化错误，即使恢复读取得到与请求相同的值也不宣称成功。拒绝后的页面显示 controller 恢复的权威值，避免旧页面状态覆盖最新 Host 值；有后续排队写入时保留其即时显示值。该路径以真实 controller + 组件测试验证，修复前失败、修复后通过。保存键未迁移，旧设置继续读取。

## 已验证

- Settings 外壳、搜索元数据、Git/浏览器/终端原生设置：6 个文件、72 项通过；新增扩展槽所有权/搜索聚焦回归所在文件 26 项通过（与前者有重叠）。
- 功能页、注册生命周期和原子写入：3 个文件、24 项通过；最后的拒绝恢复修复覆盖 2 个文件、24 项通过（包含新增回归，与前组重叠）；输入设置行另有 7 项通过。
- 实际浏览器：原有设置/模型/插件/引导 45 项通过；新的功能菜单、搜索、关闭后恢复和窄屏检查 1 项通过，录制的期望快照再回放通过。
- Host 类型检查、完整 Client 构建、修改范围 Oxlint、Client 目录新鲜度与类型镜像通过；5 组文档双语配对和本轮相对链接通过。
- 检视了固定 1680×1000 的文件/任务页面与 390×844 任务页截图。菜单变化符合本次要求，现有颜色、导航宽度与顶栏高度保留，窄屏没有横向溢出。

证据：`.artifacts/feature-navigation/verification.json`，截图位于 `.artifacts/settings-feature-navigation/`。源码记录见 [设计决策](../design/cinlan-feature-navigation.md)。

## Windows 交付

完整 `pnpm run package:desktop:win:x64` 退出码为 0（job `pwsh-260`）。804 个生产依赖从新建 store 成功完成离线重装验证，随后 NSIS/MSI 均生成成功。包内 Node `24.17.0`、pnpm `11.7.0`、Electron `44.0.0`。

产物目录：`apps/desktop/.desktop-build/targets/win-x64/artifacts/`。

| 文件 | 字节数 | SHA256 |
|---|---:|---|
| `deepseek-harness-0.1.5-alpha.1-win-x64.exe` | 265904205 | `a1a39f12b7df0e03db204ac85b3dbad89bfbbf437c3fec929c778077c10b9d76` |
| `deepseek-harness-0.1.5-alpha.1-win-x64.msi` | 287537448 | `7049714175f8346a6a50971b19d9a419a9c9ca378beb50f474608758554358ad` |

同目录 `SHA256SUMS.txt` 包含全部校验值，机器可读信息位于 `.artifacts/feature-navigation/artifacts.json`。产物沿用产品版本 `0.1.5-alpha.1`，包含选择性迁入的官方 `v0.1.6-alpha.2` 改进及本次功能菜单调整。

成品测试：`node apps/desktop/tests/settings.integration.mjs --packaged (Resolve-Path 'apps/desktop/.desktop-build/targets/win-x64/artifacts/win-unpacked/DeepSeek Harness.exe').Path`，job `pwsh-268` 退出码为 0。报告 `.artifacts/desktop-settings-2WO6Yy/report.json` 的 `passed` 为 `true`；已检查打包 ASAR/捆绑运行时来源、独立 DSH_HOME/浏览器目录、离线首次安装、中文布局、语言与搜索、Git/终端设置、独立菜单和任务开关、完整进程重启后的全文件持久化，以及进程退出/调试端口清理。成品任务页截图已检视，报告同目录保留其他页面截图。

两个安装程序实测为未签名（`NotSigned`），未提交、推送或发布。验收运行同次构建的包内应用，未运行安装/卸载向导。最终完整构建包含最后的拒绝恢复修复；旧中间构建 job `pwsh-252` 在交付前停止，不能作为最终证据。

前一轮安装包哈希和截图属于导航调整之前的验收，保存在 [前一轮交付记录](upstream-0.1.6-alpha.2-windows-package.md)，不得当作本次成品验收证据。全仓既存 lint/docs、SDK Windows 回放差异仍按 [迁移报告](upstream-0.1.6-alpha.2.md) 记录；本次未声称全仓检查通过。
