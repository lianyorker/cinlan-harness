---
description: "Model-facing device tools with normalized coordinates and optional screenshots."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-mobile-device

English | [中文](README.zh.md)

## Summary

Model-facing device tools with normalized coordinates and optional screenshots.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This Consumer uses provider-neutral guidance for connected Android phones, emulators, and other devices a selected Provider supports. It registers five model-facing tools over [`ctx.mobileDevice`](../mobile-device/README.md). It owns strict model-input validation, concise result rendering, optional PNG persistence, and stable system guidance.

| Tool | Behavior |
|---|---|
| `mobile_list_devices` | List canonical exact device ids and availability |
| `mobile_observe` | Observe an explicit device or the saved default; return a fresh one-use observation, tree text, and optional native PNG attachment |
| `mobile_touch` | Tap or swipe with normalized `0..1` coordinates |
| `mobile_type` | Type bounded literal text without echoing it in the result |
| `mobile_button` | Press one provider-supported device navigation button |

`mobile_observe` requests a screenshot only when the deployment attachment policy accepts PNG and the exact routed Provider and model resolve to native image input. Accepted images use the attachment-backed `ImageBlock` path used by Computer Use; they never pass through MCP. Tree text remains available when capture is skipped, fails, or image persistence fails.

Only `mobile_observe` permits omitting `device_id`: the Mobile Device service resolves the saved default to an exact currently available device, with no fallback. An explicit id wins; empty ids and surrounding whitespace are invalid. Every mutation requires an exact `device_id` and latest `observation_id` returned by the observation. Tap and swipe fields are mutually exclusive, coordinates are finite and inclusive from `0` to `1`, and a successful result instructs the model to observe again without echoing typed text.

## Model Experience

### Tool-visible state

#### What the model sees

For `mobile_observe`, the model sees the actual resolved device metadata, generation and observation ids, normalized coordinate space, bounded tree text, explicit screenshot status, and an optional native image block. The resolved device id is also persisted in presentation metadata so completed cards show the same target during replay. Mutation results contain only target identity and the fresh-observe requirement.

#### Token effect

The stable guidance and five schemas add request tokens. Device trees and rendered results add result tokens; optional images use the Provider's native image accounting.

#### KV Cache effect

Static guidance and schemas remain stable for one tool configuration and never embed the saved device preference. Device observations and images are per-call result content and do not alter the request prefix.

## Known Limitations and Deferred Work

- The Consumer exposes no install, launch, device lifecycle, runtime permission, log, file, raw execution, camera, sensor, clipboard, or remote pairing tools.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
