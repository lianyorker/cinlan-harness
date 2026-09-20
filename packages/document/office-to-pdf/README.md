---
description: "Convert authorized Office files to bounded, cached PDFs on the Host."
kind: "package-reference"
---

# @deepseek-ai/dsh-office-to-pdf

English | [中文](README.zh.md)

## Summary

Convert DOC, DOCX, XLS, XLSX, PPT, and PPTX files to PDFs on the Host computer. Concurrent callers share conversion and cached results within configured limits. Browser previews retain the original source identity, and callers receive independent PDF bytes. Conversion uses the independently published LibreOffice kit and does not modify the Office file.

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

Mount `@deepseek-ai/dsh-office-to-pdf` as a `cordis.yml` row. Local file previews also require the [Workspace Files](../../api/workspace-files/README.md) service and its filesystem, sandbox policy, and Typert dependencies.

In-process callers submit authorized source identity, version, optional byte size, a deferred bounded read, extension, and priority through `ctx.officeToPdf.convert()`. A source version change rejects conversion. Each result contains caller-owned PDF bytes, missing font names, a content cache key, and the provider generation. Cancellation rejects with its reason; conversion failures use `OfficeToPdfError`.

The `officeToPdf.render` Remote method accepts the Session identity, Office path, and priority. The Host resolves that identity to the local Agent and applies ordinary workspace-file authorization before checking the cache. Responses retain the source path and version and carry base64 PDF bytes, missing fonts, and the provider generation. `officeToPdf.generation` reports the current generation; replacement of the provider invalidates earlier rendering identities.

| Field | Default | Meaning |
|---|---|---|
| `maxConcurrentConversions` | `2` | Maximum active converters. |
| `maxQueuedJobs` | `8` | Maximum queued metadata-only jobs. |
| `maxReaders` | `32` | Maximum outstanding readers; the final allowance is reserved for foreground work. |
| `maxSourceBytes` | `104857600` | Total source-byte reservations; must cover `maxInputBytes`. |
| `maxBackgroundConversions` | `1` | Maximum active background jobs; zero refuses background admission. |
| `maxCachedEntries` / `maxCachedBytes` | `8` / `134217728` | Retained PDF count and bytes. |
| `maxSourceEntries` | `64` | Maximum retained source-version aliases. |
| `timeoutMs` | `60000` | Kit conversion deadline, excluding the queue. |
| `maxInputBytes` / `maxOutputBytes` | `52428800` / `104857600` | Maximum source and complete PDF bytes. |
| `maxImageResolution` | `192` | Maximum exported raster-image DPI. |

[Config](src/index.ts) also defines archive and font limits. `fontDirectories` accepts absolute paths; omission retains kit platform defaults. `fontFallbacks` replaces the kit preference groups, with at least two nonblank names per group. The runtime dependency is `@deepseek-ai/libreoffice-kit` version `0.0.1`; its published optional dependencies declare the native Windows x64 and ARM64 engines.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[The queue](src/queue.ts) admits metadata before reading bytes. Known sizes reserve their stat size; unknown sizes reserve the input limit. Foreground work precedes queued background work, can promote shared prewarming, and can evict queued speculation. Readers cancel independently; the final reader cancels shared work. Active reservations remain held until reads, conversion, and cleanup settle.

Successful PDFs are retained by provider generation, extension, and SHA-256 of source bytes. A bounded source-version index avoids repeated reads after authorization; distinct paths can share content conversion. Least-recently-used eviction removes PDFs and their aliases. Failures and oversized cache entries are not retained. Completed alias hits consume no outstanding-reader allowance, including when background admission is disabled.

Each active slot lazily creates and reuses a kit converter. The provider writes input to a private temporary directory, [validates and bounds the PDF](src/output.ts), and removes scratch files before conversion settles. Unload cancels and joins authorization, conversion, and converter disposal. No runtime invariant companion is published because these operations and their scratch files have one lifetime owner.

Remote reads verify the source identity before and after the reserved filesystem read. Authorization failures pass through; conversion failures return `document-render/failed` with a classified reason and no engine diagnostics. [The real conversion test](tests/conversion.spec.ts) loads the services through Loader and checks document text and tables, spreadsheet values, and slide order with PDF.js using [deterministic OOXML samples](tests/fixtures/office.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workspace Files](../../api/workspace-files/README.md) — local Session file authorization and bounded reads.
- [Architecture](../../../docs/architecture.md) — Cordis composition and application launch.
- [Testing](../../../docs/testing.md) — source and artifact verification.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package converts bytes without model-facing tools, messages, or Session events.

#### KV Cache effect

None; conversion does not construct or modify model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Conversion fidelity, fonts, and native engine assets belong to `@deepseek-ai/libreoffice-kit`; this provider does not search for system LibreOffice or download an engine at runtime.
- Queue waiting is outside `timeoutMs`. Limits cover owned requests and payloads, not engine RSS, base64 transport expansion, caller-retained results, or browser PDF rendering.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
