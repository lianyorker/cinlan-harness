# Agent Note: Honor browser aliases in dynamic Client bundles

Status: implemented

English | [中文](2026-09-27-browser-aliases-in-dynamic-client-bundles.zh.md)

## Problem

The dynamic Client tsdown resolver selects package entry points without the legacy npm `browser` alias field. A dependency such as `qrcode` therefore contributes its Node renderer, whose `require("fs")` cannot be answered by the browser module table when the pairing plugin materializes.

## Decision

`clientConfig` sets `inputOptions.resolve.aliasFields` to `[['browser']]`. The package import remains the normal dependency specifier, so each dependency's published browser replacement is selected by the resolver. `scripts/client-bundle-purity.spec.ts` pins this resolver option.

## Alternatives considered

**Import `qrcode/lib/browser.js` in the pairing package.** This would encode one dependency's internal file layout and leave other browser-aware dependencies exposed to the same failure.

**Add Node builtin stubs to the browser module table.** A browser table cannot implement Node APIs; stubs would defer or hide an invalid bundle rather than remove the server-only code.

## Consequences

Dynamic Client bundles honor package browser aliases while preserving existing module-table externalization. A Client rebuild is required before a desktop installer is packaged; the pairing artifact no longer contains the Node QR renderer or `require("fs")`.

## Verification

The pairing Client bundle builds successfully, its generated artifact contains no Node QR renderer or `require("fs")`, `tsc -b packages/client/ui-settings-pairing/tsconfig.json` passes, `verify-client-packages` passes, and the focused pairing plus Client bundle Vitest suites pass.
