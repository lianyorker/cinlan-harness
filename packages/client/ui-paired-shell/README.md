---
description: "Restricted phone shell for authorized Sessions over the paired Desktop carrier."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-paired-shell

English | [中文](README.zh.md)

## Summary

This Client plugin displays authorized Session selection and the existing Conversation UI in a phone-sized layout. Authentication, Session grants, and revocation belong to [Remote Access](../../remote-access/remote-access/README.md). The shell does not grant authority.

## Table of Contents

- [Composition](#composition)
- [Lifecycle and data](#lifecycle-and-data)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="composition"></a>
## Composition

[Desktop](../../../apps/desktop/README.md#paired-phone-access) serves this entry only in its restricted paired graph. Its Host entry is inert. Do not mount the Client entry beside the ordinary layout plugin: both own the root slot. The paired graph includes the module loader, transport and Remote infrastructure, Session controller, memory-only Settings base, locale, keyboard, theme, renderer, Session and Conversation UI, chat, tool results, approvals, and questions.

The shell renders the existing conversation for a selected authorized Session. It does not install settings pages, workspace browsing, model selection, plugin management, commands, or HMR. The file-upload dependency satisfies Conversation injection; the paired Host policy still rejects upload operations.

<a id="lifecycle-and-data"></a>
## Lifecycle and data

Session lists and selections come from the existing Session controller and framework hooks. A read-only workspace projection derives only from authorized Session summaries, and directory or workspace mutations fail locally. Theme presentation is an owned effect that restores prior DOM state on disposal. Root slots, dictionaries, and the workspace adapter follow Cordis disposal.

The paired transport explicitly reports non-local authority, including on a loopback HTTPS origin. The Settings base uses memory mode and does not read or write Host settings. Session authorization remains enforced by the Host for every operation and event; removing a control from the shell is not an authorization check.

<a id="model-experience"></a>
## Model Experience

None, as this presentation package registers no model tools, prompts, or parameters and delegates user messages and interactions to the existing Session and Conversation paths.

#### KV Cache effect

None. The shell contributes no model-visible prefix or prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The shell operates on Sessions explicitly shared by the trusted Host. It cannot create workspaces, browse Host directories, upload files, or change Host configuration. The transport requires separately configured HTTPS and a valid paired-device grant. A browser test does not establish a signed native Android or iOS application.

The package has no invariant companion because it does not own an independently mutable business registry: Session state and permissions remain with their existing owners. Its lifecycle tests exercise actual Client Loader composition and existing conversation interactions.

### Dev Note

Keep the [Web Client layering](../../../docs/subsystems/web-client.md) and [slot ownership](../../../docs/subsystems/slots.md) intact. Presentation changes belong here; carrier authorization and exact asset exposure belong to their Host owners.
