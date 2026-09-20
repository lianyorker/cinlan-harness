# Agent Note: Native browser runtime management

Status: implemented

English | [中文](2026-09-20-native-browser-runtime-management.zh.md)

## Problem

Plugin activation does not establish that a browser executable exists, and listing pages launches a persistent context. Component downloads need cancellation and repair without destroying a working browser or depending on the lifetime of a Settings view.

## Decision

The Playwright package owns a separate runtime service and the existing native provider. Its status reports file presence, provider activation, and context state independently. The authenticated Browser controller exposes detection, installation, reinstall, removal, exact-task cancellation, and explicit context closure. Plugin management remains the only activation owner; component installation neither starts a browser nor grants model tool permissions.

The installer is the exact pinned Playwright package and uses its platform registry, maintained CLI, upstream URLs, extraction, and completion markers. A subprocess-local environment selects an application-private generation directory. Reinstall commits the active-generation file only after installation completes; failure or cancellation preserves the prior generation. The provider resolves that committed executable explicitly for both headed and headless Chromium. System Chrome and Edge remain alternatives outside component management.

Tasks belong to the Host and survive view unmount or Remote detach. Cancellation addresses one branded task id and waits for process-range termination and staging cleanup. Terminal status is published after cleanup. A shared filesystem lease excludes another Host while a browser context or component operation uses the same runtime directory. Profiles remain separate from binaries and survive removal.

## Alternatives considered

**Use page listing as readiness.** It launches a browser and cannot distinguish plugin activation from file availability.

**Run a system browser installer or choose an arbitrary latest Chromium archive.** System installers mutate external software, while arbitrary versions can diverge from the pinned Playwright driver. The maintained pinned installer owns platform/version selection.

**Overwrite the active cache during repair.** Interrupted extraction can destroy the only working executable. Private generations preserve it until the active-file commit.

**Put installation in a Remote request lifetime.** Navigation and reconnect would cancel user-authorized Host work; explicit task cancellation makes that action unambiguous.

## Consequences

File presence and completion markers do not prove executable integrity or successful launch. Installer progress describes the current archive and can reset for auxiliary downloads. Completed old generations remain until explicit removal. Host restart does not resume tasks; abrupt termination can leave a lease requiring operator verification before manual recovery. Corrupt active-generation metadata fails loudly and can be recovered through explicit component removal; the Settings error view does not yet expose that recovery.

The [native browser operations decision](../feature/2026-09-13-native-browser-operations.md) remains active for cookies, transfers, and profile isolation. This record adds component ownership rather than superseding that rationale. The Web sidebar iframe retains independent cookies, page identities, and login state.

## Verification

Loader/controller tests cover non-launching detection, Remote-detach independence, exact-task cancellation, process quiescence, and failed-reinstall preservation. Filesystem tests cover cross-manager leases, commit ordering, symlink-safe removal, and profile preservation. An opt-in real Loader test exercises system or managed Chromium with an isolated profile, loopback navigation, observation, context closure, and cleanup. Official-download execution depends on reachable upstream URLs and an explicitly configured legitimate proxy where required.
