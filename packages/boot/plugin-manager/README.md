---
description: "Install, enable, disable, and remove bundles from the current Web profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-manager

English | [中文](README.zh.md)

## Summary

Manage the current Web profile's installed bundles and individually addressable plugins. Installations can stream diagnostics, stop on request, and restore the manifest and lockfile after failure or cancellation. Live profiles apply configuration changes immediately; startup-only profiles retain their running composition until restart. Changes affect every session using the profile. Desktop package transactions remain owned by the Desktop shell.

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

The Web composition mounts this service beside the Host plugin inventory. The launcher provides the current profile through `profileContext`. The service's Remote methods expose bundle inspection, installation, removal, enablement, and cancellation to trusted clients. Plugin configuration forms remain owned by their settings namespaces and client plugins.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `pnpmCommand` | `pnpm` | Pnpm executable name or path; an application-supplied invocation takes precedence. |
| `inspectTimeoutMs` | `20000` | Maximum registry lookup duration in milliseconds. |
| `outputBytes` | `16384` | Maximum returned diagnostic bytes; the complete output remains in the returned log path. |
| `lockWaitMs` | `120000` | Maximum profile writer-lock wait in milliseconds. |

A plugin toggle changes only the last matching override's `disabled` field in the profile patch, or appends an override. A bundle toggle changes the ordered `dsh.profile.bundles` list while retaining dependencies. Enabling appends a bundle, so it can change precedence. Home and invocation patches keep their higher priority.

Installation enables a valid bundle by default. A caller-generated request id connects progress, log chunks, and cancellation to one installation. Cancellation reports success only after pnpm exits and the manifest and lockfile have been restored. Once activation starts, cancellation returns `too-late`. Failed installation restores those two files; downloaded files and diagnostic logs may remain.

When pnpm blocks dependency scripts, the result lists pending package names. A retry can explicitly approve those names through `approvedBuilds`. Approval persists by package name in the profile's pnpm workspace settings and survives a later installation failure. Existing denials, wildcard rules, aliases, and anchors cannot be overridden through this action. Approved scripts execute with the host user's permissions.

Removal deselects the bundle, waits for its runtime contributions to unload, then runs pnpm removal. A failed stage stops the operation and preserves earlier completed stages. Packages still in use cannot be removed. Management components cannot disable themselves.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The manager writes profile files under the shared manifest file lock. Pnpm executes outside the configuration queue; bundle selection and Loader reconciliation execute inside it. The existing config-only Cordis HMR watchers use the same queue for profile and home patches and manifest selection changes. Each reload keeps the local module resolver and refreshes its profile links, then awaits both removed resources and the resulting Loader tree. Unchanged inactive entries produce warnings; newly failing entries and inactive explicit enablement targets fail the change.

Every mutating Remote checks the launcher and profile identity before acquiring a lock or touching files. A launcher-provided `pluginManagementHost` permits individual row enablement with protected row ids and an application-owned patch reader. Desktop refuses bundle selection and package operations, including registry inspection; its native shell owns those transactions. Its patch reader preserves mandatory overlays without modifying shared CLI resolver links. Module-code HMR must have empty roots while managing packages because the vendored module reloader has its own scheduler. No invariant companion is published: the manager reads files and Loader state directly and owns no independent projection.

The public records live in [types.ts](src/types.ts). [operations.ts](src/operations.ts) owns subprocess output, environment scrubbing, and package reconciliation; [patch.ts](src/patch.ts) preserves YAML comments and unrelated fields; [build-approval.ts](src/build-approval.ts) owns explicit script permissions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [App boot](../app-boot/README.md) — profile layers, reload policy, and module resolution.
- [Plugin inventory](../../host/plugin-inventory/README.md) — current Loader and preset observations.
- [Plugin settings](../../client/ui-settings-plugins/README.md) — configuration forms in Settings.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the managed plugins whose own tools and prompt contributions enter later model requests.

#### KV Cache effect

Management adds no model request content. Enabling or disabling a plugin can change later tool declarations or prompt contributions and their cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Desktop transactions use the shell's existing exclusive staging, health-check, and activation path.
- Replacing a loaded JavaScript package requires process restart for a fresh module generation.
- Startup-only profiles cannot remove packages that the running process still uses.
- Management is profile-wide; agent-preset composition remains read-only.
- A failed removal may leave partially changed dependencies. Installation restoration does not remove downloaded files or diagnostic logs.
- This integration exposes no agent tool and declares no optional-bundle catalog; inventory records report `optional: false`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
