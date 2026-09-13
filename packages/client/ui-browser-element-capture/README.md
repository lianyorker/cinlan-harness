---
description: "Static Browser element capture guidance in Web Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-element-capture

English | [中文](README.zh.md)

## Summary

This Client plugin registers one localized `settings.section` entry that explains the Browser Element Capture workflow and its permission separation. The panel is static and has no Host Remote, Browser service, React Context, manual subscription, provider-state projection, or capture action.

## Table of Contents

- [Registration](#registration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="registration"></a>
## Registration

The Client half waits for the `settings.section` slot, registers section id `browser-element-capture` at order `70`, and contributes matching Chinese and English locale dictionaries. It does not register `settings.section.icon`. Removing the Settings declaration or disposing the plugin removes the section through slot lifetime.

The Node half is intentionally empty because presentation is entirely browser-side.

<a id="model-experience"></a>
## Model Experience

None, as this Client plugin registers no prompt, tool, Session event, or model-request input.

#### KV Cache effect

The Settings section does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The panel does not display live Provider status, active selections, task progress, or saved attachments.
- Selection and capture remain model-tool operations rather than direct Settings actions. Guidance names the Cinlan selection-id workflow and image-capable model requirement.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because the plugin retains only slot-owned presentation state and the slot registry already owns registration lifetime.
