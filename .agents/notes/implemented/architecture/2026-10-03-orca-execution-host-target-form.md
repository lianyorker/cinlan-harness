# Agent Note: The execution-host page edits a connection record

Status: implemented

English | [中文](2026-10-03-orca-execution-host-target-form.zh.md)

## Problem

The Execution hosts page saved a label and an existing OpenSSH alias and nothing else. A person adding a target therefore had to create the alias in the managing Host's OpenSSH configuration first, and the page could not express what they actually typed: host, port, account, identity file, proxy command, jump host, keep-alive, or a finite disconnect deadline. The controller exposed no connectivity probe and no way to read the Host's existing Host entries, so an operator had no way to check a target without connecting it, and no way to adopt the entries they had already written.

The page also presented a configuration record: saved target ids, revisions and connection generations. That is the owner's vocabulary, not the operator's.

## Decision

**A saved target carries an editable connection record.** [CreateTargetRequest](../../../../packages/execution-host/execution-host-targets/src/types.ts) gains an optional `connection`: port, username, privateKeyFile, proxyCommand, jumpHost, multiplex, keepAliveIntervalSeconds and connectTimeoutSeconds, all optional and non-secret. The saved alias stays the destination, so `ssh -F <config> -- <alias>` is unchanged; every saved refinement appends after the plugin-owned OpenSSH options, where OpenSSH resolves repeated options last-wins. A saved field therefore overrides the OpenSSH configuration and an omitted field leaves it alone.

`connection` is deliberately separate from `SshExecutionConfiguration.endpoint`. The endpoint belongs to a pinned deployment identity that a runtime installation writes and a Session binding captures; a connection is what the form edits. The connector dials `connection ?? execution.endpoint`, so a target that was never deployed still connects and probes exactly as its record describes. The domain stays at version 2: the new field is optional, so stored version-two records continue to parse unchanged, and a refinement-only update writes it as an ordinary edit.

**The page is the reference host form.** [SshTargetForm](../../../../packages/client/ui-settings-hosts/src/client/TargetForm.tsx) is a two-column dialog — label and host-or-alias, account and port, then a full-width identity file — with proxy command, jump host, connection reuse, terminal persistence and a disconnect deadline behind an Advanced disclosure. The single destination field folds what it carries into the account and port fields beside it, so `deploy@build.example:2222` becomes an alias plus its destination details. The card shows a status dot, an inline status summary, the label, `account@alias:port • identity file • terminal persistence`, a specific reason line on failure, and Edit, Delete, Test and Connect.

A connected target also offers Reset remote relay. Connecting a target that already holds a connection closes the running worker incarnation and dials a fresh one, so the card can offer that replacement without a separate Host operation; the action withdraws while the replacement is admitted.

Two Advanced controls record only their non-default choice. Connection reuse saves `multiplex: false` as an explicit opt-out, because reuse is the capability default. "Keep terminals alive until reset" leaves the disconnect deadline unbounded and locks the field showing Until reset; turning it off saves the bounded grace period as `connectTimeoutSeconds`, whose accepted range is the same 60 seconds to 7 days. The port the form shows is always saved, so an alias whose OpenSSH configuration uses a different port must have that port entered, which the import prefill does.

**Probing and importing are Host reads, not connections.** `ctx.executionHostTargets.test` dials a throwaway connection and publishes nothing; its stable codes (unreachable, authentication-required, host-key-mismatch, timeout, incompatible) are what the card renders. The new `listImportableHosts` Remote reads `config.sshConfigFile ?? ~/.ssh/config`, returns concrete Host entries with their first-obtained HostName, User, Port, IdentityFile, ProxyCommand and ProxyJump, skips wildcard and negated patterns and everything after a `Match` block, and never writes the file. The import dialog only prefills the form; saving stays a separate confirmation.

**Refinements this dial path cannot honour are recorded, not faked.** This connection always passes `-S none`, so the reuse opt-out does not refine it; it is still saved because the SSH execution capability consumes it for a captured deployment. The reference form's terminal-relay semantics are not implemented separately — the switch and the field it unlocks map onto the record's connection deadline. The reference card's other icon ends remote terminals. That action is left out rather than shipped unable to act: the worker advertises `['directory-inspection']` and nothing else, and this product's terminal sessions are owner-scoped to the managing Host, so a saved target owns no remote terminal to end. A key passphrase has no channel: `test` and `connect` accept only an exact revision, and the connection runs `-o BatchMode=yes`, so no prompt exists to answer. The page therefore reports `authentication-required` as a key-or-agent problem instead of collecting a secret it cannot use, and the passphrase dialog stays deferred.

## Alternatives considered

**Create a full execution deployment from the form.** `execution` requires the deployment identity a runtime installation verifies — remote Node, helper, hashes, workspace and both bootstrap fields. A form that invented them would produce a record that cannot resolve, so the page edits a connection and leaves deployment to the runtime installer.

**Keep the alias-only page and require OpenSSH configuration for everything.** That is the state this note replaces: the settings row collected a value the person had to create elsewhere, and the Advanced fields would have had no home.

**Read the OpenSSH configuration in the browser.** The file lives on the managing Host; only a Host-side read can see it, and only the Host can keep the key contents out of the response.

**Give the connection its own `host` field.** The alias already is the destination. A second host field would create two answers to one question, and the SSH execution capability would have to pick between them.

**Keep the first presentation written from the prose specification.** It put the section actions in the page header, used a narrow single-column dialog, and bound "keep terminals alive" to a keep-alive interval. Building against the reference implementation instead moved the actions onto the section row, restored the two-column dialog and the linked disconnect deadline, and dropped a keep-alive field the record had no consumer for.

## Consequences

A target can now be added, probed, connected, edited and deleted without touching the managing Host's OpenSSH configuration, while an alias-only record keeps behaving exactly as before. Import makes an existing OpenSSH configuration reusable without editing it.

Adding a Host Remote method has a build step that is easy to miss: `scripts/build-remote-contracts.ts` writes only `lib/typert.remote-client.*`, while the Host-side argument schemas live in `lib/typert.host.js`, produced by the host face build. A running source launch registers the stale descriptor and silently strips arguments the new method declares, which looks like a persistence bug in the owner. Regenerating the host descriptor for the contributing package fixes it; the full `build:lib:host` does the same for every contributor.

The page owns its heading. The section registers `heading: 'feature'`, so the settings shell renders no page title of its own; the navigation item keeps the feature name (`navLabel`) while the page renders the full surface title (`title`). Below it the page carries the target list and nothing else: one supporting sentence, then the `hosts` panel with the actions, the empty state and the rows. The runtime installation panel, the read-only local-Host provenance block, directory inspection and the unavailable Session-default rows are removed from this page. Their Remote methods and Host services are untouched — only this page's UI is withdrawn, so nothing here silently calls a capability the page no longer shows.

## Testing

`packages/execution-host/execution-host-targets/tests/connection.spec.ts` asserts the appended refinement order, that an omitted identity file leaves `-i` out, that a record's port reaches a listening fixture rather than the alias's configured one, and that a probe authenticates through the record's identity file. `tests/import.spec.ts` covers concrete Host parsing, wildcard and `Match` handling, a missing file, and the unreadable-path code. `packages/client/ui-settings-hosts/tests/hosts-section.client.spec.tsx` covers destination splitting, validation, the Advanced disclosure and its linked deadline, the probe and its typed failure, delete confirmation, and import prefill. `tests/loader.client.spec.tsx` keeps the package's real Loader composition: it edits a saved target through the generated Remote codecs, the renderer and the locale runtime. The page was also driven end to end in a browser against a real server.
