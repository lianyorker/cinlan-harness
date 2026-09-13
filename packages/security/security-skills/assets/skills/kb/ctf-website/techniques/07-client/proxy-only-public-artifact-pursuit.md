# Proxy-Only Public Artifact Pursuit

## Scenario

Use this method when a web artifact is offline or short-lived and recovery must use public registries, indexes, and source mirrors without exposing the analysis host or contacting the original target infrastructure.

## Network boundary
- Require an explicit HTTP(S) proxy URL and accept only loopback proxy hosts with an explicit port.

- Reject proxy credentials in persisted configuration and reports.
- Disable environment and platform proxy-bypass behavior; an allowlist is still required for every public service host.
- Record `direct_access=false`, whether bypass was disabled, the allowlisted hosts, and whether target or C2 infrastructure was contacted.
- Treat a proxy failure as terminal for that request. Never fall back to direct access.

## Result classification

Keep transport status separate from search results:

- `query-succeeded-with-hits`: the index returned records.
- `query-succeeded-zero-hits`: the index completed and returned no records.
- `query-failed`: DNS, CONNECT, TLS, timeout, HTTP, or parsing failure prevented a valid result.

A failed query is not evidence that an archive or artifact does not exist. Persist the request pattern, index identifier, failure class, and sanitized error for each attempt so aggregate counts remain auditable.
## Git recovery workflow

1. Acquire bare mirrors through the explicit proxy and fetch all public refs.
2. Enumerate reachable blobs across all refs, deduplicating by Git object ID before content hashing.
3. Compute SHA-256 over raw blob bytes and compare against the known artifact set.
4. Independently scan candidate sample trees because recovered files may not be Git reachable.
5. Search blob text for strict Base64 candidates, decode without execution, and hash decoded bytes recursively with a small depth limit and size bounds.
6. Record both occurrence count and unique matched content hashes. Multiple wrappers embedding the same payload are one recovered artifact, not multiple artifacts.
7. Export exact matching bytes to a static evidence directory with repository, blob, path, commit, decode depth, size, and hash provenance.

## Safety and verification

- Never execute recovered JavaScript, native payloads, package lifecycle hooks, or callback traffic during pursuit.
- Keep recovered originals outside reconstruction HTTP routes unless a separate, explicitly inert contract requires serving them.
- Test proxy validation, bypass suppression, zero-hit versus failed-query parsing, direct hash matches, nested Base64 matches, and unique-versus-occurrence counting.
- Report target-origin bytes and related-family variants separately even when their basenames or logical module IDs overlap.

## Static originals handoff

- Re-verify every source byte sequence against its expected size and SHA-256 while building the handoff. A same-named live wrapper or decoy must not enter the package
- Classify files as `target-original`, `same-variant-original`, or `embedded-original`. Do not promote same-variant bytes to target-origin evidence
- Package raw bytes without transformation and include a machine-readable manifest with package path, source path, size, SHA-256, classification, provenance boundary,
- Record the archive size and SHA-256 outside the archive manifest to avoid a self-referential hash. Test archive contents and per-file identities independently.
- Keep entry and module originals outside local HTTP routes and add a regression test that representative original paths return 404. If an encrypted payload is exposed
