---
kind: upgrade-guide
description: "Web and Desktop enable lazy content search, use all-prompts titles, and place the shared coding switch in Developer tools."
---

# Session capability defaults

English | [中文](guide.zh.md)

## Change

Web and Desktop change `session-query-sqlite.config.openAt` from `never` to `first-search`, retaining `path: ":memory:"`. The first content search opens the local index.

The base `session-title-llm` row is disabled. The new `session-title-all-prompts-llm` row uses all eligible human prompts for automatic titles, which can add an auxiliary model request after each eligible prompt. Explicit user renames remain pinned.

The shared `ui-settings.enabled` switch moves from General to Developer tools under Data & advanced. Its saved value is unchanged. Ralph availability remains off through the new Host `ralph-policy` row; standard, PTC, and Creator tool rows now mount with `requirePolicy: true` instead of staying Loader-disabled. The native Auto backend is loaded without selecting Auto; its EXP warning remains pending acceptance. Privileged NodeJS Inspector remains optional.

## Migration

1. Restart the Web or Desktop Host to apply the composition. Search for content from a saved Session to check the lazy search path.
2. Use Settings → General → Search session contents for live `searchEnabled` control. Turning it off retains the index and exact reads; deployment `openAt: never` still takes precedence. To keep search disabled at deployment level, override `session-query-sqlite` in the profile patch with the complete config `{ path: ":memory:", openAt: never }`.
3. To retain first-prompt titles, set `session-title-all-prompts-llm.disabled: true` and `session-title-llm.disabled: false` in that patch. Keep exactly one title provider enabled. To disable model titles entirely, leave both rows disabled; the deterministic fallback remains.
4. Use Settings → General → Update session titles automatically to control `session-title.config.automaticEnabled` without disabling the provider. Turning it off retains existing titles and explicit regeneration, and cancels automatic work.
5. Use Settings → Data & advanced → Developer tools to explicitly enable Ralph availability and save its round ceiling. This does not start a run; a direct human request is still required. Custom policy-bound presets must compose `@deepseek-ai/dsh-tool-ralph/settings` once at Host scope. A profile override that still disables its `tool-ralph` row takes precedence over the availability switch.
6. The legacy optional suggestions for Session Search, Session Titles, Ralph, and Auto are removed because the Web bundle now composes their real backends or policy. Configure them in the native settings instead of installing another layer. Privileged debugging remains a separate optional **NodeJS runtime debugger** entry.
7. Find the existing coding visibility switch in Settings → Data & advanced → Developer tools. Check that its accepted value matches the saved preference.
