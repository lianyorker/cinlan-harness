---
description: "Artifact metadata and storage providers for evidence, reports, and recordings."
kind: "package-group"
---

# artifact/ — durable artifact capability family

English | [中文](README.zh.md)

## Summary

Define scoped artifact references and store immutable evidence bytes through interchangeable providers.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`artifact/`](artifact/README.md) | Artifact metadata, authorization, provenance, retention, and redaction types |
| [`artifact-memory/`](artifact-memory/README.md) | Process-local provider for published artifact objects |
| [`artifact-local/`](artifact-local/README.md) | Filesystem provider with scoped, verified, bounded reads and writes |

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No standalone subsystem page exists for this package group; artifact contracts live with the group and package READMEs.

</details>
