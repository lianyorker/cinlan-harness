---
description: "Persistent Browser capability family for Cinlan Harness."
kind: "package-group"
---

# browser/ - persistent browser capability family

English | [中文](README.zh.md)

## Summary

Control persistent Browser pages and verified element captures through opt-in providers and model-facing Consumers.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

## Packages

This opt-in family controls persistent web pages exposed by Cinlan IDE without embedding a browser engine in the harness. The capability reference is [`browser/`](browser/README.md).

| Package | Role | Runtime contribution |
|---|---|---|
| [`browser/`](browser/README.md) | Service Definition | `ctx.browser` provider registry and execution facade |
| [`browser-cinlan/`](browser-cinlan/README.md) | Service Provider | Public `cinlan ... --json` browser commands through `ctx.subprocess` |
| [`browser-playwright/`](browser-playwright/README.md) | Opt-in Service Provider | Playwright persistent pages and verified element capture |
| [`tool-browser/`](tool-browser/README.md) | Model-facing Consumer | Seven `browser_*` tools and persistent-browser guidance |
| [`tool-browser-element-capture/`](tool-browser-element-capture/README.md) | Opt-in model-facing Consumer | Human element selection and verified crop tools |
| [`browser-permission-policy/`](browser-permission-policy/README.md) | Permission-policy Consumer | Independent observe, navigate, and interact decisions |

Persistent Browser operates Cinlan-managed web pages by page id and short-lived accessibility observations. OS Computer Use operates desktop windows, native applications, and operating-system controls; it is a separate capability and is not implemented by this family.

The default Cinlan Web composition uses `browser-cinlan` with the element-capture Consumer and executor; it does not mount the Playwright Provider. Playwright, Electron, Tauri, remote-pairing, download, trace, and desktop-shell capabilities remain separate opt-in packages.

<a id="dev-note"></a>
## Dev Note

No standalone subsystem page exists; the group and package READMEs own the persistent Browser documentation.
