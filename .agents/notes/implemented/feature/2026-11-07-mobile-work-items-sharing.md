# Agent Note: Mobile Work Items sharing

Status: implemented

English | [中文](2026-11-07-mobile-work-items-sharing.zh.md)

## Problem

The mobile tunnel is a separate encrypted protocol and does not pass through Gateway `remoteAccess`. Reusing Gateway policy checks would leave mobile Work Item reads unprotected.

## Decision

The Host operator selects Work Item sources before creating a pairing ticket. The ticket binds that list to one device identity; enrollment persists it with the device record, and every mobile list request checks the authenticated device's grant. The default grant is empty. The phone receives only bounded open-item summaries and cannot associate, prepare writes, or confirm writes. Changing a device grant requires revocation and re-pairing.

## Consequences

This authorization applies only to Cinlan Mobile tunnel devices. Gateway `share-viewer` access remains a separate policy and is not enabled by these grants. Existing device records parse with an empty Work Item grant.

## Verification

The Host socket test covers the default-deny grant, a granted source list and read, and refusal of an ungranted source. The pairing settings test covers the empty default selection. Package checks and the mobile dashboard build are recorded with the change.
