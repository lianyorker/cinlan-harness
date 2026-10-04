---
kind: upgrade-guide
description: "Settings automation is managed by the official Schedule service."
---

# Settings schedule migration

English | [中文](guide.zh.md)

## Change

In v0.2.1-alpha.1, the Settings entry opens the official Schedule task manager. The page reads the same task catalog and delivery history as the Schedule sidebar and Session surfaces; it does not use the retired local automation controller or a second task store.

The official Schedule service delivers reminders to their original Session. It supports after, absolute, fixed-rate, daily, weekly, and cron rules with explicit time zones. Task creation remains available through the Schedule task manager and the schedule_create tool; the Settings entry is a navigation entry to that manager.

The removed @deepseek-ai/dsh-settings-file provider is not a supported settings integration. Settings forms are projected from volatile fields on active Loader entry Config schemas and persist in the profile patch.

## Migration

1. Start the profile once after upgrading so the Web composition mounts schedule and ui-schedule.
2. Recreate local automation definitions as Schedule tasks. The old automation runner could start a new Session, while Schedule delivers into an existing Session; do not import definitions without choosing their target Session.
3. Remove direct dependencies on @deepseek-ai/dsh-settings-file and migrate test or plugin composition to @deepseek-ai/dsh-settings and profile-backed Config forms.
4. Open Settings and use the Schedule entry to inspect the shared catalog. The Schedule sidebar and model tools must show the same tasks.

Existing local automation files are not imported automatically because their execution semantics differ from Schedule delivery.
