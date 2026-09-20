---
description: "The boot package group: how dsh app bins start — environment loading, profile and patch layers, clear startup failures, and app-owned command lines."
kind: "package-group"
---

# boot/ — shared app-bin boot glue

English | [中文](README.zh.md)

## Summary

The boot group starts dsh applications and manages running-profile composition. `app-boot` loads the environment and patch layers; `cmdline` provides app-owned flags and exit handling. These libraries are imported by `apps/cli` and test-only Loader fixtures. The `plugin-manager` runtime plugin lists profile Plugins and bundles and manages persisted changes and installations. Each package README owns its contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`app-boot`](app-boot/README.md) | Boots a dsh app from a `cordis.yml`: loads `.env`, applies profile and patch layers, and reports startup failures clearly | (library for the bins) |
| [`cmdline`](cmdline/README.md) | Lets the app own its flags, `--help`, and exit code; passes everything after the launcher's flags through verbatim | `cmdlineArgs`, `appExit` |
| [`plugin-manager`](plugin-manager/README.md) | Lists running-profile Plugins and bundles and manages persisted composition and package installation | `pluginManager` |

<a id="related-documentation"></a>
## Related documentation

- [Profile management](../../docs/subsystems/profile-management.md) — generated service and event reference.
- [dsh app](../../apps/cli/README.md) — the `dsh` bin that consumes these helpers for its boot sequence.
- [Profile bundles](../bundle/README.md) — installable patch layers that `dsh --profile` compositions mount.
- [dsh-home-paths](../util/home-paths/README.md) — the harness-home resolver both packages build on.
- [dsh-cmdline](cmdline/README.md) — how an app owns its flag family instead of the launcher.

<a id="dev-note"></a>
## Dev Note

None.
