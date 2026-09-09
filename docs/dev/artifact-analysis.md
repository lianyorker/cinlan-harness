# Artifact（产物管理）分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

Artifact 是持久化不可变二进制产物存储能力。模型工具产出的文件（截图、下载、报告、证据等）通过此能力原子提交、SHA-256 校验、授权读取。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `artifact/artifact` | Service Definition | `ctx.artifacts` 抽象接口 | 5 文件, 10.8KB |
| `artifact/artifact-local` | Service Provider | 本地文件系统实现 | 3 文件, 25KB |

## Service Definition（`artifact/artifact`）

`ctx.artifacts: ArtifactStore`（抽象类继承 `Service`）

### 三个核心操作

| 方法 | 说明 |
|------|------|
| `publish(input)` | 提交字节，原子写入后返回 `ArtifactRef`（含 SHA-256） |
| `describe(input)` | 授权检查后返回元数据 |
| `read(input)` | 授权检查 + 字节上限校验后返回字节和元数据 |

### 类型系统

全部 Branded：`ArtifactId`、`ArtifactProducerId`、`ArtifactSessionId`、`ArtifactTaskId`、`ArtifactEngagementId`、`ArtifactScopeRef`

### 产物类别

`ArtifactKind`: `binary` | `text` | `download` | `trace` | `report` | `evidence` | (string & {})

### 保留级别

`ArtifactRetention`: `ephemeral` | `session` | `task` | `engagement` | `pinned` | `managed`

### 授权范围

`ArtifactAuthorization` 携带：`executionHostId`、`producerId`、`sessionId?`、`taskId?`、`engagementId?`、`scopeRef?`

本地 Provider 要求读取时所有字段匹配发布时的范围。

### 依赖

- `@deepseek-ai/dsh-execution-host` — `ExecutionHostId` 类型

## Service Provider（`artifact/artifact-local`）

`LocalArtifactStore extends ArtifactStore`

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `root` | `<DSH_HOME>/artifacts/v1` | 存储根目录 |
| `dshHome` | — | DSH_HOME 路径 |
| `maxBytes` | 100MB | 单次操作字节上限 |

### 实现

- `publishArtifactFile()` — 写入文件，计算 SHA-256，返回 `ArtifactRef`
- `describeArtifactFile()` — 读取元数据
- `readArtifactFile()` — 读取字节并验证摘要
- `MAX_ARTIFACT_BYTES` — 硬上限常量
- 路径无关：`ArtifactRef` 不暴露文件系统路径，`name` 字段去除路径组件

## 与其他能力的关系

- `execution-host` — Artifact 的授权范围引用 `ExecutionHostId`
- `coordination` — 任务产出的产物可通过 Artifact 持久化
- `browser` — 浏览器截图/下载可通过 Artifact 存储
- `security` — 安全证据（evidence）类别直接对应

## main 中是否存在

❌ main 没有 `artifact/` 顶层包组。需要完整迁移。
