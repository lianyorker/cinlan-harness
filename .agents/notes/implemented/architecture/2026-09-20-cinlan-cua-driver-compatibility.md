# Agent Note: Cinlan and Cua Driver Computer Use compatibility

Status: implemented

English | [中文](2026-09-20-cinlan-cua-driver-compatibility.zh.md)

## Problem

Cinlan consumers depend on application and window ids, observation-scoped actions, per-call provider selection, and provider-specific permission checks. Cua Driver exposes its own tools through an exclusive desktop registration. Replacing the Cinlan service with a name-only registry removes those APIs; allowing both stacks to run admits competing desktop input during startup or teardown.

## Decision

The [provider-registration decision](2026-09-12-computer-use-provider-registration.md) owns the two Cua Driver transports and upstream tool semantics. This note owns compatibility with Cinlan providers and the local MCP lifecycle.

The [Computer Use runtime](../../../../packages/computer-use/computer-use/README.md) retains its provider facade and adds the official exclusive registration API. A Cua Driver registration rejects every existing facade provider, even an unavailable one; facade registration rejects an exclusive owner. Existing multiple-provider selection remains valid within the Cinlan API. The two [experimental](../../../../packages/experimental/computer-use-cua-driver-mcp/README.md) [adapters](../../../../packages/experimental/computer-use-cua-driver-native/README.md) remain explicit composition choices and publish upstream tool schemas through the shared MCP result adapter.

Each provider retains registration until owned operations settle. Cordis effect disposers are yielded directly so teardown remains ordered. Cinlan joins its CLI calls before unregistering; native Cua removes tools, aborts work, joins calls, and shuts down its SDK before release. The MCP adapter reads the local connection snapshot after shutdown; a close timeout retains desktop ownership, matching the MCP client's retained namespace. Native shutdown failure also retains ownership. Restarting the Host is the recovery path when shutdown cannot be confirmed.

Cinlan permission consumers remain specific to Cinlan requests. Selecting Cua Driver requires its own explicit composition and upstream permissions; it does not activate Cinlan's six model schemas or alter the shipped defaults. The [device readiness decision](../feature/2026-09-12-device-profile-and-provider-readiness.md) remains the owner of Cinlan profile and Settings behavior.

## Alternatives considered

**Replace the shared service with the official registry.** This would remove current Cinlan public methods, request types, provider selection, and consumer behavior. An additive API preserves those consumers without inventing mappings between incompatible action models.

**Register both stacks independently.** Independent registrations cannot prevent native input from overlapping a Cinlan operation during disposal. Mutual exclusion belongs in both service registration methods, and release follows provider quiescence.

**Copy the official MCP lifecycle unchanged.** The local MCP client can resolve disposal with a `close-timeout` observation. Treating that settlement as confirmed shutdown would release computer use while the transport namespace remains reserved.

## Consequences

Callers can select either Cua Driver transport without changing the Cinlan public API. They must unload the Cinlan provider and its dedicated consumers before activating Cua Driver. A shared registration does not serialize independent Sessions within the chosen driver, reserve windows, grant OS permissions, or roll back delivered input.

## Verification

Keyless provider and Loader tests use a mock native SDK or a local stdio fixture with fixed PNG bytes. They cover catalog validation, activation rollback, durable image projection, cancellation, dependency restart, duplicate registration, close failure, and Cinlan disposal ordering. The two owner-local recorded scenarios use the same synthetic external drivers. Real desktop input, screenshots of host windows, OS permission grants, and live platform compatibility are outside this verification.
