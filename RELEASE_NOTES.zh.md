# Cinlan Harness (星澜 Harness) v0.2.0-rc.1 发布说明

我们非常高兴地宣布 **Cinlan Harness (`clh`)**（星澜 Harness）首个预览版本的正式发布。本项目基于 DeepSeek Harness 开源智能体生态进行深度隔离改造与品牌重塑，旨在提供环境独立、无交叉污染、开箱即用的现代化 Agent 研发运行平台。

- **发布版本**：`v0.2.0-rc.1`
- **发布日期**：2026-09-30
- **开源仓库**：[https://github.com/lianyorker/cinlan-harness](https://github.com/lianyorker/cinlan-harness)

---

## 🌟 核心版本亮点与里程碑

### 1. 全新 CLI 命令矩阵与平滑向下兼容
- **主命令升级**：正式引入 **`clh`**（Cinlan Harness）作为核心启动命令。
- **全称别名支持**：提供 `cinlan-harness` 全称别名，拥有完全一致的参数解析与启动体验。
- **平滑向下兼容**：保留原有 `dsh` 命令别名，确保历史工作流、自动化脚本与原有依赖无需改动即可平滑过渡。
- **便捷脚本配置**：根目录 `package.json` 现已原生支持 `pnpm clh` 与 `pnpm cinlan-harness`。
- **Python SDK 运行时对齐**：`python/sdk-runtime` 入口脚本同步注册 `clh` 与 `cinlan-harness` 命令行接口。

### 2. 用户主目录与缓存/配置完全隔离
为杜绝与官方 `~/.dsh` 运行时环境产生配置串扰、会话冲突或缓存污染：
- **默认用户主目录**：由原 `~/.dsh` 迁移并隔离为 **`~/.clh`**。
- **独立存储空间**：
  - 缓存目录：`~/.clh/cache`
  - Profile 配置文件：`~/.clh/profiles`
  - 会话数据：`~/.clh/sessions`
- **层级化环境变量回退机制**：
  1. `CLH_HOME`
  2. `CINLAN_HARNESS_HOME`
  3. `DSH_HOME`（向下兼容回退）
  4. 默认缺省 `~/.clh`
- **Python SDK 统一**：`deepseek_harness.client` 在子进程启动与路径解析时自动注入并优先采用 `CLH_HOME` / `CINLAN_HARNESS_HOME`。

### 3. 环境变量前缀与运行时临时资源隔离
- **环境变量升级**：关键变量支持升级为 `CLH_*` 前缀（`CLH_HOME`、`CLH_SESSION_ROOT`、`CLH_CORDIS_CONFIG`、`CLH_PERMISSION_MODE`、`CLH_TELEMETRY_MODE` 等），并在底层实现双前缀向前兼容。
- **系统资源隔离**：
  - IPC 通信管道、PID 进程排他锁统一更名为 `clh-` / `clh_` 前缀。
  - 子进程沙箱临时目录全面移至 `clh-*` 独立命名空间。
- **客户端自定义协议**：桌面端跨平台注册了 `clh://` 及 `clh://open` 深度链接协议。

### 4. 星澜官方品牌标识与视觉资产接入
- **Web 端 Favicon**：`apps/web` 与 `website` 全面接入星澜官方星芒矢量 Logo。
- **桌面端多平台图标**：基于官方素材重新渲染生成 Windows / macOS 高清图标套件（`icon.svg`、`icon.png`、`icon.ico`、`tray-windows.ico`）。
- **客户端主界面 Logo**：升级了客户端侧边栏/顶部 Logo 组件（`FishLogo.tsx` / `CinlanLogo`），内嵌星澜高清矢量标识。
- **产品元数据重塑**：各客户端、CLI 界面展示名统一升级为 **Cinlan Harness** / **星澜 Harness**。

### 5. 全仓构建系统与多阶段打包链路打通
- **Typert Remote 契约修正**：彻底修复了在客户端打包阶段由于 oxc-resolver 读取路径别名而误将生成的 Remote 契约解析为 `.d.ts` 进而导致 `[MISSING_EXPORT]` 的问题，重构了运行时 JS 的精确拦截定向与加载。
- **打包纯洁性放行**：将 `dsh-native-command/types`、`dsh-api-workspace-controller/default-workspace` 等无副作用纯折叠模块安全纳入 Client 打包 `INLINE_SAFE` 白名单。
- **全流程质量通过**：全仓 `build:lib:host`、`build:lib:client`、`build:web` 以及顶层 `build`、`typecheck` 均实现 100% 一次性绿灯通过。

---

## 🚀 快速上手指南

### 从源码运行

```sh
# 克隆仓库
git clone https://github.com/lianyorker/cinlan-harness.git
cd cinlan-harness

# 安装依赖（推荐 pnpm 11.7+，Node.js 22.19+ 或 24+）
pnpm install

# 全量构建依赖包产物
pnpm run build

# 启动 Web UI 客户端
pnpm clh web
```

### CLI 常用操作模式

```sh
# 启动 Web UI 服务（默认访问 http://127.0.0.1:3080）
pnpm clh web

# 运行无头模式单次 Agent 任务
pnpm clh headless "重构用户认证模块并补充单测"

# 启动终端交互式 TUI
pnpm clh tui

# 查看命令行帮助与可用 Profile
pnpm clh --help
```

### 桌面客户端本地打包

```sh
# 以开发模式启动桌面端应用
pnpm run dev:desktop

# 打包便携桌面端客户端目录
pnpm run package:desktop:dir
```

---

## 🔒 安全与兼容性说明

Cinlan Harness 当前处于**开发者预览阶段**。项目在底层协议与大模型 API 接入层（包括 DeepSeek 及各类 OpenAI 兼容接口）保持完全兼容，但上层应用与扩展 API 可能会随着架构演进而发生调整。

在执行未知来源的 Agent 任务或沙箱指令前，请务必参阅 [安全说明（中文）](SAFETY.zh.md) / [SAFETY.md](SAFETY.md)。

---

## 💬 社区交流与反馈

- **开源仓库**：[https://github.com/lianyorker/cinlan-harness](https://github.com/lianyorker/cinlan-harness)
- **问题反馈 (Issues)**：[https://github.com/lianyorker/cinlan-harness/issues](https://github.com/lianyorker/cinlan-harness/issues)
- **讨论区 (Discussions)**：[https://github.com/lianyorker/cinlan-harness/discussions](https://github.com/lianyorker/cinlan-harness/discussions)
