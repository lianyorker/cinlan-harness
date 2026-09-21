# Agent Note: Cordis-safe FileUploads resolver disposal

Status: implemented

English | [中文](2026-09-22-cordis-safe-file-upload-resolver-disposal.zh.md)

## Problem

FileUploads permits one active Agent resolver. Session Controller owns that registration because the resolver can materialize a cold ordinary Agent while an upload is admitted.

Cordis traceable service methods create caller-bound shadow receivers. A function-valued property can be wrapped when the receiver reads it, so a disposer that compares this.agentResolver with the original function can fail even though the disposer runs. A Session Controller unload followed by reload then sees the stale resolver and rejects the new registration.

The [generic file upload decision](../feature/2026-08-26-generic-file-upload.md) owns transfer, staging, receipt and Session admission semantics. This note owns the registration identity and disposal rule.

## Decision

FileUploads stores an object registration containing the resolver function. Registration rejects a second live object. The disposer clears the slot only when the stored object is the same registration object, so Cordis function wrappers cannot change the comparison identity.

Resolver execution reads the function from the stored registration after the live-Agent lookup misses. Session Controller continues to own the effect that creates and disposes the registration; FileUploads does not retain a second lifecycle or silently replace an active resolver.

## Alternatives considered

**Compare the function through Cordis internals.** Reading an original-service symbol or unwrapping a traceable function would couple FileUploads to vendor proxy details and still leave function identity exposed to another wrapper.

**Replace an active resolver.** Overwriting the slot would hide an effect-ordering or disposal leak and could route an upload to the wrong Session owner.

**Allow a resolver list.** Multiple cold-Agent resolvers would make ownership and lookup order ambiguous. One effect-scoped resolver remains the required association.

## Consequences

Session Controller can unload and reload without a stale resolver blocking publication. A resolver remains single-owner, and disposal is idempotent for the registration object that created it. The public upload and receipt behavior is unchanged.

## Verification

The host lifecycle regression mounts the real FileUploads service through Cordis, invokes registration through its traceable service proxy, disposes the first registration, and admits a second one. The Windows-to-Debian SSH acceptance also disables and re-enables Session Controller in the real Loader composition before exercising cold resume, file access, PTC, terminal cleanup and teardown.
