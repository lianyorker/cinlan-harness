# Design Studio（设计工作室）分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

Design Studio 是 UI 设计文档管理能力。模型可以创建 HTML/SVG/Markdown 设计文档，预览渲染，迭代更新，导出为 HTML/PDF/PNG。支持 `DESIGN.md` 品牌契约。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `design/design-studio` | Service Definition | `ctx.designStudio` 注册和调度 | 3 文件, 11KB |
| `design/design-studio-local` | Service Provider | 内存文档 + 文件系统持久化 | 2 文件, 11.4KB |
| `design/design-studio-prompt` | System Prompt | 设计工作流引导提示词 | 2 文件, 4.5KB |
| `design/tool-design-studio` | Tool Consumer | 模型工具 | 2 文件, 10.4KB |

## Service Definition（`design/design-studio`）

`ctx.designStudio: DesignStudioRuntime`

### Provider 接口

`DesignStudioProvider`:
- `create(request)` — 创建设计文档
- `read(id)` — 读取文档
- `update(request)` — 更新文档（版本递增）
- `delete(id)` — 删除文档
- `list()` — 列出文档摘要（不含内容）
- `preview(id)` — 渲染为自包含 HTML
- `export(id, format)` — 导出文件
- `dispose?()` — 清理资源

### 类型

- `DesignDocumentId` — Branded 标识符
- `DesignDocumentVersion` — 版本号
- `DesignArtifactType`: `html` | `svg` | `markdown`
- `DesignExportFormat`: `html` | `pdf` | `png`
- `DesignDocument` — 完整文档（id、title、type、content、version、createdAt、updatedAt）
- `DesignDocumentSummary` — 摘要（不含 content）
- `DesignPreview` — 预览结果（HTML）
- `DesignExportResult` — 导出结果（路径 + 字节大小）

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `provider` | 第一个注册的 | 选择 Provider by id |

## Service Provider（`design/design-studio-local`）

内存文档存储 + 文件系统 JSON 持久化，289 行。

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `storageDir` | `.dsh-design-studio` | 文档存储目录 |

### 限制

- `MAX_CONTENT_BYTES` = 16MB
- `MAX_TITLE_LENGTH` = 200 字符
- 有效类型：`html` | `svg` | `markdown`
- 有效导出格式：`html` | `pdf` | `png`

### 预览渲染

将 HTML/SVG/Markdown 渲染为自包含 iframe 可嵌入 HTML。

### 导出

- `html` — 本地 Provider 支持
- `pdf` / `png` — 需要带真实渲染器的 Provider

## System Prompt（`design/design-studio-prompt`）

注册 `design:studio` 系统提示词段（order: 117）。

### 五阶段设计工作流

1. **Brief** — 明确设计目标、受众、约束；读取 `DESIGN.md` 品牌契约
2. **Create** — 调用 `design_studio_create`，自包含 HTML（内联样式，无外部依赖）
3. **Preview** — 调用 `design_studio_preview` 渲染预览
4. **Iterate** — 调用 `design_studio_update` 迭代（版本递增）
5. **Export** — 调用 `design_studio_export` 导出

### DESIGN.md 品牌契约

工作区根或 `design-systems/` 目录下的 `DESIGN.md` 定义视觉语言：颜色、字体、间距、组件、布局。存在时必须遵守。

## Tool Consumer（`design/tool-design-studio`）

282 行，注册 6 个工具：

| 工具 | 说明 |
|------|------|
| `design_studio_create` | 创建设计文档（title、type、content） |
| `design_studio_read` | 读取完整文档 |
| `design_studio_update` | 更新文档内容（版本递增） |
| `design_studio_list` | 列出文档摘要 |
| `design_studio_preview` | 渲染预览 |
| `design_studio_export` | 导出为 html/pdf/png |

## 与其他能力的关系

- 设置 UI 的 `ui-settings-cinlan-capabilities` 中 `design` 能力页面（matcher: `/design-studio|cinlan-design/i`）展示此能力状态
- `client/ui-design-studio` — 设计工作室 UI 组件
- `bundle/design-studio` — Bundle 集成

## main 中是否存在

❌ main 没有 `design/` 顶层包组。需要完整迁移。
