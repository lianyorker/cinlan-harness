# Agent Note: Feature-owned settings navigation metadata

Status: implemented

English | [中文](2026-09-17-settings-navigation-metadata.zh.md)

## Problem

A settings shell assembled from independent plugins needs product groups and searchable fields without learning each feature's configuration or treating an unmounted capability as an available page. Generic slot labels alone identify pages but cannot identify a field inside a tab. Indexing resolved settings values also risks exposing credentials or private user content.

## Decision

The Client settings base owns a fiber-scoped metadata service. Page registrants supply group membership; field registrants supply localized public copy, keyword aliases and stable anchors. The shell joins descriptors only to live section slots, keeping page labels, order and icons in the existing slot ledger. Unclassified third-party sections appear in Extensions. Metadata has no authority to mount UI, persist configuration or enable tools.

Registration and the corresponding slot share an effect lifetime. Snapshots retain identity between changes, refresh when locale dictionaries change, and drop only the disposing registrant's contribution. Field ids and anchors are unique within a section, including across tabs. Search targets are plain owner props; the feature selects its tab and the shell focuses the rendered anchor. Navigation state stays in the Client and does not enter Session records.

The [slot composition decision](2026-07-22-slot-type-chain-implementation.md) remains authoritative for registration and rendering. This adds settings-owned information and does not supersede that decision or the Host's persisted settings resolution.

## Alternatives considered

Adding arbitrary group/search fields to generic slot options spreads a settings-specific requirement across every UI domain. A central page-id table makes the shell own third-party feature policy and cannot follow feature disposal. Generating a search index from Host schemas includes fields without a rendered control and misses browser-local settings. The chosen registry requires small owner registrations but preserves feature lifetime and locale ownership.

## Consequences

Owners maintain anchors alongside controls and remove descriptors with their slots. A mounted page can explain an unavailable runtime capability; its disabled rows and disclosure anchors remain searchable without initiating installation, probing, permission requests, or execution. The shell can add groups and field navigation without importing feature UI or changing Host settings schemas. Pages without field descriptors remain searchable by their page label; unmounted section slots contribute no page. Runtime availability belongs to the feature and does not require a new shell routing table.

## Verification

Metadata tests exercise collisions, late registration, locale and dictionary changes, tab targets, subscriber isolation and unload. Shell tests join only mounted slots, rank public field copy, retain navigation during search and focus the selected control. Browser coverage checks the assembled Chinese/English page, actual theme controls, tab routing and mobile drawer behavior. Existing persistence paths remain under their owning feature tests.
