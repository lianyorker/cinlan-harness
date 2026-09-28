# Agent Note：多模态工具结果保留

Status: implemented

[English](2026-09-23-cinlan-multimodal-tool-result-retention.md) | 中文

## 问题

工具结果可以包含有序文字和图片，而模型上下文限制与图片计量会随提供方路由变化。只按字节限制文字，无法计算视觉请求成本、保留图片位置，也无法为被省略的附件提供可用的恢复方式。

嵌套 PTC 调用还要求程序获得完整规范值，同时面向模型的分发日志和持久化工具结果保持有界。失败的嵌套调用必须继续是错误结果，不能创建成功的恢复上下文。

## 决策

`@deepseek-ai/dsh-spill-policy` 在下游 `tools/post-execute` 决策结算后，只接受完全由 `text` 和 `image` 块组成的最终内容。它在 `maxInlineTokens` 内保留有序首尾内容，并让不支持的块类型原样通过。

预算包含保留文字、不可分割的图片块、省略间隔文本、图片恢复描述和路由专属视觉计量。文字可以在安全的代理项边界处分割；图片只能整体保留或整体省略，保留块保持原始顺序。

策略通过 `ctx.spillStore.saveText()` 保存完整的有序文本表示。图片字节继续保存在附件存储中；每个图片位置记录可读取的附件路径和尺寸，模型读取 spill 文件后可以使用 `read_image`。显式的 `read` 和 `read_image` 面向模型的结果跳过保留策略，包括嵌套 PTC 转发：再次应用低于单张图片成本的上限会导致无法恢复。它们的分发日志副本仍保持有界。

图片计量从当前 Agent 请求路由解析，并使用配置的 provider/model 作为后备。缺少路由计量、附件访问、文件系统访问、存储、所有者或通知预算时，策略保留原始内容并记录警告；spill 恢复失败绝不会把成功工具调用变成 `isError`。

`projectContent` 在 spill 策略之前运行。因此 MCP 工具的图片块会进入保留逻辑，而 `finalizeContent` 仍是之后的最后一公里转换。参数无效失败不会保留为成功执行捕获的 projector。

对于成功的嵌套 PTC 图片结果，策略可以添加恢复用 user message，其 source 为 `{ kind: 'plugin', plugin: 'tools-ptc' }`。`isError` 结果不会添加该上下文；其中的图片内容仍属于错误结果。

## 结果

部署配置使用估算 token，而不是 UTF-8 字节。原有按字节设置的预算需要重新校准，面向模型的 snapshot fixture 也必须记录新的预览和通知。

仅文字的嵌套日志可以异步限制，不延迟程序值。除显式恢复外，包含图片的嵌套结果会在转发给模型前完成保留，使分发日志和恢复路径描述同一份有序内容。

旧的 spill 存储决策仍负责所有权、定位符不透明性、本地文件安全和清理。本 Note 只替换其中纯文本保留机制；两者关系记录在[存储 Note](2026-07-08-tool-output-spill-files.zh.md)中。

## 考虑过的替代方案

**继续使用 UTF-8 字节上限。**不予采纳：它无法按路由计算图片，也无法在同一个面向模型的预算中表达附件恢复成本。

**从预览中删除图片，只保存文字。**不予采纳：省略会变成静默行为，模型也无法在原位置恢复视觉输入。

**使用官方 `ptc-mode` 恢复 source。**不予采纳：Cinlan 使用现有 `MessageSourceMap` 条目 `{ kind: 'plugin', plugin: 'tools-ptc' }`；更改它会改变本地 Session 语义。

## 验证

保留、通知、多模态、spill-policy、core tools、MCP 和 Client spill 的聚焦测试覆盖 token 边界、图片顺序、计量、恢复、PTC 转发、失败回退和 HMR 清理。实际的 `tool-fs` 恢复结合附件与提供方计量，覆盖上限低于单张图片成本时的原生及嵌套 PTC 读取，包括有界分发日志且不重复创建面向模型的 spill。TypeScript 项目检查覆盖 tools、MCP、spill-policy 和 token-meter 导出。

双语包文档与子系统文档、生成的配置目录以及本 Note 均描述 `maxInlineTokens` 和图片恢复约定。`multimodal-spill-ends` 与 `multimodal-spill-middle` headless 场景提供当前格式 Session JSONL 回放证据，覆盖有界图片结果和图片省略通知。