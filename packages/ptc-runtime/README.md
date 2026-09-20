---
description: "Package map for optional PTC execution through managed Node processes and the existing CodeRuntime consumer API."
kind: "package-group"
---

# ptc-runtime/ — Optional Node program execution

English | [中文](README.zh.md)

## Summary

This group supplies the PTC service and a Node process provider for custom execution compositions, including POSIX SSH. Programs call host bindings and return captured logs and JSON values. A separate adapter connects existing CodeRuntime consumers to this provider; the shipped worker-thread runtime remains the default.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the service interface for direct consumers and the provider for a composed runtime.

| Package | Role | Service |
|---|---|---|
| [ptc-runtime](ptc-runtime/README.md) | Defines explicit request resolution, bindings, execution results and cancellation | `ctx.ptcRuntime` |
| [ptc-runtime-node](ptc-runtime-node/README.md) | Executes programs in managed Node processes and exposes an optional CodeRuntime adapter | `ctx.ptcRuntime`; optional `ctx.codeRuntime` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Existing code runtimes](../code-runtime/README.md) — the default worker-thread execution family.
- [SSH providers](../ssh/README.md) — shared remote filesystem, process and sandbox coordinates.
- [Capability seams](../../docs/capability-seams.md) — service definitions, providers and consumers.

<a id="dev-note"></a>
## Dev Note

The optional adapter preserves the existing CodeRuntime interface. Its package README owns differences in failure categories, policy selection and result metadata.
