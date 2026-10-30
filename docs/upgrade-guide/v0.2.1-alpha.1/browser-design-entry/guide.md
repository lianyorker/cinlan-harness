---
kind: upgrade-guide
description: The standalone Design guide entry is removed and the Design shortcut opens Browser design checks.
---

# Browser design entry

English | [中文](guide.zh.md)

## Change

The right-Sidebar guide exposes Browser instead of separate Browser and Cinlan Design entries. The `design.new` command and `Ctrl+Alt+D` (`Cmd+Alt+D` on macOS) open a new Browser tab in Design checks mode. Profiles that enable Design without Browser cannot use this shortcut. Existing `cinlan-design` tabs and `cinlan.sidebar-design.v1` data remain registered; saved viewport settings and visual pins are not migrated or deleted.

## Migration

1. In a custom profile that disables `ui-sidebar-browser`, enable that entry before using `design.new`. Keep `ui-cinlan-design` enabled for audit and direction controls.
2. Open Browser from the guide and select Design checks, or use the Design shortcut. Design directions is the next independent mode. Use the upper-right picker to open an annotation editor; saving preserves the draft, and the toolbar counter opens saved records. Click a verified current-page marker to edit it. Confirm that all modes reuse one Browser page.
3. Keep existing Design tabs when their persistent pins are needed. Browser saves new annotations separately in `cinlan.browser-pins.v1` and does not import those pins; do not delete their store to remove duplicate guide entries.
