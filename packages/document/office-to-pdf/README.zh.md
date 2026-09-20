---
description: "在 Host 上将已授权 Office 文件转换为有大小限制、可缓存的 PDF。"
kind: "package-reference"
---

# @deepseek-ai/dsh-office-to-pdf

[English](README.md) | 中文

## 概述

在宿主计算机上将 DOC、DOCX、XLS、XLSX、PPT 和 PPTX 文件转换为 PDF。并发调用方在配置限额内共享转换和缓存结果。浏览器预览保留源文件标识，调用方获得独立的 PDF 字节。转换使用独立发布的 LibreOffice kit，不修改 Office 文件。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

通过 `cordis.yml` 条目挂载 `@deepseek-ai/dsh-office-to-pdf`。本地文件预览还需要[工作区文件](../../api/workspace-files/README.zh.md)服务及其文件系统、沙箱策略和 Typert 依赖。

进程内调用方通过 `ctx.officeToPdf.convert()` 提交已授权源标识、版本、可选字节数、延迟的有界读取、扩展名和优先级。源版本变化会拒绝转换。每个结果包含调用方拥有的 PDF 字节、缺失字体名称、内容缓存键和提供方代次。取消以原因为拒绝值；转换失败使用 `OfficeToPdfError`。

`officeToPdf.render` Remote 方法接收 Session 标识、Office 路径和优先级。Host 将该标识解析为本地 Agent，并在查询缓存前执行普通工作区文件授权。响应保留源文件路径和版本，并携带 base64 PDF 字节、缺失字体和提供方代次。`officeToPdf.generation` 返回当前代次；替换提供方会使之前的渲染标识失效。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxConcurrentConversions` | `2` | 最大活跃转换器数量。 |
| `maxQueuedJobs` | `8` | 最大排队元数据任务数量。 |
| `maxReaders` | `32` | 最大未完成读取方数量；最后一个名额预留给前台。 |
| `maxSourceBytes` | `104857600` | 源字节总预留容量；必须覆盖 `maxInputBytes`。 |
| `maxBackgroundConversions` | `1` | 最大活跃后台任务数量；零表示拒绝后台准入。 |
| `maxCachedEntries` / `maxCachedBytes` | `8` / `134217728` | 保留的 PDF 数量和字节数。 |
| `maxSourceEntries` | `64` | 最大保留源版本别名数量。 |
| `timeoutMs` | `60000` | kit 转换期限，不含排队时间。 |
| `maxInputBytes` / `maxOutputBytes` | `52428800` / `104857600` | 最大源文件和完整 PDF 字节数。 |
| `maxImageResolution` | `192` | 最大导出光栅图像 DPI。 |

[Config](src/index.ts) 还定义归档和字体限额。`fontDirectories` 接受绝对路径；省略时保留 kit 平台默认值。`fontFallbacks` 替换 kit 字体优先组，每组至少包含两个非空白名称。运行时依赖是 `@deepseek-ai/libreoffice-kit` 版本 `0.0.1`；它发布的可选依赖声明了 Windows x64 和 ARM64 原生引擎。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

[队列](src/queue.ts)在读取字节前准入元数据。已知大小预留 stat 字节数，未知大小预留输入限额。前台工作优先于排队后台工作，可以提升共享预热优先级，也可以移除排队推测任务。读取方独立取消；最后一个读取方取消共享工作。实际读取、转换和清理完成前，活动预留容量保持不变。

成功 PDF 按提供方代次、扩展名和源字节 SHA-256 保留。有界源版本索引在授权后避免重复读取；不同路径可以共享内容转换。最近最少使用驱逐会同时移除 PDF 及其别名。不保留失败或超过缓存限额的结果。已完成别名命中不占用未完成读取方名额，后台准入禁用时也可使用。

每个活跃槽按需创建并复用一个 kit 转换器。提供方将输入写入私有临时目录，[验证 PDF 并限制其大小](src/output.ts)，并在转换完成前删除临时文件。卸载会取消并等待授权、转换和转换器清理。这些操作及其临时文件由同一生命周期负责，因此不发布运行时不变量伴随入口。

Remote 读取在预留容量内的文件系统读取前后验证源标识。授权失败直接传递；转换失败返回 `document-render/failed` 及分类原因，不暴露引擎诊断。[真实转换测试](tests/conversion.spec.ts)通过 Loader 加载服务，使用[确定性 OOXML 样本](tests/fixtures/office.ts)，并通过 PDF.js 检查文档文字和表格、电子表格数值及幻灯片顺序。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [工作区文件](../../api/workspace-files/README.zh.md) — 本地 Session 文件授权与有界读取。
- [架构](../../../docs/architecture.zh.md) — Cordis 组合与应用启动。
- [测试](../../../docs/testing.zh.md) — 源码与构建产物验证。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包仅转换字节，不提供面向模型的工具、消息或 Session 事件。

#### KV Cache effect

无；转换不会构造或修改模型请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 转换保真度、字体和原生引擎资源由 `@deepseek-ai/libreoffice-kit` 负责；此提供方不查找系统 LibreOffice，也不在运行时下载引擎。
- `timeoutMs` 不包含排队等待。限额约束拥有的请求和载荷，不约束引擎 RSS、base64 传输膨胀、调用方保留的结果或浏览器 PDF 渲染。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
