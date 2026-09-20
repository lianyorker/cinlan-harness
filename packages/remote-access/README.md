---
description: "Direct pairing and device authority for the existing Desktop Host."
kind: "directory-reference"
---

# Remote access

English | [中文](README.zh.md)

## Summary

This group owns opt-in network access to an existing Desktop Host. The [remote-access package](./remote-access/README.md) provides the HTTPS carrier, device grants, and Session-scoped authorization. Local management is exposed by [pairing-controller](../api/pairing-controller/README.md).

## Ownership

The [HTTP Server subsystem](../../docs/subsystems/web-server.md) owns the carrier and Remote Access service reference. Desktop supplies update admission and matching paired browser assets. Session, question, and approval owners remain in their original packages. The [Web client subsystem](../../docs/subsystems/web-client.md) owns shared conversation rendering and transport generations.
