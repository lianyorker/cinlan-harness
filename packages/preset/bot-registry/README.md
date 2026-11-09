# @cinlan/bot-registry

English | [中文](README.zh.md)

Non-technical bot definition registry. A bot is a constrained projection over an [agent preset](../../preset/agent-preset-registry/README.md) `PresetDefinition`: persona prefix, a tool allow-list, and authorization-scope references. Everything else a preset can express (plugin names, config blocks, JS conditions) has no form field, so the projection cannot grant it.

## Storage

Bot rows live in the `bot-registry` settings namespace — the profile's `settings.yaml`, written through the [settings service](../../settings/settings/README.md) with its revision lock. The section:

```yaml
bots:
  - id: weekly-report-bot
    name: Weekly report compiler
    description: Summarize worktree commits every Friday
    persona: You compile the weekly report...
    tools: [tool-fs, tool-goal]
    credentials: [gitee-ro]   # authorization scope names, never secrets
    order: 10
roles:
  - subject: owner
    role: admin               # admin | builder | viewer
audit:
  - { at: 1762600000000, action: create, botId: weekly-report-bot, summary: '2 tools, 1 credential' }
```

The service re-reads the namespace on boot and on every `app-boot/config-reload`, converging registrations with the stored rows: added bots register through `AgentPresetRegistry.register()`, removed bots unregister, changed bots re-register. A composition without the settings service (tests, minimal hosts) keeps the section in memory, and the write path fails loud when it cannot persist.

## Governance

- **Roles**: the namespace's own `roles` table gates writes (`putBot` / `deleteBot`). `admin` and `builder` may write; `viewer` is refused with the role named. Compositions without a matching row fall back to the `defaultRole` config (default `admin`, the single-profile case). Cross-department isolation is not defined at v1 — see plan §7.3.
- **Credentials**: bot rows store authorization-scope *references* only; secrets stay in the credentials/authorization service.
- **Audit**: every committed write appends one row to the namespace's `audit` array (subject-implicit, time, action, field summary).

## API

| Method | Behavior |
| --- | --- |
| `listBots()` | Every stored bot row. |
| `putBot(caller, bot)` | Validate, role-check, persist, converge registrations. |
| `deleteBot(caller, botId)` | Role-check, remove, converge registrations. |
| `auditTrail()` | The audit array, newest last. |
| `reload()` | Re-read the namespace and converge registrations. |

## Form projection

`toPresetDefinition(bot)` builds the preset declaration: one `@deepseek-ai/dsh-persona` row carrying the persona prefix, one plugin row per allowed tool, and one `@deepseek-ai/dsh-credentials/grant` row per scope reference. `presetIdFor` / `botIdFor` map between the `bot-<id>` preset identity and the bot row.

## Known Limitations and Deferred Work

- Personas prepend verbatim; there is no template interpolation inside a bot persona yet.
- The audit trail records who-last-wrote semantics only: entries carry the action and summary, not an actor identity.
