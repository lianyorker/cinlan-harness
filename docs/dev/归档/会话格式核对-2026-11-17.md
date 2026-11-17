# 会话格式核对分析（Session Format Check）

核对对象：cinlan-harness fork 的 Session 持久化格式权威值、发布记录与迁移纪律。结论基于当前 checkout 源码与记录文档。

## 1. 权威值核对

| 项 | 位置 | 当前值 |
|---|---|---|
| 写入方常量 | `packages/core/session/src/types.ts` `SESSION_FORMAT_VERSION` | **4** |
| 已定稿基线 | `docs/session-format-status.md` `latestFinalizedVersion` | **4**（机器记录 `docs/persistence-changes/finalized/v4.json`） |
| 已发布格式 | 同上 `latestReleasedVersion` + `evidenceTag` | **4**（`dsh-v0.2.0-rc.2`） |
| 派生索引 | `packages/session-query/session-query-sqlite/src/schema.ts` `SESSION_QUERY_SQLITE_SCHEMA_VERSION` | **8** |

三者一致：写入方 = 定稿 = 已发布，fork 不存在“超前于发布”的未提交格式推进。

## 2. 格式历史

`git log -S SESSION_FORMAT_VERSION` 可见 `types.ts` 的写入方推进链：

- `d53da71b93` upstream sync `dsh-v0.2.0-rc.1`（fork 同步基线）
- `b0422f2a50` 审查修复 bump + 恢复 turn-end warn
- `d1521ea783` `feat(session)!: add released format migration`（相邻迁移落地）

## 3. 适用规则回顾

- **不可变代**：已提交各代格式永不移动/覆盖/删除；相邻迁移可新增版本名继任，但不提供前代回退或降级。
- **SQLite 派生索引**：`SESSION_QUERY_SQLITE_SCHEMA_VERSION` 单调递增（当前 8），不兼容版本原地重建——它不等于 Session 格式版本。
- **同版本兼容**：`SESSION_FORMAT_VERSION` 不变时，reader 兼容性由评审记录兜底（`.agents/notes/implemented/process/2026-10-08-session-reader-compatibility-review.md`）；新增判别器不得破坏既有字段的既有解释。
- **发布记录纪律**：格式 bump 时同步改常量+相邻目录；发布前不得提前推进 release record；记录只升不降。

## 4. 本轮 REA 集成的格式影响

- `dsh-security-rea` 只注册 Cordis 服务、Remote 方法与 skill，不写入 Session 事件，未触碰 `SessionEventMap` 或持久化类型——**无格式变更义务**。
- `securityResearch/reaStatus`、`securityResearch/reaDoctor` 属 Remote 调用面而非会话日志，产物（`SecurityReaDoctorSnapshot`）经 Typert 契约走 RPC，不进 `session/*.jsonl`。
- `cordis.patch.yml`/preset/prompt 调整只影响装载组合，与持久化格式无关。

## 5. 结论

- fork 会话格式与 upstream `dsh-v0.2.0-rc.2` 发布记录**完全对齐**，无偏离、无未登记 bump。
- 后续任何新增 session 事件或持久化字段须走 `docs/cookbook/reviewing-persistence-type-changes.md` 声明 + 评审路径，并在 `gen-session-format-catalog` 中登记相邻迁移。
- 无需执行迁移动作；仅保留此核对证据。
