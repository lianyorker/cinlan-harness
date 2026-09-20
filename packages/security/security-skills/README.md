---
description: "Install, update, cancel, and remove verified security skill resources used by the Harness skill registry."
kind: "package-reference"
---
# @deepseek-ai/dsh-security-skills

English | [中文](README.zh.md)

## Summary

Install security research guidance and supporting files, inspect their version, and replace them without interrupting an Agent that already loaded a skill. Network downloads require an explicitly configured release manifest. Application-bundled resources can be installed separately and retain their bundled provenance. Installation never runs resource scripts or grants assessment authorization.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-security-skills/resources` once in the Host composition, alongside the official skill registry. Mount the package's main provider globally or in an Agent scope. The shipped Web application includes both, making installed skills available to ordinary Sessions; a custom headless composition must mount the manager and provider explicitly. The browser-safe `/types` subpath exports management DTOs without Host runtime imports.

A home without an active installation reports `not-installed` and exposes no security skill candidates. `installBundled()` installs the audited package inventory without a network request. `install()`, `reinstall()`, and `update()` use the configured release endpoint. The Host retains operations after a client disconnects; only explicit cancellation or manager disposal stops them. Cancellation includes an operation identity so a stale button cannot cancel a newer download. Cancellation waits for settlement; an already-committed activation remains installed.

| Manager configuration | Default | Meaning |
|---|---|---|
| `releaseManifestUrl` | Unset | Network management reports unavailable until a deployment provides a real manifest URL. HTTPS is required except for loopback HTTP. |
| `root` | `DSH_HOME/resources/security-skills` | Absolute resource store; ordinary skill directories are not modified. |
| `maxArchiveBytes` | 64 MiB | Maximum network archive size. |
| `maxExpandedBytes` | 256 MiB | Maximum expanded installation bytes. |
| `maxFiles` | 10,000 | Maximum resource archive entries. |
| `downloadTimeoutMs` | 120,000 | Timeout for each manifest or archive request, including redirects. |

The manager validates the configured endpoint at load. Installation accepts a schema-1 manifest with an archive SHA-256, exact byte count, canonical file inventory, and skill inventory. The archive contains `skills/` plus license notices. All skill frontmatter and file hashes must validate before the active version changes. A failed operation reports a safe public error and preserves the committed version; detailed causes remain in Host logs.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [manager](src/resources.ts) stages private resource bytes and publishes immutable generations through an atomic active record. The [store](src/resource-store.ts) coordinates multiple Hosts with a short filesystem lock and compares the previously observed revision at commit. The revision advances on activation and removal, so an older transaction cannot overwrite another Host's update or resurrect resources after removal. Moving the generation and committing its active record share that lock. Status reads and filesystem notifications refresh the active record.

The [provider](src/index.ts) withdraws old directory registrations when the generation changes. Loading a skill retains a persistent generation lease until its enclosing realm is disposed, including across provider reloads. An unscoped global provider retains loaded generations until the Host stops; ending one Session does not release those leases. Collection checks the durable active record and every generation lease. Startup reclaims inactive generations only when all remaining lease owners are certainly dead, and removes abandoned staging only when its owner process is certainly dead; unknown owners and reused process identifiers retain their files.

The [inventory](src/resource-inventory.ts) applies the same path filtering and UTF-8 newline normalization to bundled installation and release packaging. Bundled installations include LICENSE and NOTICE and report `source.kind = bundled`; their content-derived version does not imply a network download. The [archive validator](src/resource-files.ts) rejects traversal, duplicate or colliding paths, links, special files, malformed ZIP records, and expansion beyond configured limits.

</details>

<a id="model-experience"></a>
## Model Experience

Indirectly, through the official skill consumer. Installed entries contribute discovery metadata; selected skills contribute bodies and directory resources. Resource management adds no tool, system-prompt text, or assessment authority. The official skill consumer owns logging of loaded model-visible content.

#### KV Cache effect

No direct effect. Changing installed resources changes subsequent skill discovery and selected bodies; already logged skill content remains in its Session.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- No public release endpoint is assumed. Operators supply and trust the HTTPS manifest origin; SHA-256 verifies consistency, not an independent publisher signature.
- Archives use ZIP32 stored or deflate entries. Encrypted, split, and ZIP64 archives are rejected. Resource scripts are copied as data and are never executed during installation.
- Crashed writer locks require operator recovery after confirming the owner stopped. Unknown staging and leases are retained conservatively; abandoned files can occupy disk space.
- Skill content is guidance. Authorization remains with the assessment-scope service, and resource management does not edit findings or reports.

No runtime invariant companion is published: committed resource identity and lease ownership are enforced by the same locked store operations, while registry uniqueness and effect disposal remain owned by the official skill registry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The source assets remain audit inputs. Preserve their licensing and the shared inventory rules when changing release packaging. The [model-visible regression](tests/model-visible.spec.ts) runs bundled installation, official skill calls, and a real Agent turn, then reopens the persisted Session and compares the full instruction bodies with [recorded expected output](tests/expected/managed-security-skills.json).

</details>
