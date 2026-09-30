# Cinlan Harness (星澜 Harness)

[English](README.md) | 中文

Cinlan Harness（`clh`，星澜 Harness）是由星澜团队二开维护的开源智能体框架，源自 DeepSeek Harness 生态并进行深度隔离改造。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，具备完整的命名空间隔离、双命令平滑兼容与独立配置运行环境。

文档：[https://github.com/lianyorker/cinlan-harness](https://github.com/lianyorker/cinlan-harness)

## 开发者预览

Cinlan Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

## 核心特性与隔离机制

- **双命令 CLI 体系**：主命令为 `clh`（全称 `cinlan-harness`），并对 `dsh` 命令保持完整平滑向下兼容。
- **用户主目录完全隔离**：默认使用用户主目录 `~/.clh`，缓存与日志位于 `~/.clh/cache`，杜绝与原版配置冲突。
- **层级化环境变量**：支持按 `CLH_HOME` -> `CINLAN_HARNESS_HOME` -> `DSH_HOME` -> `~/.clh` 优先级自动加载。
- **进程与资源隔离**：临时文件、PID 进程锁、IPC Socket 管道均采用 `clh-` / `clh_` 独立命名空间。

<a id="run"></a>

## 运行

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/lianyorker/cinlan-harness.git
cd cinlan-harness
pnpm install
pnpm run build
pnpm clh web
```

`pnpm run build` 会准备仓库产物。`pnpm clh web` 默认会在 `http://127.0.0.1:3080` 启动 Web UI，并在本机默认浏览器中自动打开。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

### CLI 命令行指令

`clh` 启动器支持的常用指令：

```sh
# Boot Web UI
pnpm clh web

# Run a headless agent task
pnpm clh headless "task description"

# Interactive TUI mode
pnpm clh tui

# Profile options and flags
pnpm clh --help
```

## 社区与支持

- 通过 [GitHub Issues 与 Discussions](https://github.com/lianyorker/cinlan-harness/issues) 提交反馈或 bug 报告。
- 欢迎在 [GitHub](https://github.com/lianyorker/cinlan-harness) 关注与 Star 本项目。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
