---
description: "Review desktop and mobile Provider readiness, browser setup, and design capability guidance in Settings. Security Research appears only when the Host preset roster contains security-research."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

English | [中文](README.zh.md)

## Summary

Review desktop and mobile Provider readiness, browser setup, and design capability guidance in Settings. Security Research appears only when the Host preset roster contains security-research.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount with Settings, Locale, pluginInventory, deviceCapabilities, and agentPresets Remotes. The Computer Use card copies `dsh --profile device-control`; the command launches a separate profile and does not install external software. The three usage cards describe observation, input, and post-action verification.

Security Research navigation follows the authoritative preset roster at mount, window focus, settings updates, and reconnect. Failed or stale reads cannot introduce the section. Generic Skills and this Settings plugin are not installation evidence. Each page and navigation icon remains a reversible Slot contribution.

Browser and Mobile Emulator use ordered setup cards. SDK configuration and default-device persistence remain unavailable. Browser exposes explicit cookie-file import and file-transfer actions through its native Remote. Design Studio installation and replacement are undecided; the page does not overwrite a design tool or advertise a working installer. The [design reference](DESIGN.md) owns layout and status presentation.

Security Research reads its own securityResearch/describe Remote: preset availability, scope validity, and the actual bundled skill count. Incomplete discovery and broken presets remain attention states. These are configuration facts, not scanner readiness or complete effect authorization. Device pages identify the current CLI adapters as an incomplete native migration instead of directing setup to another application.

Browser settings bind the browser-playwright namespace through the shared Settings mirror. Drafts retain their read revision, writes use one atomic mutation, and failures retain the draft. Saving never launches a browser or grants permission; restart applies the persisted preferences. Explicit connect, home/search, inspection, and file operations use the browser Remote; mounting or saving preferences does not start a browser. Cookies never display values; downloads use inert Blobs whose URLs are released when the panel leaves.

Security scope drafts use framework-bound Settings selectors, preserve the first-edit revision, and surface Host rejection without a saved badge. The form edits grant identity, validity, targets, hosts, actions, exclusions, and evidence policy while preserving advanced egress and credential references. Those references remain editable in plugin configuration. Report generation requires an explicit live Session id and format; its authorized Remote returns bounded bytes for an inert Blob download. Switching format or Session, retrying, or leaving the panel releases the previous link.

## Model Experience

None, as Settings presentation registers no prompt, tool, or Session event.

#### KV Cache effect

None; these reads do not alter model requests.

## Known Limitations and Deferred Work

- A loaded plugin does not prove readiness. A successful Provider probe is not action authorization. The legacy device-control profile still uses external CLI adapters and asks before device operations; native Browser does not depend on them. Clipboard denial is reported without claiming a copy succeeded.

No runtime invariant companion is published: the page retains component-local viewing state and reads authoritative Host results.

### Dev Note

Protocol and status semantics are documented in [Device control](../../../docs/subsystems/device-control.md).
