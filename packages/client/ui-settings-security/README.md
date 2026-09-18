---
description: "Configure browser preferences and security assessment scope, and inspect desktop and mobile device readiness."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

English | [中文](README.zh.md)

## Summary

Configure browser launch preferences and link routing, and inspect desktop and mobile readiness in Settings. Security Research exposes preset and scope status, an authorized scope editor, and report downloads. Mobile settings preserve existing Host preferences while stating which values have no device-operation consumer. Explicit actions retain their Host permission checks; opening a page does not install software or perform device input.

## Table of Contents

- [Use this package](#use-this-package)
- [Settings and action ownership](#settings-and-action-ownership)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount with Settings, Locale, and the pluginInventory, deviceCapabilities, securityResearch, browser, and settings Remotes. The Security Research, Browser, Computer Use, and Mobile navigation sections remain available when a capability is missing. Security Research reports missing or broken presets and keeps its scope editor and export unavailable until the preset is usable. Plugin loading, Provider readiness, and action authorization are separate facts.

The Computer Use and Mobile pages copy the supported `dsh --profile device-control` command. It launches a separate profile without installing external software. Clipboard denial displays a failure message.

<a id="settings-and-action-ownership"></a>
## Settings and action ownership

| Page | Stored fields and runtime consumers |
|---|---|
| Browser | `browser-playwright` stores channel, headless mode, viewport width/height, profile name, home page, and search engine. Browser launch consumes channel/headless/viewport/profile; home and search actions consume their corresponding preferences. Restart the current profile to apply changes. |
| Browser link routing | The sidebar owns `browserInterceptLinks`, `browserInterceptHttp`, and `browserInterceptHttps` in `dsh-better-sidebar`. GUI and terminal hyperlinks consume these settings independently of the Browser Provider. Save sends only changed routing fields; reset removes only their overrides, preserving other sidebar preferences. |
| Mobile | The [mobile capability](../../mobile-device/mobile-device/README.md) owns the `mobile-device` namespace. `enabled` controls automatic page checks, `androidSdkPath` supplies the Host SDK probe, and `defaultDeviceId` supplies only an omitted `mobile_observe.device_id`. |
| Security Research | `assessment-scope.root` owns grant identity, validity, targets, hosts, actions, exclusions, evidence policy, egress destinations, and credential references. The scope owner validates and applies the submitted authority. |
| Computer Use | The read-only Provider check reports platform, Provider/version, protocol, and declared support flags. Missing observations remain unavailable, and action permissions remain unprobed even after a successful check. No screen, cursor, or scaling preferences are supplied. |

Browser and Mobile forms read framework-bound SettingsScope snapshots. Drafts retain the first-edit revision; one atomic mutation saves each form. Reset removes user overrides to recover composition defaults. Only successful Host responses update the shared mirror and show success; rejected writes retain the draft. Read-only or unavailable settings cannot be saved or reset.

Mobile SDK and device-list reads have independent loading, failure, and retry states and cancel when the view leaves. The Host SDK check reads the saved path for a read-only `adb version` probe; unsaved edits do not affect it. A missing or offline saved device stays selected until the user changes it. `mobile_observe` uses the saved default only when no explicit device is supplied and fails if that default is unavailable, without fallback. Device mutations still require an exact device and an observation token. Enabling automatic checks does not grant action authorization, and manual checks do not save preferences or install tools.

Explicit browser connect, home/search, history/network inspection, cookie-file import, and file-transfer actions use the browser Remote. Mounting the page or saving preferences does not start a browser. Cookies never display values; downloads use inert Blobs whose URLs are released when their view leaves. Transfers remain inside their details panel and search navigation opens it when a page is selected.

Security scope edits preserve the first-edit revision and surface Host rejection without a saved badge. Advanced egress and credential rows support add, edit, and removal; empty lists clear their authorization. Credential references are environment-variable names, not secret values; saving does not resolve credentials or contact destinations. Report generation requires an explicit live Session id and format; its authorized Remote returns bounded bytes for an inert Blob download. Switching Session or format, retrying, or leaving releases the previous link.

Native page headings and rows inherit the Settings shell's width. Search indexes localized public titles, descriptions, and keywords, never preference values, device identities, scope contents, credentials, or reports. Descriptors and section slots share one declaration lifetime. Search targets remain identifiable in unavailable states, and targeted component diagnostics expand without issuing new operational actions.

-----

<a id="dev-note"></a>
## Dev Note

[Package tests](tests/) cover metadata lifetime and localization, preference revision fencing and reset, rejected drafts, readiness failures, clipboard feedback, browser actions, and security scope/report behavior. No runtime invariant companion is published: this package reads authoritative Host results and retains only UI drafts and viewing state. Protocol semantics belong to [Device control](../../../docs/subsystems/device-control.md).

-----

<a id="model-experience"></a>
## Model Experience

None, as viewing or saving settings adds no model content or tokens and this package registers no prompt, tool, or Session event; copyable prompts reach a model only if the user pastes and sends them.

#### KV Cache effect

None; preferences and readiness reads do not enter the model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A loaded plugin does not prove readiness, and a successful Provider probe does not grant action authorization. The device-control profile uses external CLI adapters; native Browser does not depend on them.
- The SDK path configures only the Host probe, not the external Cinlan device runtime. A successful SDK check does not prove that a device session can launch.
- Capture content, browser zoom, and computer-control preferences require their own runtime owners; this package does not add preview-only fields.
- Security status reports configuration, not scanner readiness or complete policy coverage across external tools.
