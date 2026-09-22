---
description: "Pair a phone browser with explicitly selected Sessions and revoke device access from Desktop Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-pairing

English | [中文](README.zh.md)

## Summary

Pair a phone browser from Desktop Settings → Phone pairing. Select one or more Sessions and grant each additional action explicitly; reading is selected by default. Copy the pairing URL, invitation ID, and one-time code to the intended device. Review device permissions and expiry, revoke a device, or disable HTTPS access from the same page.

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

Mount this contribution in the trusted Desktop Client composition alongside Settings, Locale, the generated pairing Remote namespace, and the existing Session controller. This plugin has no configuration fields. The HTTPS provider must remain mounted with its Loader row enabled and listener configuration initially disabled so the Enable action can reach it. The Web and phone compositions must omit this page; the plugin accepts only the `dsh-app:` Desktop carrier, and a paired carrier also prevents registration if it is loaded.

Configure HTTPS in the Host's [remote-access provider](../../remote-access/remote-access/README.md). The page displays the provider's actual missing configuration fields and never creates a certificate, establishes trust, or changes CORS. An unavailable or disabled listener cannot create invitations. A failure displays localized recovery guidance and requires a status refresh before another invitation.

Select exact Session rows before creating an invitation. Sending messages, stopping work, answering questions, and deciding approvals are separate grants. The pairing URL contains no code; the invitation ID and code are separately copyable and remain selectable if clipboard access fails. Cancelling or local expiry removes the displayed invitation. Refresh after pairing to load the new device; revoking refreshes the device list automatically.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The apply closure owns an identity-stable observation source and serialized management callbacks over the official generated Remote methods. The renderer binds that source and the existing Session list to private hooks. Session selections and permission drafts stay local to the component. Invitations stay in memory, expire without a network write, and never enter logs, settings metadata, or persistent browser storage.

The independent section uses the stable id `phone-pairing` and locale namespace `settings.pairing`. Settings metadata contains only public localized labels. Slot declarations, dictionaries, observation timers, and pending requests follow plugin disposal. No invariant companion is published because the UI has no independent durable record to compare with the authoritative provider.

The [Loader suite](tests/loader.client.spec.tsx) uses real Remote codecs, ClientSessions, Settings, Locale, and the production slot renderer. Its external RPC provider is explicitly a fixture; it does not prove real HTTPS, browser trust, or mobile platform behavior. [Observer tests](tests/observation.client.spec.ts) cover expiry, duplicate requests, rejected cancellation, and late settlement during disposal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings](../ui-settings/README.md) — navigation and localized search metadata.
- [Web Client](../../../docs/subsystems/web-client.md) — generated Remote and data ownership.
- [Same-Host phone pairing](../../../.agents/notes/implemented/architecture/2026-09-20-same-host-phone-pairing.md) — transport authority and device grants.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; pairing management does not enter provider requests or automatically send messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- HTTPS certificates, private keys, advertised origin, and phone trust remain deployment-owned. Enable does not repair missing configuration.
- Device changes are loaded on refresh or after revocation; the API supplies no device subscription or invitation-consumed notification.
- QR generation is not included. This browser page does not provide a signed Android or iOS application or installer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Desktop composition owner validates the assembled browser and real HTTPS pairing path separately from the external RPC fixture.

</details>
