---
description: "Package map for Host document conversion used by authorized workspace previews."
kind: "package-group"
---

# document/ — document conversion

English | [中文](README.zh.md)

## Summary

This group supplies Host document conversion for workspace previews. Its Office converter produces bounded, cached PDF results without changing source files. Workspace Files owns Session authorization; the converter owns queued work, cancellation and output bytes. The package README documents supported formats, limits and native engine requirements.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Service |
|---|---|---|
| [office-to-pdf](office-to-pdf/README.md) | Converts authorized Office sources to PDF for previews | `ctx.officeToPdf` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Workspace subsystem](../../docs/subsystems/workspace.md) — workspace services and the Office conversion API.
- [Workspace Files](../api/workspace-files/README.md) — local Session authorization and bounded source reads.
- [Configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-office-to-pdf) — accepted converter configuration fields.

<a id="dev-note"></a>
## Dev Note

None.
