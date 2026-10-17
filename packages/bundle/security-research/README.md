---
description: "The Security Research profile layer: authorized assessment scope, durable findings, evidence artifacts, vulnerability lookups, skills, and workflow guidance for a dsh profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-security-research

English | [中文](README.zh.md)

## Summary

This bundle adds the Security Research surface to a base-backed dsh profile. It mounts the evidence, assessment, finding, vulnerability knowledge-base, skill, and workflow providers used by security work. The default scope contains no targets or actions. The optional assessment-scope-tool-policy Consumer checks the default shell, network, and Browser model-tool sets before effects; Consumers outside those sets still need their own guard. Add it with `dsh plugin --profile <name> add @deepseek-ai/dsh-security-research`.

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

### Install into a profile

Add the layer to an existing profile, then restart the application so the profile patch is reconciled:

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-security-research
dsh plugin --profile <name> remove @deepseek-ai/dsh-security-research
```

The shipped `security-research` profile includes this bundle after `dsh-base` and `dsh-web-app`. A custom profile must supply a base layer, an Execution Host provider, and one Host-root `@deepseek-ai/dsh-security-skills/resources` manager before this patch. The Web layer supplies the local Execution Host and resource manager. The packaged Agent preset is built in: it enters the preset roster as soon as the preset registry is available, and skill resources only widen the catalog its own provider serves.

### What you get

The layer mounts local persistent Artifact storage under $DSH_HOME/artifacts/v1, assessment scope and Session binding, durable Finding tools, NVD/OSV vulnerability queries, and the security workflow prompt. The Web layer supplies the global Security Skills provider for normal sessions. The bundle contributes its packaged `security-research` Agent preset through the preset registry, when present. The preset adds a research persona and scoped Security Skills to the coding composition. The profile-global security providers and tools remain shared. Resources are managed through the shared manager; with no release endpoint configured, the bundled inventory installs automatically so the skills are usable without a manual step.

### Modes

**Session presets.** The bundle contributes the `security-research` Agent preset to the preset roster. Standard-mode sessions already serve the bundled security skill catalog through the global provider, so a security question routes through the bundled `cinlan-cyber-security` router skill. Selecting the Security Research preset adds a research persona, a scoped security skill catalog, and the coding composition for authorized assessment, reverse engineering, vulnerability validation, malware analysis, and reporting.

**Skill resource modes.** Bundled mode (default) installs the audited package inventory at startup — no network request, content-derived version; set `autoInstallBundled: false` to require an explicit `installBundled()`. Release mode activates when a deployment configures `releaseManifestUrl`; `install()`, `reinstall()`, and `update()` then download and verify an inventoried archive from that endpoint. Both modes publish immutable generations, and switching modes never mixes inventories.

**Authorization boundary.** Installing resources or selecting the preset grants no assessment authorization. The assessment scope starts empty; operators add authorized targets, actions, and evidence policy through a later profile patch.

**Workspace development.** Startup, general questions, explanations, and generic code require neither assessment authorization nor sample files. The profile explicitly admits workspace-local shell commands listed in [`cordis.patch.yml`](cordis.patch.yml), including `pwd` and the standard pnpm version, typecheck, build, and test commands. Matching is exact, without added flags or compound statements; the [tool policy](../../security/assessment-scope-tool-policy/README.md#use-this-package) defines directory checks and remaining sandbox enforcement.

**Approval policy.** Agents composed from `security-research` start with the session approval policy `never`, so approval prompts do not interrupt that preset. This does not grant assessment targets, actions, execution hosts, credentials, or egress: the bundled assessment scope remains empty until an operator supplies an explicit authorization patch. Sandbox policy remains independently controlled by the deployment and session permission preset.

### How to use

1. Start a Session in the Web application and pick the **Security Research** preset in the preset picker, or keep Standard mode and ask a security question directly — the router skill routes it to the narrowest bundled skill.
2. The first security-research session triggers the bundled install automatically; afterwards the full catalog is available at every startup without a manual step.
3. Drive security work through the skills: the router skill maps a request to one submodule `SKILL.md`, and finding, artifact, and vulnerability-lookup tools are available inside the preset.
4. Manage resources through the shared manager (`installBundled()`, `install()`, `update()`, `remove()` on `securitySkillResources`) or the Security Research controller remotes; a custom headless composition must mount the manager and provider explicitly.
5. Add the layer to a custom profile with `dsh plugin --profile <name> add @deepseek-ai/dsh-security-research`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static Loader patch. Its insert list supplies providers before consumers and publishes invariant companions only for packages with independent observations. The assessment row starts with an empty authorized grant; a later profile patch replaces that complete configuration with operator targets, actions, evidence policy, and execution-host identities. Row configuration is replaced as a whole by later layers.

See [`cordis.patch.yml`](cordis.patch.yml) for the composed rows and [`src/index.ts`](src/index.ts) for the package carrier.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Profile composition](../../boot/app-boot/README.md) — profile discovery and bundle layering.
- [Finding service](../../security/finding/README.md) — durable finding data and transitions.
- [Security Skills](../../security/security-skills/README.md) — packaged skill discovery.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the inserted finding, vulnerability, skill, and workflow packages and the optional research preset's persona, scoped skill catalog, and coding composition.

The research persona is `执行器`, opens each security task with `安全研究启动`, and keeps that identity and opening when a loaded skill supplies another greeting or channel name.

#### KV Cache effect

The bundle adds no prompt prefix directly. The workflow prompt and tools own their individual prompt and tool-schema effects; selecting the research preset changes its persona prefix and scoped skill catalog without changing the Host-owned model route.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The shipped assessment grant is intentionally empty. Assessment operations outside the configured workspace command exceptions require a later patch with authorized targets, actions, host identities, and evidence policy. The scope service governs only Consumers that call it; tools outside the policy's configured sets need their own enforcement.
- Local Artifact bytes and metadata survive Host restart. Retention labels do not schedule deletion; encryption and reference-aware cleanup are not implemented. A prior in-memory artifact cannot be recovered after its original process exits.
- NVD and OSV requests require network access and remain subject to upstream rate limits.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The bundle is the installation owner; the security packages remain independently testable providers and consumers.

</details>

No runtime invariant companion is published because this bundle composes providers and consumers without owning a separate mutable projection.
