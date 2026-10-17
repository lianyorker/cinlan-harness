# Agent Note: Built-in mobile settings and operator resource management

Status: implemented

English | [中文](2026-10-08-builtin-mobile-settings.zh.md)

## Problem

The Mobile Emulator page needs a mounted preference owner and native resource service. A settings-only page cannot persist SDK selection or provide device discovery without the matching capability composition. Resource downloads and mirror processes also need the actual caller identity rather than optional legacy Gateway access metadata.

## Decision

Web and Desktop use the existing Mobile Device bundle once. The capability keeps live Config references for SDK and default-device preferences; Settings owns profile-patch persistence. Provider activation, the checking preference, model-operation approval, resource installation, and mirror admission remain separate decisions. The controller accepts resource operations only from the Connection operator's active Remote invocation.

## Alternatives considered

Duplicating Mobile Device rows in the Web bundle would collide with profiles already selecting the standalone bundle. A parallel settings store would leave native ADB and SDK probes reading different values. Treating a missing Remote identity as local would permit unadmitted calls to manage native processes.

## Consequences

The stock Web tuple gains the capability on restart; custom bundle lists are preserved and require explicit selection. The bundle mounts no emulator and downloads no resources automatically. Direct Host management uses the resource service instead of the authenticated controller. Settings saves input on blur and adopts SDK folders through the [shared picker](2026-10-08-reusable-directory-picker.md). Native directory dialogs and attached-device acceptance remain hardware-dependent; browser tests cover the browse dialog, live profile persistence, and responsive layout.
