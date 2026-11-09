# Agent Note：产品面向 `clh`，包名保持 `dsh-*`，harness home 绝不回退 `DSH_HOME`

Status: implemented

[English](2026-10-31-clh-dsh-naming-boundary.md) | 中文

> 范围：Cinlan 产品标识（`clh`）与 upstream 对齐标识（`dsh`）的分界线，以及用户数据根为什么严格隔离。权威规则集见 [docs/dev/clh-dsh-边界.zh.md](../../../../docs/dev/clh-dsh-边界.zh.md)。

## Problem

Cinlan Harness 是 DeepSeek Harness 的 fork。产品已改名（`clh` CLI、`~/.clh` home、`CLH_HOME`/`CINLAN_HARNESS_HOME` 环境变量、`clh-`/`clh_` IPC 命名空间），但数百个包仍用 `@deepseek-ai/dsh-*` 名字，upstream sync 也不断引入 `dsh` 形状的代码（`packages/util/home-paths` 的 `dshHome*` deprecated 别名、`DSH_*` env 引用）。没有成文边界，每个新文件都要重新推导该站哪一侧命名，且失败模式不对称：逐字改 upstream 字面量会永久扩大 fork 差异，而读 `DSH_HOME` 会把用户数据悄悄耦合到官方产品。

## Decision

用户或机器边界能看到的一切是 `clh`；upstream 保持对齐的一切是 `dsh`。

- `packages/util/home-paths` 的 `resolveClhHome` 是唯一解析器：显式配置 > `CLH_HOME` > `CINLAN_HARNESS_HOME` > `~/.clh`。它绝不读 `DSH_HOME` 或 `~/.dsh`；`DSH_HOME_ENV` 导出仅为了让调用方避开受管命名空间。
- `~/.dsh` 隔离是产品承诺不是实现细节。同机装两个产品时，官方根下存着 sessions、credentials、缓存；从 CLH 读或清它都违反对方产品。
- `~/.agents` 是故意例外：它是共享 agent 工具配置而非 CLH 私有数据，所以保持独立并沿用 upstream 的 `DSH_AGENTS_HOME` env 名，而不是为同一概念再造一个变量。
- home-paths 里 deprecated 的 `dsh*` 导出全部转发到 clh 实现，让 upstream 形状的调用点能编译；新代码只用 `clh*` 名字。
- 新包继续用 `@deepseek-ai/dsh-*` scope；新的用户面环境变量用 `CLH_*`。upstream diff 里的 `dsh` 字面量保留，不重写。

## Alternatives considered

- **把包 scope 和内部标识改成 `clh-*`。** 否决：永久扩大 fork 差异、破坏每次 upstream sync 的 patch，且没有收益——包名不面向用户。
- **把 `DSH_HOME` 作为迁移/回退输入读取。** 否决：静默耦合两个产品的用户数据比强制显式导入更糟；无共享状态的共存本来就是隔离目标。
- **把 `DSH_AGENTS_HOME` 改名成 CLH 前缀。** 否决：`.agents` 根设计上与其他 agent 工具共享；产品前缀变量只会无谓地割裂这份共享配置。

## Consequences

- 一条成文规则替代逐文件判断：产品面名字是 `clh`、upstream 对齐名字保持 `dsh`；docs/dev/clh-dsh-边界.md §7 的清单就是验收标准。
- `DSH_HOME` 字面量仍可能出现在注释或"故意避开"的代码路径中；出现本身不违规，消费它才违规。
- 注释里残留的 `$DSH_HOME`（如 `apps/cli/src/profile-boot.ts`）属豁免：由下一次正常编辑该文件的改动顺手修正，不值得单开改名 PR。
