# Agent Note: Feature-owned capability settings registration

Status: implemented

English | [中文](2026-09-24-feature-owned-capability-settings.zh.md)

## Problem

The capability settings package presents browser, computer, mobile and security domains. A single registration fiber that injects every Remote couples unrelated pages to optional services and gives observers and section metadata a package-wide lifetime.

## Decision

`ui-settings-security` is still one Client package and keeps the shared locale and renderer contract. Its root plugin injects only `locale` and mounts four child plugins: `browser-registration.ts`, `computer-registration.ts`, `mobile-registration.ts`, and `security-registration.ts`.

Each child owns the scopes, runtime observers, feature Remote calls, settings metadata, section and icon registrations, connection-reset listeners, and disposal for its domain. `capability-registration.ts` and `capability-shared.ts` provide shared inventory and provider-activation helpers without importing sibling feature values. Cross-feature communication uses Cordis services and slots.

A missing required Remote leaves its owning child pending or unavailable while unrelated child fibers continue to register and dispose normally. Each child has its own effect lifetime, so its registrations leave with that child.

## Alternatives considered

**Keep one all-domain registration fiber.** Rejected: one missing optional capability service can delay unrelated pages and couples independent observer lifetimes.

**Create four npm packages immediately.** Deferred: the current package still owns the shared locale, renderer boundary, and product roster; package extraction can follow an independently versioned public contract.

**Import one feature registration from another.** Rejected: sibling runtime imports make feature ownership implicit and prevent independent loading. Shared behavior remains in narrow infrastructure helpers.

## Consequences

Feature files can evolve toward separate packages without moving their runtime ownership first. Each feature factory requires only its own inputs; `CapabilitySectionInjected` is their union, and the renderer narrows the derived `InjectFace` union by capability id. The root assembly stays small and does not read inventory or presets eagerly.

## Verification

`packages/client/ui-settings-security/tests/apply.client.spec.ts` verifies feature injection isolation, registration disposal, metadata lifetime, and independent action callbacks. The Loader composition test boots the actual Client plugin through a test-only `cordis.yml`, mocks external Remotes, and verifies that feature registration remains available when an unrelated Remote is absent.

## Related decisions

This Note partially supersedes the registration-ownership alternative in [Computer Use settings presentation](../feature/2026-09-12-computer-use-settings-presentation.md). That Note still owns the page presentation and device-readiness decisions. [Feature-owned settings navigation metadata](2026-09-17-settings-navigation-metadata.md) owns metadata semantics; this Note adds the child-fiber ownership and dependency lifetime.
