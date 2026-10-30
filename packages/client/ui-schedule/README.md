---
description: "Automation task management and Session reminder entries in the existing Web UI."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-schedule

English | [中文](README.zh.md)

## Summary

The Automation tasks page and right Sidebar task tab share task rules, local edits, saved delivery records, deletion, and conversation navigation. Manual creation and target selection use the Host Schedule service; conversation cards, header clocks, and Session row marks retain their existing locations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web composition mounts `ui-schedule` with the Host Schedule service. The clock context that supplies the model's current time is preset-owned: `standard`, `cordis`, and `ptc` declare it, and `minimal` declares neither it nor the reminder tools. The Automation tasks sidebar entry opens a global page without selecting or activating a Session. The page header's New action starts a new Session, where the reminder is created by asking the model; the page itself has no creation form. Its task list supports text search and one All, Enabled, and Inactive status filter row; search matches the stored task name, the instruction, and the internal Session id, not a resolved Session title, and the empty state keeps the heading's New action beside the notice. Selecting an active or inactive task opens a second detail level with Rules and Records tabs. Every list row shows the task's stored title with its status, frequency, and next run and never the original Session name; the detail's name control shows the stored title. Rules contains the complete reminder, status, next target for active tasks, original recurrence rule, and task id. Daily rule labels show the saved local time and exact stored IANA zone, preserving nonzero seconds and milliseconds rather than substituting the browser's zone. The Linked session entry in the detail tab strip names the linked Session by its catalog title, falling back to the Session id when no title is available. When the strip cannot fit the tab list beside the labelled entry, the entry becomes an icon button with the same button style as More task actions, with the Session chat icon and a Linked session tooltip that also shows while the entry is disabled; the entry keeps focus when it switches layouts; the tab list scrolls without a visible scrollbar. It opens an available, unarchived Session after metadata loads; pending Session or Workspace metadata, an archived Session, missing Session membership, or a Workspace query error keeps it disabled with an explanation. The click rechecks availability; browsing does not unarchive the Session. Only this action requests Session activation. Deletion is available from the More task actions menu in the detail's top strip, separate from navigation.
Below 768px, the task list uses 20px horizontal insets, matching the Plugins page.

The shipped Web composition mounts `ui-schedule` with Host Schedule. The Automation tasks sidebar entry opens the task list without selecting or activating a Session. New retains its existing behavior: open a new conversation and let the user enter an instruction. Its adjacent menu offers Create in conversation and Create manually. Manual creation opens the shared Modal, validates required fields, and saves a task without starting an Agent or sending the instruction. A failed request leaves the form and its values visible. The empty state shows a decorative document-and-clock illustration whose colors follow the theme.

Enabled, Paused, Ended, and All filters combine with text search over the title, prompt, and linked Session id; the page starts on Enabled. The search-row menu clears all ended tasks after confirmation, preserving active and paused tasks. Selecting a task opens Rules / Records. Edit stages a draft; Save sends changed fields with `expectedUpdatedAt`, or `null` when no stored revision exists. An unchanged Save still asks the Host to store the current row shape. A successful save returns to the read-only view and focuses Edit. Conflict retains the draft and offers Reload; Cancel discards it. Late responses cannot change another task's detail. Coarse-pointer search, instruction, and timing fields use 16px text to prevent focus zoom on iOS Safari.

The destination menu offers a new conversation that the first delivery creates and later deliveries reuse, or a new conversation at every delivery. Manual creation defaults to reuse. A task already bound to a Session shows Current linked conversation as its destination, and editing it preserves that destination unless the user explicitly chooses a new one. The Linked workspace selector lists the framework Workspace catalog, shows each Workspace's directory under its name, and labels the first-use Workspace with its localized default name. A new destination starts in that Workspace, else in the first listed one. A stored task without a directory shows Ungrouped, because the Sessions it creates join no Workspace. For a reusable destination, the bottom conversation entry shows Pending creation until the first Session exists. A per-run destination instead shows Latest run conversation after its first delivery and hides the entry before that delivery; earlier conversations remain accessible from delivery records. Available links recheck membership and archive state before opening; missing or archived Sessions remain disabled.

Opening Records lazily requests the newest 20 saved records. Load older records adds another page in newest-first append order, independent of wall-clock rollback. The tab strip is the whole header of that view: the editable name and next-run line belong to Rules. Each Saved delivery record leads with a clock glyph and its occurrence time as the locale's month name and clock field pair in the task's zone, or the browser's zone for a one-shot record, and shows the actual saved prompt when present. A prompt longer than two lines shows its first two lines and an Expand toggle, which Collapse reverses; a collapsed prompt rechecks its length when the panel width changes. A legacy receipt without a prompt never substitutes the current instruction.
The repeat editor offers once, minute, hour, day, week, month, and custom rules. Date and clock controls reuse existing pickers. Guided presets produce RRULE; minute and hour intervals start from the current minute in the selected zone. The Custom choice and Customize input do not name either syntax; the input accepts a two-line RRULE or a five-field Cron expression with an explicit zone. RRULE retains the zone in `DTSTART`; Cron retains its expression and selected zone as Cron timing. Complex RRULE values remain verbatim. Save validates Custom text through the Host; invalid or empty input keeps the draft open and shows the existing correction message. Existing After, At, Every, Daily, and Weekly records show their description in Custom and keep their typed timing until a replacement is entered. Editing other fields preserves the committed occurrence.

Pause and resume update lifecycle state. The detail menu offers Run now and Delete. It offers no queued-message cancellation: one inbox message may contain deliveries from several tasks. While a delivery to a reused conversation is queued or running, the detail disables Edit, pause and resume, Run now, and Delete, and states that the task is queued or running and is managed in its conversation, which the bottom conversation entry opens. The minimum delivery interval disables another immediate run until the interval ends, while pause and deletion remain available once execution is idle. When the interval is the only cause, the Run now row stays focusable, and its tooltip states that the minimum run interval has not passed and when Run now becomes available. An archived linked conversation of a task already bound to a Session also disables Run now, because the Host refuses that delivery. A run that the Host refuses with `schedule_execution_pending` shows a status notice instead of an error. Deletion requires confirmation, removes the task and its saved records, retains Sessions and already-delivered messages, and reports the result through the existing app-wide toast. The confirmation focuses Cancel first; when it closes, focus returns to the detail menu button. The detail keeps the task until the Host answers. An applied deletion closes the detail or its task tab; a failed deletion keeps the task open for another attempt.

The list, detail, header, and Session hover show the later of the scheduled occurrence and the Host delivery floor as the next run. Creation and editing show one short minimum-interval hint for per-run conversation targets, read from `schedule.deliveryLimits`; a failed read offers Retry. The read-only detail keeps the next-run time without repeating that hint. Scheduled and immediate runs share this limit.

Records lazily requests 20 saved deliveries, supports newest-first pagination, retains loaded records after failure, and ignores superseded or unmounted requests. Each record shows its occurrence and saved prompt, with Expand / Collapse for long prompts; legacy records without prompt text never substitute the current instruction. A receipt's actual destination has a conversation link when the Session is available. Confirmed pruning is stated only after the final saved page and offers the current retention explanation. These records acknowledge inbox delivery, not model execution success.

An open conversation's header clock remains hidden before the first successful read or while no active related tasks exist. One task opens its right Sidebar tab; several open the existing popover. Idle, unarchived Session rows with active related tasks retain their clock mark and hover list. `schedule_create` continues to render a Turn-level card with a task title, repeat description, and Open action. Persisted legacy and current tool results both render; an authoritative read newer than the card resolves later edits or deletion.

### Time-zone data source

Time-zone enumeration and localized names use the browser's embedded ICU/CLDR data through `Intl`. There is no runtime download. The editor retains a stored alias even when enumeration omits it, and uses the system zone plus UTC when enumeration is unavailable.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

While the Peer may read `schedule/catalog`, the plugin registers the existing `schedules` main panel, Session header utility, Turn tail card, Session row mark and hover entries, and `scheduleTask` right Sidebar tab. Slot injection supplies framework readers and action callbacks; components own disposable selection, search, form, and paging state. The Host owns task storage and execution. Browsing catalogs does not activate a Session.

Subscriptions exist only while the framework observes a source. The final unsubscribe releases event listeners and invalidates pending responses. Components receive framework-bound `useCatalog` hooks and explicit action callbacks. The mounted Records view reads `schedule.history` with the selected task's original Session binding; catalog and list responses omit full history. Components own disposable search, filtering, selection, confirmation, and history-page state. Reminder records remain Host-owned and do not come from historical Session projections or browser-local demo data.
The manager, task tabs, row marks, and conversation-header projections share one observable `schedule.catalog` source. Header and row views filter active records by involvement and delivery target. Mutations use task-id-based `schedule.create`, `schedule.edit`, and `schedule.run`; history uses task identity and cursor without a Session ownership parameter. A mutation acknowledgment triggers a fresh authoritative read; a failed read remains a catalog error rather than changing the acknowledged write into a failure.

Sidebar layout records omit opener parameters. `TaskTabBindings` therefore persists task identity by Session and tab id in localStorage, without storing task content. Closed tab bindings are pruned. Observable catalog requests subscribe only while read, invalidate on Schedule changes and connection reset, and retire outstanding reads after the final subscriber leaves.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Schedule](../../schedule/schedule/README.md) owns persistence, destinations, lifecycle, and delivery semantics.
- [Slots](../../../docs/subsystems/slots.md) defines framework readers and panel contributions.

<a id="model-experience"></a>
## Model Experience

None, as this browser package registers no model tools or messages.

#### KV Cache effect

None. Task-list content does not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Saved records describe inbox delivery, not execution results; absent historical prompts or physically deleted tasks cannot be reconstructed.
- The Host limits saved history by `deliveryHistoryDays` and `deliveryHistoryRecords`; page size limits record count, not prompt bytes.
- Conversation links open the Session through normal navigation, not a specific message. Deleting a task does not cancel messages already delivered.
- This UI provides no task-level authorization for model tools. Host Schedule owns access control and must enforce any per-Session restrictions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context — click to expand</summary>

None.

</details>
