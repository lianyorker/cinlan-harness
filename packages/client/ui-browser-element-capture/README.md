---
description: "Select browser elements, preview their screenshots, and attach images to Session drafts."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-element-capture

English | [中文](README.zh.md)

## Summary

Select an element on an existing Browser page, preview its verified screenshot, and attach the image to the initiating Session draft. The destination stays with that Session even if another Session becomes current. Capture and attachment never send a message; submit the draft from the conversation when ready.

## Table of Contents

- [Capture workflow](#capture-workflow)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="capture-workflow"></a>
## Capture workflow

Enable the optional [Cinlan Browser bundle](../../bundle/cinlan-browser/README.md) in a Web-capable profile. Open a Session and a page in the configured Browser, then open **Settings → Element capture**. Refresh the page list, choose a page, and start selection. Click the intended element in the Browser window; Escape in that window or Cancel in Settings removes the selection overlay. The Browser checks the element and its visible bounds around capture and returns the screenshot for preview.

Attachment becomes available after the preview loads. A removed Session or busy draft rejects attachment and retains the preview for retry. Refresh, replacement selection, cancellation, and page disposal abort pending work and ignore late results.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [Client entry](src/client/index.ts) waits for `remote.browser`, Session and conversation services, and the settings slot declaration. It provides plain operation callbacks to the component. The contribution and its localized search metadata share the declaration lifetime; page URLs and image data do not enter search metadata.

The Node entry is empty. The [Browser controller](../../api/browser-controller/README.md) owns authenticated operations and image persistence. [Conversation](../ui-conversation/README.md) owns draft admission and eventual submission. No runtime invariant companion is published because these owners validate image intake, while the slot registry owns registration lifetime.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Draft image attachment

#### What the model sees

Nothing until the user sends the draft. Submission records a `user/message` with an `image` block referencing the captured attachment; the receiving model must accept images. This package contributes no prompt or tool definition.

#### Token effect

Selection, capture, preview, and draft attachment add no model input. A submitted image consumes the receiving model's ordinary image tokens.

#### KV Cache effect

Viewing or operating the panel leaves model requests unchanged. Sending a draft adds its image to the normal request continuation without changing the static prompt prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Capture depends on the configured Browser and a writable Session draft.

- Selection requires an existing Browser page and an available Browser Provider. The page does not create or navigate pages.
- A selection is single-use. Capture failure or preview failure requires selecting the element again; attachment failure retains a successfully loaded preview.
- The operation reads and captures the selected page. It does not grant model-tool click, navigation, script, or upload permission.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [settings ownership decision](../../../.agents/notes/implemented/architecture/2026-09-17-native-settings-runtime-consumers.md) records why attachment targets the initiating draft. The [real Web acceptance case](../../../apps/web/tests/settings-element-capture.e2e.ts) covers capture and draft handoff through the optional Browser bundle. Current execution evidence belongs in the [acceptance status](../../../.agents/plans/settings-native-acceptance-status.md).

</details>
