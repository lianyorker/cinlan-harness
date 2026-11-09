# clh / dsh 命名边界

> 状态：权威说明，2026-10-31 定稿。
> 背景：Cinlan Harness（clh）是 DeepSeek Harness（dsh）的 fork，产品已改名；upstream 对齐的官方包保持 upstream 形状，fork 自有包已于 2026-11-08 按发布坐标决策迁到 `@cinlan/*`。本文规定两个世界的分界线，避免新代码在错误的一侧命名。

## 1. 一句话规则

**用户与机器边界上的一切是 `clh`；upstream 对齐的官方包保持 `dsh`，fork 自有包用 `@cinlan`。** 分界判断标准：改了这个名字 upstream sync 会痛，还是用户会看到？

## 2. 边界表

| 类别 | clh 侧（产品面） | dsh 侧（包面 / upstream 对齐面） |
|---|---|---|
| CLI 可执行名 | `clh`（别名 `cinlan-harness`） | `dsh` 仍兼容（`pnpm dsh` 走同一入口） |
| 用户数据根 | `~/.clh`（`CLH_HOME_DIR_NAME`） | `~/.dsh` **永不读、永不写** |
| Home 环境变量 | `CLH_HOME` → `CINLAN_HARNESS_HOME` → `~/.clh` | `DSH_HOME` 仅导出供避开，解析绝不消费 |
| 共享 agent 配置根 | `~/.agents`（其他 agent 工具共用，故意独立） | env 名沿用 upstream：`DSH_AGENTS_HOME`（不改名，见 §4） |
| 进程/socket/IPC | `clh-` / `clh_` 命名空间（socket、PID lock、sandbox 临时目录） | — |
| npm 包名 | — | 官方包保持 `@deepseek-ai/dsh-<name>`；fork 自有包（upstream 没有的目录 + apps/cli、apps/desktop、root）用 `@cinlan/<name>`，**fork 新包也用 `@cinlan`** |
| 服务名 / 事件名 | — | `ctx.<camelCase>` 服务名、`<domain>/<event>` 事件名保持上游语义，不带产品前缀 |
| 构建产物 / 文档 | `clh` 命令、profile、profile 名 | 内部源码标识符以可读性为准，不强制改名 |

## 3. 权威实现点

- Home 解析唯一实现：`packages/util/home-paths/src/index.ts`
  - `resolveClhHome(configured, env)`：configured > `CLH_HOME` > `CINLAN_HARNESS_HOME` > `~/.clh`；空串视为未设。
  - `DSH_HOME_ENV` 导出仅为让调用方**避开**受管命名空间；`resolveClhHome` 绝不读它。
  - `DSH_HOME_DIR_NAME` / `defaultDshHome` / `resolveDshHome` / `dshHomePath` / `dshCachePath` / `dshHomeDisplay` 是 `@deprecated` 上游形状别名，全部转发到 clh 实现——存在目的是 upstream 同步来的调用点能编译，**新代码一律用 clh* 名字**。
- 用户面展示：`clhHomeDisplay` 只输出 `~/.clh` 或 `$CLH_HOME`，永远不泄漏机器绝对路径。
- 共享配置根：`resolveAgentsHome` 独立解析 `~/.agents`，与 CLH home 解耦（用户跨工具共享 skills/agents）。

## 4. 不回退 DSH_HOME 的原因（不可协商）

机器同时装官方 DSH 与 CLH 时，`~/.dsh` 存着官方的 sessions、credentials、缓存。读它意味着 CLH 能看到/清掉官方的用户数据，写它意味着官方会被污染。同理官方也不会读 `~/.clh`。**隔离是产品承诺，不是实现细节**——任何"如果 DSH_HOME 存在就用它"的写法都是 bug。

`~/.agents` 是例外：该根语义上属于"所有 agent 工具的共享配置"，不是 CLH 私有数据，所以沿用 `DSH_AGENTS_HOME` env 名（改了反而让用户多记一个变量），但仍独立于 `resolveClhHome`。

## 5. upstream sync 时的字面量规则

- upstream diff 里出现的 `dsh` 标识符（包名、服务名、`DSH_*` env）**保留**，不逐字改成 clh——改了会扩大 fork 面积、破坏后续 merge。
- upstream 引用 `~/.dsh` / `DSH_HOME` 用户面语义时，接到 `resolveClhHome`，不直接消费 env。
- 新增 env 变量：用户面一律 `CLH_*`；只有"共享/第三方工具"语义才允许 `DSH_*`（需 review 说明理由）。
- 新增包：scope 一律 `@deepseek-ai/dsh-<name>`（发布序列规则见 `.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md`）。

## 6. 已知残留与豁免

- `apps/cli/src/profile-boot.ts:68,215` 注释写 `$DSH_HOME/cordis.patch.yml`——注释用词陈旧，实际解析走 `resolveClhHome`（`$CLH_HOME`）。属豁免项：注释更新留给下一次正常编辑顺手做，不值得单开 PR。
- 测试里大量 `CLH_HOME`/`DSH_HOME` 并存是隔离语义本身（fixture 要断言"不回退"），不是残留。

## 7. 验收（任何改动可对照）

1. `resolveClhHome` 永不读 `DSH_HOME`、`~/.dsh`；`grep DSH_HOME packages/util/home-paths/src/index.ts` 命中处只应是导出与注释。
2. 新文件不写 `~/.dsh`、不读 `DSH_HOME`、不引入 `dsh` 产品面命名。
3. 新包名：fork 自有新包用 `@cinlan/*`；与 upstream 同步的官方侧新包用 `@deepseek-ai/dsh-*`。
4. 用户输出（错误信息、help、诊断报告路径）不出现 `DSH_HOME` 字面量。
