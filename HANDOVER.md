# M1-M2 实现交接文档

## 当前状态

最后验证日期：2026-10-13。TypeScript 编译阻塞已解决，完整构建成功，Web 已启动并通过 Chromium 冒烟验证。

- 保留 `strict`、`exactOptionalPropertyTypes` 和 `noImplicitOverride`，没有使用 `@ts-ignore`。
- 完整 `dev:web` 构建生成了 395 个 Client artifacts；Host、Client、Mobile 编译及 Desktop、Mobile、Web 打包通过。
- Web 地址为 `http://127.0.0.1:3080`；浏览器验证 HTTP 200、应用主界面和 Settings 可见、`pageerror` 为空。
- 误写的根目录 `cinlan_harness/`、对应 `tests/*.py`、`examples/` 和 `requirements.txt` 已删除。保留原有 `python/` SDK/runtime，恢复根 README 的 TypeScript 启动说明。

## 修复范围

### M1 配置

[loader.ts](apps/desktop/src/harness/config/loader.ts) 在 JSON 输入处以 `unknown` 接收数据，递归处理字符串、对象和数组中的环境变量，避免将嵌套值错误地视为顶层 `PartialHarnessConfig`。

[merger.ts](apps/desktop/src/harness/config/merger.ts) 接受完整默认配置与嵌套部分覆盖；递归合并不再使用 `any`，数组替换，源对象不被写入。

### M2 日志

[logger.ts](apps/desktop/src/harness/logging/logger.ts) 使用 pino 自身的 `child()` 继承上下文和输出流，修复原来访问不存在的 `contextData` 导致的异常。JSON 和 pretty 输出都遵循 `destination`，并创建缺失的日志目录。

### 其他编译与构建阻塞

- `welcome-api.ts` 的未使用参数更名为 `_authentication`，保留工作区原有的跳过 welcome 行为。
- 修复 mobile、voice、目录选择器、归档会话等测试夹具的参数、字段和类型声明；未改变这些功能的产品行为。
- Host TypeScript 项目纳入远程隧道测试实际使用的 Mobile transport 源文件。
- 删除空的迁移残留目录 `packages/plugin-remote-tunnel/src`；该目录被 tsdown workspace glob 错认成包，导致在根目录寻找入口文件。
- 用现有锁文件修复 Mobile/Web 的缺失依赖链接，没有新增依赖或升级版本：

```sh
pnpm install --filter @cinlan/mobile-companion... --frozen-lockfile
pnpm install --filter @deepseek-ai/dsh-web-frontend... --frozen-lockfile
```

## 实际集成范围

[Desktop main.ts](apps/desktop/src/main.ts) 初始化这批本地配置、日志、内存会话和工具注册表。会话和工具实例目前仅用于初始化计数，没有接入 Web Host 的 Cordis 服务或真实会话、工具执行链路。

Web 启动验证不能证明这批 Desktop 局部模块已完成跨端集成。本轮没有启动 Electron 窗口，也没有调用真实 LLM API。会话创建、上下文更新、删除和工具注册、执行、缺失工具处理已做直接模块冒烟；日志通过真实子进程和文件输出测试。

## 验证记录

以下定向测试共 73 项通过：

```sh
pnpm exec vitest run apps/desktop/tests/harness-config.spec.ts
pnpm exec vitest run apps/desktop/tests/harness-logging.spec.ts
pnpm exec vitest run packages/bundle/cinlan-remote-tunnel/tests/host.spec.ts packages/bundle/security-research/tests/built-in-preset.spec.ts packages/mobile-device/mobile-device/tests/mobile-device.spec.ts
pnpm exec vitest run packages/client/ui-directory-picker-browse/tests/client-flow.client.spec.tsx packages/client/ui-directory-picker-native/tests/client-flow.client.spec.tsx packages/client/ui-settings-security/tests/apply.client.spec.ts packages/client/ui-settings-unarchive-sessions/tests/components.client.spec.tsx
```

配置 7 项、日志 2 项、Host 相关 16 项、Client 相关 48 项。M1 配置、M2 日志及新增测试的定向 lint 通过；修改范围的 `git diff --check` 通过；根 README 和 Desktop README 的中英文配对检查通过。

完整构建通过后，实际成功启动 Web 的命令为：

```sh
pnpm run dev:web --skip-build --patch apps/web/tests/pin-browse-picker.overlay.yml --no-open
```

`--skip-build` 仅复用本轮成功的完整构建产物。需要重新完整构建时去掉该参数；保持 launcher 参数 `--patch` 位于 Web 参数 `--no-open` 之前，否则后面的 `--patch` 会被转交 Web 参数解析器并报错。

## Web 服务闭环（2026-10-13）

- 默认 Web composition 补齐 `ui-better-sidebar`，为 `sidebar-terminal-controller` 提供 `sidebarTerminals`。
- 停止旧 Web 进程后，将 2026-10-09 留下的零字节 `active.json.lock` 备份到 Temp 并移出资源目录；原有 22 个 skills、generation 和 revision 保留。通用锁实现继续拒绝自动接管未知持有者。
- 侧栏通过 `retainedBy.mainView` 获取主会话，修复旧 `sessions.list.current` 导致终端按钮始终不可用；移除过时 chain slot 注册，保留标准 Deliverables 与文件打开拦截。
- Client 定向测试 9 项通过，Client TypeScript 编译、tsdown 打包和两组 README 中英文配对检查通过。
- 新增 `apps/web/tests/service-activation.e2e.ts`：真实 Loader + Chromium 新建安全研究会话、启动原生终端、命令写文件通过。测试 Mobile listener 使用随机端口，避免与开发实例的 3081 冲突。
- 浏览器回归确认 `session/create` 返回 `ok: true` 和 `agentPreset: security-research`；新增测试纳入 `tsconfig.host.json`，`pnpm exec tsc -p tsconfig.host.json --pretty false` 通过。
- 实际用户目录验证：四个插件均为 active，资源状态 installed（22 skills），`session/create` 返回 `ok: true` 与 `security-research`，终端输出文件内容为 `terminal-verified`，pageErrors 为空。证据见 `reports/m1m2-closed-loop.json` 与 `reports/m1m2-current.png`。
- Web 运行于 `http://127.0.0.1:3080`，启动命令为 `pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml --no-open`。刷新已有浏览器页面即可加载修复。

## 安全研究开场与执行器文案（2026-10-13）

- 安全研究 persona 使用 `执行器` 身份，任务开场固定为 `安全研究启动`；加载技能指定其他身份或问候语时仍遵循预设。
- 产品安全技能资源中的旧中文角色名、旧通道名与英文问候语已替换；skill ID 和脚本路径保持不变。核心接口的 `short_description` 与 `default_prompt` 均为 `安全研究执行器。什么活都做。`。
- 通过现有资源安装接口发布新 generation，未手工改写旧 generation；当前版本为 `1-312ed8549fea487d`，包含当前源码中的 169 个技能入口。
- Web 已重启；运行检查确认 activePreset 为 true，已安装技能文案匹配。证据见 `reports/security-opening-check.json`。
- 定向预设与模型可见测试、浏览器回归、Host TypeScript 检查、README 中英文配对与差异检查通过。浏览器回归保存预设提示词快照，并验证创建安全研究会话与原生终端命令写文件。未重新调用真实 LLM；复测应使用新会话，避免旧会话历史里的文案继续影响输出。

## 仍需处理

## 安全研究启动与工作区命令（2026-10-13）

- 根因：安全研究 profile 启用了 assessment-scope-tool-policy，但默认 grant 的 executionHostIds、targets、actions 都为空，普通 shell 命令也被 ASSESSMENT_HOST_OUT_OF_SCOPE 拒绝。
- 预设启动仅确认，普通问答、解释和通用代码无需样本文件；实际分析依赖无法发现的对象时才询问目标。
- 策略新增 workspaceCommands，默认空列表，安全研究组合显式配置精确命令例外。允许 pwd、平台目录命令、pnpm --version、pnpm run typecheck/build/test；追加参数、复合命令、工作区外目录、权限覆盖与显式后台执行不适用例外。实际评估检查与下游 sandbox 保留。
- 实际 Web 工具执行链回归通过：策略 active，安全研究会话中的 pwd 返回工作区路径，pwd; whoami 被 ASSESSMENT_HOST_OUT_OF_SCOPE 拒绝；侧栏终端写文件通过。不是只测试原生终端。
- 定向单元测试 10 项通过；Host TypeScript 检查、定向 lint、Web persona 快照复验、配置目录生成检查和三组中英文文档配对检查通过。
- 本项目 Web 实例已重启，地址 http://127.0.0.1:3080；运行检查确认策略 active、预设包含新规则，pageErrors 为空。证据见 reports/security-workspace-runtime-check.json 与 apps/web/tests/expected/service-activation/research-persona.txt。
- 未调用真实 LLM provider，不能据此宣称模型实际回复已复测。Web 测试夹具仍有 mcp-management 缺少 profile 及依赖 Consumer pending 告警；未在本任务范围内修复。没有关闭全部授权守卫，也没有安装用户提供的 ZIP 绕过组件。

## 其他待处理项

## M3 定向闭环验证（2026-10-13）

- 新增 Desktop 本地会话、工具与真实文件子进程集成测试；修复 idle/error 状态被记录为 completed、恢复被记录为 started 的问题，保留 Promise API。
- 新增 apps/web/tests/harness-closed-loop.e2e.ts：Chromium 提交 → 确定性模型适配器发起平台 pwd → 真实 shell → 工具结果进入第二次模型请求 → 回复显示 → 读取落盘 Session 验证结果与 turn/end，测试通过。
- 本地模块测试 14 项、Agent 工具调用测试 24 项、Desktop Host 子进程 IPC 测试 21 项通过；Host TypeScript、Desktop 编译、定向 lint 和三组文档配对检查通过。
- 文档与可运行示例见 apps/desktop/src/harness/README.zh.md 和其链接的 fixture；详细结果见 reports/m3-validation.md。
- M3 未宣称全部完成：真实 provider、Electron 窗口 UI/IPC 尚未验证；本地模块与 Cordis Host 未连接。旧 Web 回放因平台、品牌/技能目录和搜索控件漂移失败，保留记录，未刷新历史快照掩盖。

## 其他待处理项（续）

- 全库 `test:docs` 和 `doc-sync` 未通过，包含历史文档链接、配对、格式、生成内容与 API 文档等问题；本轮没有进行全库文档整治。
- 后续业务集成需确定本地 M1-M2 模块与现有 Cordis 配置、Session、Tools 服务的关系，不能把启动时创建局部对象当作完整集成。

## 本轮日志

日志位于 `C:/Users/ASUS/AppData/Local/Temp/`，文件前缀为 `cinlan-m1m2-`：

- `dev-web-20261013.log`：完整构建成功记录及首次参数顺序错误。
- `dev-web-runtime-20261013.log`：最终 Web 运行与插件告警；包含本机启动认证 URL，不应提交或对外粘贴原文。
- `build-mobile-20261013.log`、`build-web-20261013.log`：独立产物验证。
- `test-docs-20261013.log`、`doc-sync-20261013.log`：全库文档检查失败详情。
