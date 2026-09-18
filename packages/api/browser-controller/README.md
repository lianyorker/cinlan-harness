---
description: "Authenticated Browser Settings operations over the native Provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-browser-controller

English | [中文](README.zh.md)

## Summary

This Host Remote controller connects Browser Settings to the selected native Provider. It provides profile status, explicit navigation, page inspection, cookie JSON import, observed file-input uploads, and page-owned download reads. It registers no model tools and imports no concrete Provider.

## Table of Contents

- [Operations](#operations)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="operations"></a>
## Operations

The optional cinlan-browser bundle mounts this controller. The generated browser Remote namespace requires the authenticated Connection/Gateway; these human commands are independent from model tool approvals. Profile reads do not launch a browser. Page listing and navigation are explicit user actions and may launch it.

Element selection opens a cancellable native picker on an explicit page. Capture consumes that page's one-use selection, requests PNG, persists the bytes through Attachments, and returns the stored image reference and verified bytes for preview. The controller does not select a Session or send a message; the [capture page](../../client/ui-browser-element-capture/README.md) owns explicit admission to the initiating draft.

Cookie import accepts a JSON array up to 256 KiB, an expected active profile name, and bounded cookie fields. It does not scan another browser's database. Parsing and native-import failures omit values; receipts contain only the accepted count and profile name. Cookies are retained by the browser profile, not by Harness Settings or the Session log.

Uploads take explicit base64 file data, a basename, and fresh page/observation/element ids. They set the input without an explicit submit call; page handlers may submit data. Downloads take page-owned ids, never a filesystem path. maxFileBytes defaults to 4194304 and limits decoded transfer bytes; the Provider may impose a smaller limit. Download replies carry exact base64 bytes and a sanitized filename for an inert client save.

<a id="model-experience"></a>
## Model Experience

None, as this controller registers human-facing Remote operations and no model prompt, tool, or Session event.

#### KV Cache effect

No direct model request prefix changes; browser tools own model-visible output.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Profile inventory, rename/delete, and per-tab profile switching are not provided.
- History and network inspection are bounded per-open-page memory, not durable browsing history or a HAR export.
- Authentication establishes Harness access, not an assessment target grant; full Security Research enforcement remains separate.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because this controller delegates state to Browser and validates only its Remote inputs; it retains no independent business projection.
