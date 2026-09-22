# Agent Note: Desktop 包含启动所需的 peer 依赖

Status: implemented

[English](2026-09-22-desktop-boot-peer-dependencies.md) | 中文

## 问题

Electron 开发目录通过 workspace link 解析 Cordis 包，但打包后的 Desktop 只收集生产依赖。`dsh-app-boot` 在运行时导入 Cordis 及其必需的 Loader、Include、Group、home、launch-environment 和 system-prompt peer，因此这些 peer 不在 Desktop 生产清单中时，应用会在启动前失败。`dsh-workspace` 和 `dsh-execution-binding` 的 release tarball 还包含由 tsdown 生成、并由 `lib/index.js` 导入的顶层 chunk；排除这些 chunk 会使离线安装后的应用同样启动失败。

## 决策

`apps/desktop/package.json` 在 `dependencies` 中声明 `@deepseek-ai/dsh-app-boot` 的每个非可选运行时 peer。包选择测试覆盖完整的直接依赖集合，并拒绝缺少任一成员的清单。包含生成顶层 chunk 的两个包在发布文件中加入 `lib/*.js`，确保 `pnpm pack` 保留每个相对运行时导入。

## Alternatives considered

**将启动包打进 Electron 主进程 bundle：** 不采用，因为 Desktop 保持共享启动包作为独立运行时包解析，而包准备流程已经负责其生产依赖闭包。

**依赖传递的 peer 安装：** 不采用，因为 electron-builder 接收的是 Desktop 包的生产依赖选择；入口应用必须拥有运行时需要的包。

**逐个列出生成的 chunk 名称：** 不采用，因为 tsdown 的内容哈希会随构建变化；发布文件规则必须匹配所有顶层 JavaScript chunk，不能依赖生成名称。

## 后果

Desktop release preparation 现在会将 `@deepseek-ai/cordis` 和启动所需的 peer 放入暂存安装，因此打包后的 Electron 主进程可以解析 `dsh-app-boot`，不再依赖仅存在于 workspace 的 link。workspace 和 execution-binding tarball 会保留生成的 chunk，因此离线 profile 可以导入其入口。manifest 的直接依赖列表变长，但运行时契约变得明确，现有依赖选择校验也能发现后续遗漏。
