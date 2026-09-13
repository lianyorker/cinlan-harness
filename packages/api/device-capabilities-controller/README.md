---
description: "The deviceCapabilities/check Remote probes optional Computer Use or Mobile Device Providers without installing software or performing input. It returns redacted readiness categories rather than Loader activation or installation claims."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-device-capabilities-controller

English | [中文](README.zh.md)

## Summary

The deviceCapabilities/check Remote probes optional Computer Use or Mobile Device Providers without installing software or performing input. It returns redacted readiness categories rather than Loader activation or installation claims.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount this controller with the Typert registry. Computer Use and Mobile Device services are optional; missing services return not-configured. Computer checks call capabilities; mobile checks call listDevices and return no-devices when no available device is reported. Neither response contains application names, device ids, command paths, or Provider error text.

## Model Experience

None, as this controller registers no model tools, prompts, or Session events.

#### KV Cache effect

None; readiness does not enter model requests.

## Known Limitations and Deferred Work

- Readiness is a point-in-time transport check, not action authorization or proof that every desktop permission is granted. Caller cancellation propagates to the Provider. CLI installation, authentication, and native permissions remain external prerequisites.

No runtime invariant companion is published: the controller returns immediate results and retains no independent Provider state.

### Dev Note

Status definitions live in [types.ts](src/types.ts).
