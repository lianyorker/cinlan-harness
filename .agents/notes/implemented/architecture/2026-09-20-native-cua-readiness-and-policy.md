# Agent Note: Native CUA readiness and permission policy

Status: implemented

English | [中文](2026-09-20-native-cua-readiness-and-policy.zh.md)

## Problem

A registered desktop provider does not prove that SDK discovery has completed. Native Cua Driver tools do not implement the facade capability descriptor, and a policy that recognizes only six facade tool names leaves native calls unguarded. Settings need truthful lifecycle information without claiming OS permission or successful desktop input.

## Decision

The [computer-use service](../../../../packages/computer-use/computer-use/README.md) accepts an optional readiness callback on its exclusive registration. Its readiness result distinguishes a provider-owned tool catalog from facade capabilities. Missing callbacks report initializing. The native provider publishes ready only after nonempty catalog discovery, tool registration, and prompt registration complete. Disposal removes advertised readiness immediately; shutdown failure remains failed and reserves computer use until quiescence is proven. Successful startup rollback releases the reservation after cleanup.

The [device controller](../../../../packages/api/device-capabilities-controller/README.md) exposes the discriminated computer observation and redacted lifecycle reasons. Catalog readiness, OS permissions, approval, and observed action success are separate facts. Native permissions remain unknown. CUA tools keep upstream schemas and results rather than invented facade action DTOs.

[Capability Settings](../../../../packages/client/ui-settings-security/README.md) displays catalog lifecycle separately from permission status. Provider enable/disable controls call the official Plugin Manager with an exact configured Loader entry id and display its application outcome. Settings does not introduce a second activation flag or approval system; enabling a provider does not perform desktop input.

The [permission policy](../../../../packages/computer-use/computer-use-permission-policy/README.md) applies one native allow/ask/deny decision, default ask, to every tool whose name starts with cua_driver_native__, including future additions. The official pre-execute decision and monotonic executor guard share a ticket for the exact execution. An earlier waterfall allow cannot bypass ask or deny. The four facade policy classes remain supported.

The [bundle](../../../../packages/bundle/cinlan-computer-use/README.md) selects cua-driver-native and mounts only the service, policy, and native provider. The SDK is pinned to @trycua/cua-driver 0.28.0 and arrives through npm platform dependencies; no separate downloader, Orca CLI, or native service is introduced. The explicit [public experimental package exception](../../../../scripts/experimental-package-policy.ts) permits release composition without promising stable upstream tools.

The [registration decision](2026-09-12-computer-use-provider-registration.md) retains desktop exclusivity and shared-desktop rationale. The [compatibility decision](2026-09-20-cinlan-cua-driver-compatibility.md) retains facade and MCP lifecycle ownership. This note supersedes their native composition and policy facts only. The [device readiness decision](../feature/2026-09-12-device-profile-and-provider-readiness.md) retains mobile, Settings, and profile ownership.

Default Web and Desktop profiles compose the Browser and Computer Use bundles, followed by a [configuration-only defaults layer](../../../../packages/bundle/web-capability-defaults/README.md) that disables exactly `browser-playwright` and `computer-use-cua-driver-native`. Services, management, policy, and configured entry identities remain available for Settings. User profile patches follow that layer, so official Plugin Manager enablement overrides the defaults without a second activation flag. Explicit `browser` and `device-control` profiles retain enabled providers; Mobile composition is unchanged. The exact installed Web `[base, web-app]` tuple upgrades to the default stack without rewriting user patches. Desktop upgrades its owned built-in prefix through the existing verified staging transaction, retaining installed third-party bundles and patch bytes; identical releases still reconcile when defaults differ.

## Alternatives considered

Treating providerName as ready would report availability during discovery and teardown. Mapping CUA into facade action requests would discard upstream semantics without a consumer needing that translation. A fixed native tool allowlist would omit future SDK tools from enforcement. Replacing the SDK with a custom Windows provider is unsupported by the current evidence: the pinned SDK publishes Windows x64 and arm64 packages.

## Consequences

The host owns the in-process native runtime and its crash risk. Windows requires a logged-on graphical session; UIPI and upstream background refusals remain effective. Refusal does not authorize a foreground retry. Cancellation cannot undo delivered input. The wrapper is MIT licensed; platform payloads declare MIT AND MPL-2.0 and retain the UniFFI N-API runtime notice. Distribution must preserve native files, notices, optional dependencies, and relative loading paths; [provider requirements](../../../../packages/experimental/computer-use-cua-driver-native/README.md) own those details.

## Verification

Service, policy, API, and native Loader tests cover readiness publication, default approval, denial before native execution, catalog validation, cancellation, and reservation through teardown. Mock SDK fixtures establish those integration behaviors without proving desktop operations. Controlled Windows GUI smoke through the Harness Loader and packaged native loading remain separate verification obligations; catalog discovery alone proves neither.
