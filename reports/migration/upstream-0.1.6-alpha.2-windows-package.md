# Windows x64 官方改进集成包

状态：本记录是独立功能菜单调整之前的官方改进集成验收。原 EXE/MSI 已按本记录 SHA256 归档到 `.artifacts/upstream-0.1.6-alpha.2/packaging/installers/`；同名默认产物由后续构建更新，最新结果见 [独立功能菜单交付记录](cinlan-feature-navigation-windows-package.md)。本轮包内应用的首次安装、设置保存与完整重启验收通过。

源码位于独立工作树 `D:/Company/cinlan/cinlan-harness-upstream-016`，分支 `sync/upstream-dsh-v0.1.6-alpha.2`。官方来源固定为 `dsh-v0.1.6-alpha.2` / `ddefc45fbc7f8e46dd73185e68295696d1297887`，本地基线为 `763766ee8a8b076125b287464e1ef84c4a7f5222`。选择性合并代码保留本地产品版本 `0.1.5-alpha.1`。原工作树未写入，未创建合并提交、推送或发布。

## 本次迁入

- 核心：MCP 循环游标检测、子代理只转发最终文本、已生效沙箱模式不重复申请、Fork 按选定回合结尾截断。
- 模型：可选 Messages 协议、图像输入能力与请求处理、pi-ai 能力兼容；保留现有模型和网关设置。
- 代理：子代理并发默认 8、本地深度默认 3，可通过现有设置控件调整。
- 审阅：回合文件摘要、Diff 和计划卡片，使用现有 better-sidebar 查看全文。
- 管理：Web Plugins 管理页与真实 profile 生命周期；Desktop 继续由原有安装事务管理包，执行层拒绝运行时管理写入。
- 本地适配：Cordis 依赖声明、Host/Client 类型分面、zod 运行依赖、可选侧栏消费和启动期间 patch 监听补偿刷新。

完整提交来源与先前行为验证见 [集成记录](upstream-0.1.6-alpha.2.md)。

## 新一轮官方差异复核

| 官方改进 | 处理 |
|---|---|
| `f8b1309fe5` Windows 子进程隐窗 | 本地已存在，保留 |
| `e0f170b8d0` / `5c369a0a1f` Session 写入占用提示 | Host 与 UI 已接通，保留 |
| `ac2f890291` logger exporter 清理 ID | 已确认是通用清理 bug；本地直接生产调用仅见实验 worker，未证明当前 Desktop 触发。列为下一次 vendor 独立补丁，不纳入此次已验收包 |
| `ae4fc751eb` ContextMeter 弹层限制在视口内 | 独立窄屏体验修正，后续处理 |
| `65648082a3` 长会话标题 hover 展开 | 独立 UI 微调，后续处理 |
| `e5038fcf9e` / `7d9166ea40` Thinking Markdown | 涉及共享 Markdown 样式与快照，后续单独处理 |
| `7f2d7b1791` 官方空会话侧栏 | 本地 better-sidebar 独立挂载，不依赖官方 header；不替换本地侧栏 |

## 构建与安装包

执行 `pnpm run package:desktop:win:x64` 成功。该命令重新构建官方包集合及 Desktop、生成本地 tarball、校验 Node 下载、准备生产依赖种子并证明离线安装，然后调用 electron-builder 的 NSIS/MSI 目标，使用 `--publish never`。

内置运行环境：Node `24.17.0`、pnpm `11.7.0`、Electron `44.0.0`。首次启动安装所需依赖已随种子打包；模型请求等在线功能仍需网络。

产物目录：`apps/desktop/.desktop-build/targets/win-x64/artifacts/`。

| 产物 | 字节数 | SHA256 |
|---|---:|---|
| `deepseek-harness-0.1.5-alpha.1-win-x64.exe` | 265842990 | `f2363a7eab3242579503e06e2f662513f75889d6c2adce052a0fd330874f61e3` |
| `deepseek-harness-0.1.5-alpha.1-win-x64.msi` | 287643944 | `51d8cd697661ea94255d89ff333e31045b22bf1ac5b88124740ce76c122cb520` |

两个安装包为本地未签名构建，更新环境是 test，未发布。未修改 Windows 的安装或签名策略。`win-unpacked/DeepSeek Harness.exe` 与安装包来自同一次构建。

## 成品验收

使用仓库已有命令在独立 DSH_HOME 与 Electron user-data 目录中启动打包应用：

```powershell
node apps/desktop/tests/settings.integration.mjs --packaged (Resolve-Path 'apps/desktop/.desktop-build/targets/win-x64/artifacts/win-unpacked/DeepSeek Harness.exe').Path
```

成品验收退出码为 0，`passed: true`。已验证包内 ASAR、捆绑 Node、从离线 seed 安装的同版本 dsh/Host，280px Settings 导航、64px 顶栏、无横向溢出、中英文搜索与焦点恢复，Git 分支前缀/分组顺序和终端字体的原生保存，以及完整进程重启后的持久化。进程正常退出、调试端口关闭、隔离目录清理均通过。此测试运行安装包同次构建的 packaged 应用；未运行安装/卸载向导。

成品报告与截图位于 `.artifacts/desktop-settings-UCyHch/`。本次 `settings-zh.png` 与原工作树历史成品 `.artifacts/desktop-settings-IXHG5N/settings-zh.png` 的文件 SHA256 均为 `2e44b7e89de4329ba7854fe08dc80dc16e3fad74cd8e23bf7d91bf3704bc5db4`，该固定验收场景的中文设置页面像素一致。该比较不代表所有新增功能页面都有像素基线。

构建日志、源码清单、安装包哈希和成品验收日志保存在 `.artifacts/upstream-0.1.6-alpha.2/packaging/`。全仓基线 lint/doc 检查、Windows Bash/Pwsh 回放差异和未执行的真实 API 测试仍以集成记录为准；安装包构建通过不代表这些项目全部通过。
