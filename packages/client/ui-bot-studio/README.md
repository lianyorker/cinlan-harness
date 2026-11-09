# @cinlan/client-ui-bot-studio

Non-technical bot composition: one settings section listing the bot roster, a form editor (persona, tool allow-list, credential scopes, order), and the change audit. Bots are rows in the `bot-registry` settings namespace; the host side projects them into agent presets.

English | [中文](README.zh.md)

## Mount

```yml
- id: ui-bot-studio
  name: '@cinlan/client-ui-bot-studio'
```

## Behavior

| Channel | Path |
| --- | --- |
| Read | `remote.settings.describe()` → the `bot-registry` namespace's `user` section. |
| Write | `remote.settings.update('bot-registry', { bots: … })` — revision-locked on the host; the section merges whole. |
| Convergence | The host's `BotRegistryService` listens for `app-boot/config-reload` and re-projects the stored section into preset registrations. |

The form validates client-side (id shape, required fields, list shape) for early feedback; the host re-validates every write, so the UI never bypasses [`@cinlan/bot-registry`](../../preset/bot-registry/README.md) rules. Credential fields carry scope names only — no secret values exist in the form or the namespace.

## Known Limitations and Deferred Work

- The write merges the whole `bots` array per save; two studios editing different bots concurrently overwrite each other (single-studio assumption).
- Tool and credential inputs are plain name lists; there is no picker against the live plugin or credential registries yet.
