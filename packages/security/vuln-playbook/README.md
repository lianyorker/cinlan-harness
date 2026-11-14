---
description: "Offline CVE/PoC playbook corpus with fingerprint matching (ctx.vulnPlaybook, playbook_* tools)"
kind: "package-reference"
---
# @cinlan/vuln-playbook

English | [中文](README.zh.md)

## Summary

This package ships an offline vulnerability playbook corpus (176 Markdown entries under `assets/knowledge`) and mounts `ctx.vulnPlaybook` plus the `playbook_*` tool set. `playbook_match` scores an observed fingerprint — port, banner, product name, header or response text — against the corpus and returns ranked candidates with reasons; `playbook_read` returns one entry's full body; `playbook_list` reports corpus size per category. Matching is local-only: no network, no subprocess, no code execution.

## Using this package

Mount it in any composition that also provides `tools`. The corpus is bundled, so nothing is downloaded at install or runtime; the index rebuilds on each query so corpus edits take effect without restart.

Entries describe public vulnerability material (NVD, vendor advisories, public analyses) and carry `verified: false` until reproduced on a target. Treat matches as candidate guidance, not confirmed findings — confirmation belongs in `finding_*` tools backed by reproduction evidence.

## Provenance and exclusions

The corpus was imported from a reviewed third-party playbook archive; see `assets/resource-provenance.json` for the source hash, per-category counts, and the licensing note. Playbook text uses placeholder endpoints (`attacker`, `dnslog.cn`) — no live callback domains, no model-targeting instructions. The source archive's prompt-replacement configuration, client UI, HTTP routes, runtime downloaders, and autopilot were excluded by design and are reimplemented or superseded by native Cinlan capabilities.

## Model Experience

Indirectly, through the `playbook_*` tools the model calls; match results enter the model context only when the model requests them.

#### KV Cache effect

No direct effect; the playbook never injects text into the model context on its own.

## Known Limitations and Deferred Work

- Matching is keyword/fingerprint heuristic ranking, not semantic search; a missed banner can hide a relevant entry.
- Corpus entries are point-in-time compilations of public material and are not refreshed from upstream feeds.
