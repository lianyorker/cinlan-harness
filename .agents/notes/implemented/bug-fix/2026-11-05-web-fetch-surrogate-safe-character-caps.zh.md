# Agent Note: Web fetch 字符上限边界安全

Status: implemented

[English](2026-11-05-web-fetch-surrogate-safe-character-caps.md) | 中文

## Problem

HTTP fetch 提供方、PDF 提取器和面向模型的 `web_fetch` 渲染器使用直接的 UTF-16 `slice()` 应用字符上限。当上限落在 emoji 的第一个 code unit 上时，提供方结果或 Session 可见的工具文本可能包含未配对 surrogate。

## Decision

所有有字符上限的 web fetch 路径都使用 `@deepseek-ai/dsh-output-retention` 的 `truncateWithoutSplittingSurrogatePair`。HTTP 提供方在 charset 解码后应用它，PDF 提取器在消费每页剩余预算时应用它，`web_fetch` 在转换源正文和完整渲染输出上应用它。字符上限继续按 UTF-16 code unit 计数；边界截断会丢弃不完整的 pair，并保持在配置上限内。

## Alternatives considered

**使用 `Array.from()` 按 Unicode code point 计数。** 这会改变现有 UTF-16 code unit 约定，并允许配置的字符上限放行最多两倍的 code unit。

**保留直接 `slice()` 并依赖 JSON 序列化。** JSON 序列化不会把未配对 surrogate 变成有效的用户可见字符，也会让提供方结果与面向模型的输出不一致。

## Consequences

HTTP 文本、PDF 文本、源转换和最终抓取输出不会再在上限边界生成新的未配对 surrogate。共享 helper 仍是这一机械规则的唯一实现；按字节的 `TextRetainer` 行为不变。web-fetch HTTP 包现在显式声明 workspace 依赖和 TypeScript project reference。

## Testing

定向 HTTP 与 `web_fetch` 测试覆盖解码正文、源转换和完整输出边界上的 emoji 上限。两个 web 包都通过严格 package typecheck、双语 README 配对和 `git diff --check`。
