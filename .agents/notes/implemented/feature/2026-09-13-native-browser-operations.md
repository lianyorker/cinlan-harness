# Agent Note: Native Browser operations and profile data ownership

Status: implemented

English | [中文](2026-09-13-native-browser-operations.zh.md)

## Problem

A browser launch adapter and preference form do not provide native profile operations, controlled imports, or usable file transfers. Cookie values, workspace files, and downloads require distinct ownership and lifetime rules; logging imported values or accepting arbitrary Host download paths would expose unrelated data.

## Decision

The existing Browser Service Definition gains optional automation and transfer Provider interfaces. Playwright implements them directly; unsupported Providers reject the extension rather than falling back to Orca. The optional browser profile composes base, Web, and cinlan-browser, with generated Browser Remote operations for authenticated human actions.

Profile name, homepage, and search engine use the existing revision-fenced Settings namespace and apply on Provider remount. The default name retains the existing directory; other validated lowercase names use separate Harness-owned subdirectories. Changing the name does not copy or delete stored cookies.

Cookie import accepts a user-selected JSON array and an expected active profile. Validation occurs before native import, and neither errors nor receipts echo values. There is no model cookie-import tool or automatic scanning of another browser's database.

History and network inspection retain bounded metadata for open pages only, excluding URL credentials, queries, fragments, headers, and bodies. File uploads consume a fresh observation; model uploads read only the calling Session workspace. Captured downloads belong to their page, report pending/complete/failed states, enforce byte limits when read, and use sanitized names. Model saves persist exact bytes through the existing Attachment provider; human saves use inert Blobs.

## Alternatives considered

**Copy the external application's CLI and settings store.** This retains a second runtime prerequisite and duplicates the existing Harness Settings, Provider, and Remote layers.

**Pass cookie values through a model tool.** Tool arguments enter durable Session logs. The authenticated human Remote keeps import values out of that recording path while exposing only a count.

**Return a Host download path or read the whole file without a bound.** A caller could confuse paths between execution worlds, and large downloads could exhaust memory. Page-owned ids and streaming reads preserve ownership and enforce the read budget.

## Consequences

Browser operations remain optional. Model tools use the existing observe/navigate/interact policy and monotonic execution guards; authenticated human Remote commands are a separate access path, not assessment grants. The Security Research scope is not yet enforced on every Browser, shell, or network effect.

History is not durable across page or Provider closure, and network inspection is not HAR capture. Named profiles require remount and have no inventory, rename/delete, or per-tab switch UI. Transfer read budgets do not cap browser network traffic or temporary download disk usage. Cookie import supports explicit JSON, not database decryption or browser discovery.

## Verification

The real Web composition saves preferences, restarts the Host, checks homepage/search destinations, follows native history, and inspects request metadata. It imports a fixture cookie, verifies it by a local HTTP request, restarts with the same profile, and proves absence in a different profile. Upload tests inspect the target input; download tests compare actual attachment and browser-saved bytes. Unit tests cover malformed imports, stale profiles, count and byte limits, canceled operations, and permission-listener bypass.

The [native composition decision](2026-09-13-native-browser-and-security-evidence.md) remains active for the Browser base composition and durable security evidence. This note adds operation and import ownership; it does not replace those decisions or claim a full model-conversation recording.
