# Agent Note: Scoped Fetch resource paths on Connection

Status: implemented

English | [中文](2026-09-17-scoped-fetch-resources.zh.md)

## Problem

Sidebar HTML preview needs to load a document and its relative CSS, images, and JavaScript under the same Session. A URL such as `/api/sidebar/html/<session>/<absolute-path>` keeps that context in the resource hierarchy: `styles/site.css` beside `/api/sidebar/html/session-1//workspace/site/index.html` resolves to `/api/sidebar/html/session-1//workspace/site/styles/site.css`. Putting the Session and file path only in query parameters loses them when the browser resolves a relative resource reference.

Connection already owns authenticated Fetch dispatch alongside Remote calls. Registering each possible file separately cannot represent a document directory whose descendants are requested by the browser. That consumer needs a scoped path prefix while existing exact registrations retain their matching and uniqueness rules.

## Decision

[ConnectionFetchRoute](../../../../packages/client/connection/src/rpc.ts) exposes only `match?: 'exact' | 'prefix'` for this choice. Omission means exact. Explicit prefix registrations name a valid endpoint namespace below `/api` and end in `/`, such as `/api/sidebar/html/`. The existing endpoint parser validates the namespace before that final slash; `/api/` alone and malformed namespaces are rejected. The trailing slash keeps similarly named siblings outside the contribution.

Matching uses the literal `URL.pathname`. Connection does not decode the resource suffix or rewrite the request URL. Exact registration wins before prefixes; among matching prefixes, the longest wins. Selection precedes method validation, so a disallowed method returns 404 without trying a broader prefix or the RPC interceptor. Body-mode selection uses the same route selection and keeps the buffered default for denied methods. The [Connection README](../../../../packages/client/connection/README.md) owns the complete registration behavior.

Both modes use one path-keyed registry and the same caller-fiber effects. Disposing a contribution withdraws admission; the carrier and handler still own accepted requests, their abort signals, response streams, and settlement. Authentication and Host/Origin checks run before shared dispatch. Prefix matching adds no authentication path, listener, transport, or request/response adapter, and does not change generation or body-limit ownership.

This decision extends the route-matching facts in the [Remote method note](2026-08-02-typert-remote-method-calls.md), [boot and transport note](2026-07-24-web-config-tree-boot-and-transport-layering.md), and [client loading note](2026-07-23-client-plugin-loading-model.md). Their Remote, boot, and loading decisions remain active.

## Alternatives considered

**An exact route with query-only resource identity.** Relative references replace the document filename and discard its query, so nested resources lose the Session and directory context. Rewriting document references would also make the preview owner responsible for references inside CSS and JavaScript instead of using browser URL resolution.

**A separate Sidebar transport or router.** A private transport, second listener, or fabricated Node request/response adapter would duplicate Connection authentication, cancellation, and body handling. The existing Fetch registration needs only an explicit prefix mode for this consumer.

**Method-based fallback after a pathname match.** Letting a broader route or the RPC interceptor receive a method rejected by the selected owner bypasses that owner's method restriction. Route selection therefore establishes ownership before method validation.

## Consequences

Relative resources retain their Session and directory context through ordinary URL resolution, and exact consumers keep their default behavior. The API gains one explicit matching choice without introducing wildcard patterns, parameters, or another registry. Feature handlers still validate Session access and resource paths; matching a prefix grants no file access and performs no path decoding.

## Testing

The [registry tests](../../../../packages/client/connection/tests/fetch-routes.host.spec.ts) cover default exact matching, registration validation and uniqueness, precedence independent of registration order, literal escapes and lookalikes, method denial, unregistering, fiber withdrawal, and signal/response ownership. The [Loader composition tests](../../../../packages/client/connection/tests/fetch-routes-loader.host.spec.ts) exercise real Connection and HTTP dispatch with browser authentication, relative resource requests, route disable/re-enable, selected body modes and limits, and cancellation of a late response after client disconnect. These checks establish Connection behavior and its authenticated HTTP composition.
