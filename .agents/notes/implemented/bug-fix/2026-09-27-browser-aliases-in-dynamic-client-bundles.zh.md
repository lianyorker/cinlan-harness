# Agent Note: Honor browser aliases in dynamic Client bundles

Status: implemented

[English](2026-09-27-browser-aliases-in-dynamic-client-bundles.md) | 中文

## Problem

动态 Client tsdown resolver 选择包入口时没有启用 npm 的传统 `browser` alias 字段。因此，像 `qrcode` 这样的依赖会带入 Node renderer；配对插件物化时，浏览器 module table 无法回答其中的 `require("fs")`。

## Decision

`clientConfig` 将 `inputOptions.resolve.aliasFields` 设为 `[['browser']]`。包的导入仍使用普通依赖 specifier，因此 resolver 会按每个依赖发布的 browser 替代项进行选择。`scripts/client-bundle-purity.spec.ts` 固定这一 resolver 选项。

## Alternatives considered

**在配对包中直接导入 `qrcode/lib/browser.js`。** 这会把单个依赖的内部文件布局写死，并让其他支持 browser alias 的依赖继续暴露相同故障。

**向浏览器 module table 添加 Node builtin stub。** 浏览器 table 无法实现 Node API；stub 只会延迟或隐藏无效 bundle，而不是移除服务端代码。

## Consequences

动态 Client bundle 会统一遵循包的 browser alias，同时保留现有 module-table externalization。打桌面 installer 前必须重新构建 Client；配对产物不再包含 Node QR renderer 或 `require("fs")`。

## Verification

配对 Client bundle 构建成功，生成产物不含 Node QR renderer 或 `require("fs")`；`tsc -b packages/client/ui-settings-pairing/tsconfig.json`、`verify-client-packages` 以及配对和 Client bundle 的定向 Vitest suite 均通过。
