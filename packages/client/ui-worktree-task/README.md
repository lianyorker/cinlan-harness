---
description: "Manage Worktree Task defaults, review changes, and run explicit lifecycle actions in Web Settings."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-worktree-task

English | [中文](README.zh.md)

## Summary

Create tasks from registered workspaces, edit defaults for future tasks, and review changes before reclaiming a checkout. Each task keeps its captured starting point and setup/cleanup programs. The loopback Settings page supports explicit activation, hibernation, archiving, and safe deletion, with Host errors and retained branches shown in the page.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin with Locale, Settings, Remote, and the Workspace UI adapter. Creation selects a registered workspace and starts its source-path draft from that workspace's directory. Omitting the starting ref uses the saved provider default, initially `HEAD`. The optional issue link is task metadata and does not write to an issue provider. Creation stays disabled until the first successful task-list load. A failed refresh preserves previously loaded records and displays the Host error; rejected creation retains its draft.

**New task defaults** saves the base ref, relative subdirectory, and setup/cleanup programs in one revision-checked operation. Enter each argument separately; no shell command parsing occurs. An empty executable with no arguments disables that program. Saving never runs programs or changes existing tasks. A conflict retains the draft; **Discard draft and reload** loads the current Host values before another save.

**Review** displays the captured baseline, tracked patch, untracked filenames, captured programs, and cleanup receipt. It neither activates a task nor runs a program. Patch text is displayed literally; untracked file contents are excluded. Refresh supersedes pending reads.

Hibernation, archiving, and deletion require acknowledgement. Hibernation does not run cleanup. Archive and delete run the captured cleanup unless it already succeeded; a settled failure retains the checkout for review and permits an explicit retry. An unsettled receipt blocks further mutation. Unmerged branches remain archived and reviewable after a delete request. Browser cancellation does not establish rollback; refresh authoritative records before retrying an interrupted mutation.

The page uses native rows and stable search anchors. Localized metadata contains labels and instructions, not task records, paths, or current defaults. Search opens a hidden creation form or policy disclosure before locating its target. Registrations disappear together with their slot declaration or plugin.

<a id="model-experience"></a>
## Model Experience

None, as the browser Worktree Task settings page registers no prompt, tool, or Session event.

#### KV Cache effect

None directly; task administration does not add model requests or prompt prefixes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Task operations depend on the selected Host composition.

- The optional Worktree Task rows remain unmounted in the default Web composition. A loopback Host must provide the complete service, Remote, and UI path.
- The managed root and active-checkout quota belong to deployment configuration. Branch prefixes belong to Git settings; there is no separate task naming template.
- Review does not provide merge, cherry-pick, or completion-triggered automation. The page uses explicit refresh rather than subscribing to task lifecycle events.
- Cleanup cannot guarantee exactly-once external effects. The receipt states whether settlement is known; there is no UI action to resolve an unsettled claim after a crash.

No runtime invariant companion is published because the page keeps only local interaction state and reloads authoritative Remote results.

<a id="dev-note"></a>
### Dev Note

Keep Cordis services in the registration module and pass typed locale and callbacks into components. Current component, controller, and real Web acceptance evidence, with remaining verification, is tracked in the [acceptance status](../../../.agents/plans/settings-native-acceptance-status.md).
