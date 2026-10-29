---
kind: upgrade-guide
description: "WebFetchBody gains a pdf arm; application/pdf fetches now decode to extracted text."
---

# Web fetch PDF arm

English | [中文](guide.zh.md)

## Change

`WebFetchBody` gains `{ kind: 'pdf', content }`. The `dsh-web-fetch-http` provider now classifies `application/pdf` responses as decodable: it extracts page text through pdf.js, preserves page order, and applies the same byte and character bounds as text bodies. Unparseable PDF bodies fail as `WEB_PROVIDER_ERROR`. The closed union means every consumer `switch`ing on `kind` must handle the new arm or fail compilation through `assertNever`.

## Migration

1. Rebuild consumers that switch on `WebFetchBody.kind`; TypeScript flags every unhandled `pdf` arm. Render extracted text like a `text` body — it carries no markup.
2. Deployments depending on `application/pdf` raising `WEB_UNSUPPORTED_CONTENT_TYPE` must now expect successful fetches with `kind: 'pdf'` instead; gate the behavior by wrapping the provider or filtering results, not by content type.
3. `dsh-web-fetch-http` adds a `pdfjs-dist` runtime dependency; private mirrors of the package set must mirror it too.
