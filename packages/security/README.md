---
description: "Security research packages for scoped assessment authority, evidence, findings, skills, workflows, and vulnerability knowledge."
kind: "package-group"
---
# security/ — security research capabilities

English | [中文](README.zh.md)

## Summary

The `security/` group provides scoped assessment authority, evidence metadata, finding lifecycle state, reusable research skills, workflow guidance, and vulnerability knowledge. The core packages define the contracts; provider and tool packages supply local storage, model-facing operations, and profile composition. The security-research profile combines these packages with a deny-all default grant.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`assessment-scope`](assessment-scope/README.md) | Defines targets, actions, hosts, time bounds, egress, credentials, and evidence policy. |
| [`assessment-scope-static`](assessment-scope-static/README.md) | Provides a validated grant from static profile configuration. |
| [`assessment-scope-settings`](assessment-scope-settings/README.md) | Publishes validated root authority from committed Settings. |
| [`finding-export`](finding-export/README.md) | Pure deterministic report byte exporters shared by tool and human Consumers. |
| [`assessment-scope-tool-policy`](assessment-scope-tool-policy/README.md) | Enforces scope before shell, network, and Browser model tools. |
| [`assessment-scope-tool-policy`](assessment-scope-tool-policy/README.md) | Enforces assessment scope before shell, network, and Browser model tools. |
| [`assessment-scope-session`](assessment-scope-session/README.md) | Binds grants to live Sessions and records operation decisions. |
| [`finding`](finding/README.md) | Defines durable finding identity, evidence, lifecycle, and projection contracts. |
| [`finding-session`](finding-session/README.md) | Stores findings in the owning Session event stream. |
| [`tool-finding`](tool-finding/README.md) | Registers model-facing finding record, query, transition, and export tools. |
| [`security-skills`](security-skills/README.md) | Publishes the bundled security research skill catalog and references. |
| [`security-workflow-prompt`](security-workflow-prompt/README.md) | Adds model guidance for the security research workflow. |
| [`tool-vuln-kb`](tool-vuln-kb/README.md) | Registers model-facing vulnerability knowledge lookup tools. |
| [`vuln-kb-service`](vuln-kb-service/README.md) | Defines provider-neutral vulnerability knowledge queries. |
| [`vuln-kb-nvd`](vuln-kb-nvd/README.md) | Provides local NVD-backed vulnerability records and refresh behavior. |

<a id="related-documentation"></a>
## Related documentation

- [Security Research profile](../../profiles/security-research.md) — the shipped composition and its default authority.
- [Security Research subsystem reference](../../docs/subsystems/security-research.md) — assessment grants, operation decisions, Finding records, and vulnerability queries.
- [Scope subsystem reference](../../docs/subsystems/scope.md) — shared scope and authorization semantics.
- [Skills subsystem reference](../../docs/subsystems/skills.md) — skill registration and loading semantics.
- [Workflow subsystem reference](../../docs/subsystems/workflow.md) — workflow execution and result semantics.

<a id="dev-note"></a>
## Dev Note

Keep authorization, provenance, evidence, and model-facing tool changes in their owning package. Update the profile and generated tool catalog when composition or schemas change.
