# Agent Note: Hide Desktop phone pairing settings from Web

Status: implemented

English | [中文](2026-09-22-web-pairing-settings-hidden.zh.md)

## Problem

The Web carrier can use a loopback URL, so the Desktop-only phone pairing page was registered in Web Settings even though the phone client is not available.

## Decision

The pairing settings contribution now requires both the `dsh-app:` Desktop carrier protocol and a loopback Host. Paired carriers remain excluded through the existing Host fact.

## Alternatives considered

**Remove the pairing plugin from the Web bundle:** Rejected because Desktop and Web share the bundle, and Desktop still needs the page.

**Infer Desktop from the loopback Host fact:** Rejected because localhost Web pages also report loopback.

## Consequences

Desktop keeps the phone pairing page, while Web Settings no longer registers its section, icon, metadata, observer, or management calls. The carrier distinction is covered by the loader tests.
