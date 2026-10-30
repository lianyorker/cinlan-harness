# Agent Note: Host-owned Ralph admission

Status: implemented

English | [中文](2026-10-19-ralph-host-policy.zh.md)

## Problem

Ralph tools live inside Agent presets while user configuration is Host-owned. Independent preset toggles would duplicate availability state, and hiding a tool alone would not prevent an already selected call from starting work.

## Decision

The [Ralph policy entry](../../../../packages/workflow/tool-ralph/README.md#host-policy) mounts once at Host scope and defaults to disabled. Web standard, PTC, and Creator presets require that service. Availability registers or withdraws both the tool and its fixed explicit-human-request guidance. The executor checks current admission and its registration generation, applies the smaller Host/preset round ceiling, and rejects stale definitions and late results. Disabling or unloading requests cancellation of owned runs; callers still await workflow settlement and dispose their runs.

The single Developer tools settings section owns the switch and saved positive-integer round ceiling through the existing configuration form. Changing settings never starts a workflow or supplies the human instruction required to call Ralph. Standalone compositions without the new requirement retain their explicit opt-in behavior. No Session event, workflow protocol, or released data format changes.

## Alternatives considered

Enabling every model tool by default weakens deliberate opt-in. Editing preset YAML from the UI creates several policy owners. Schema filtering without an executor check allows stale definitions to bypass disable. Force-terminating arbitrary worker resources would violate existing workflow cleanup ownership.

## Consequences

Policy changes affect all bound Sessions on the Host. A call captures its round ceiling at start; changing that ceiling does not rewrite an active run, while disabling requests cancellation. Tests use fixed workflow responses and never start real child agents. They cover Loader updates, admission, stale direct execution, ignored cancellation with late success, round ceilings, unload, saved profile restart, and native settings feedback. Real-model and browser acceptance remain separate.
