---
description: "Shared Git preferences, durable namespace ownership, and browser-safe schema imports."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-settings

English | [中文](README.zh.md)

## Summary

Save Git preferences once for Worktree Task branch naming and Source Control. The preferences retain their values across UI reloads and Host restarts through the existing Settings provider. Consumers can import the schema and types without loading the Host plugin. Local base refresh remains unavailable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside a Settings provider. The plugin has no configuration fields; it registers the durable `git-source-control` namespace once.

```yaml
- name: '@deepseek-ai/dsh-git-settings'
```

The [Git preferences page](../../client/ui-git-settings/README.md) edits the user layer. Its six fields and defaults are:

| Field | Default | Meaning |
| --- | --- | --- |
| `branchPrefix` | `none` | `git-username`, `custom`, or `none` for new Worktree Task branches. |
| `branchPrefixCustom` | `''` | Literal prefix when Custom is selected. |
| `refreshLocalBaseRefOnWorktreeCreate` | `false` | Saved value with no runtime consumer; display and reset only. |
| `sourceControlGroupOrder` | `changes-first` | `changes-first`, `staged-first`, or `untracked-first`. |
| `compareAgainstUpstream` | `false` | Request upstream comparison in Source Control. |
| `enableGitHubAttribution` | `false` | Add attribution to user-created Source Control commits. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry delegates registration and disposal to Settings. The `./settings-schema` export contains only the namespace constant and schema; `./types` contains only types. Browser clients bind the namespace through the existing SettingsScope service. Host consumers resolve the registered value; Worktree Task Create explicitly resolves schema defaults when the service or namespace is absent.

The [schema](src/settings-schema.ts) owns defaults, [types](src/types.ts) own field declarations, and [Host entry](src/index.ts) owns registration. No runtime invariant companion is published: this package owns no independent state that can diverge from Settings' resolved namespace.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings service](../../settings/settings/README.md) — persistence and namespace lifetimes.
- [Git preferences page](../../client/ui-git-settings/README.md) — editing and reset behavior.
- [Git Worktree Tasks](../../workspace/worktree-task-git/README.md) — branch naming and validation.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

<a id="model-experience"></a>
## Model Experience

Indirectly, through Worktree Task and Source Control consumers of the shared Git preferences.

#### KV Cache effect

None; this package does not assemble model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Consumers determine where preferences apply:

- Local base refresh has no runtime implementation; its stored value remains readable and resettable.
- Branch prefixes affect new Worktree Tasks only. Git validates repository-specific branch names during Create.
- Attribution applies to explicit Source Control commits, without changing Worktree Task checkpoint signing or commit behavior.
