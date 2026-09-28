---
description: "Durable quarantine and verified recovery for unreadable historical image attachments."
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-quarantine

English | [中文](README.zh.md)

## Summary

Quarantine unreadable historical image attachments so that sessions remain usable after an object disappears or fails integrity verification. The plugin replaces missing or corrupt images with deterministic text placeholders before model dispatch and derived requests skip reading those objects. Verified recovery restores the original reference after read verification succeeds.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in compositions that run persistent sessions with image attachments. The shipped `dsh` base profile mounts it by default.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-attachment-quarantine'
```

### What you can observe

When an image is unreadable, the session appends an `attachment/quarantine` event recording its attachment identity and failure class (`not_found`, `corrupt`, or `read_failed`). Subsequent model requests derive deterministic text placeholders instead of failing the session. Explicit recovery appends `attachment/recovered` after `readImage()` verifies integrity, restoring normal image projection.

### Failures and recovery

`ATTACHMENT_NOT_FOUND` and `ATTACHMENT_CORRUPT` failures immediately quarantine the object. An `ATTACHMENT_READ_FAILED` error is retried once respecting cancellation; if still failing, it appends quarantine marked as retryable. Explicit recovery checks digest and metadata before clearing quarantine; missing or corrupt bytes are never overwritten automatically.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This package declares `attachment/quarantine` and `attachment/recovered` events and provides browser-safe message projections exported from `./projection`. It registers both projections on `ctx.sessions`. Original historical events stay untouched in the append-only log; only projected messages replace quarantined image blocks with text placeholders.

During model request assembly, unreadable references are detected and quarantined before provider dispatch, allowing the turn to reproject and proceed without becoming a terminal model-request failure. Subsequent turns derive the placeholder directly from history and bypass disk reads.

Recovery calls `AttachmentStore.readImage()` to ensure complete byte and metadata integrity before appending `attachment/recovered`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Attachment subsystem reference](../../../docs/subsystems/attachment.md) — service contracts and durable reference structures.
- [Session surface reference](../../../docs/subsystems/session.md) — message projections and surface fold lifecycle.

-----

<a id="model-experience"></a>
## Model Experience

Models receive stable text placeholders in place of unreadable images, including the display name when present, attachment ID prefix, and failure class. This informs the model that an image was attached but is temporarily unreadable.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

Auxiliary model requests executed outside a live session cannot record durable quarantine state; such requests fail loud on read errors.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
