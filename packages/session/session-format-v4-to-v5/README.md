---
description: "Adjacent streaming migration and validation from Session format V4 to native V5."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Restore supported V4 Sessions as native V5 without rewriting stored generations. This library provides the adjacent streaming migration from format V4 to format V5, the native V5 physical codec, and target-generation validators. Event JSON, message source attribution, references, and event coordinates are preserved while the Session header advances to format 5.

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

Use the [catalog](../session-format-catalog/README.md) for complete multi-hop restoration. Direct imports serve catalog assembly, codec dispatch, and test fixtures; this library has no Cordis mount configuration.

Its [public exports](src/index.ts) provide the adjacent `sessionFormatV4ToV5` migration declaration, the released V4 source codec, the native V5 codec, and target validators.

Header migration advances metadata without modifying the event body:

```ts
import { sessionFormatV4ToV5 } from '@deepseek-ai/dsh-session-format-v4-to-v5'

const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

<a id="understand-the-implementation"></a>
## Understand the implementation

`sessionFormatV4ToV5` implements the stateful `SessionFormatMigrationStage` interface. The stage iterates events in order, derives the inherited event cut from the terminal inherited `session/end-seed` marker if unsupplied, and verifies that active delivery markers match the source generation. Events pass through without copying or payload mutation.

`releasedV5SessionFormatCodec` wraps V4 physical record framing while asserting the native format 5 header version.

<a id="further-exploration"></a>
## Further Exploration

- [Session format catalog](../session-format-catalog/README.md) — static multi-hop migration chain.
- [Session format library](../session-format/README.md) — core migration types and stage protocol.
- [Adding a Session format version](../../../docs/cookbook/adding-a-session-format-version.md) — version bump procedure.

<a id="model-experience"></a>
## Model Experience

The library performs deterministic format migration without invoking models.

#### Token effect

The conversion changes no request text or token-bearing data.

#### KV Cache effect

The edge preserves exact recorded request blocks and message prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Committed input immutability** — migration never modifies source files in place; persistence writes new generations upon write-open.
- **Delivery generation isolation** — historical delivery markers from generation 4 remain uninterpreted and are not activated as generation 5 watermarks.
- **Seeded cut derivation** — seeded sessions without an inherited end-seed marker refuse migration rather than guessing an inherited cut.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
