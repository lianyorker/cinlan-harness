# Agent Note: Research workspace commands

Status: implemented

English | [中文](2026-10-13-research-workspace-commands.zh.md)

## Decision

The research preset treats startup and general questions as ordinary conversation, not requests to assess a target. Sample files are required only when the requested analysis depends on an unavailable object.

The [tool policy](../../../../packages/security/assessment-scope-tool-policy/README.md) admits deployment-configured exact shell commands in the Session workspace without assessment authority. The [bundle](../../../../packages/bundle/security-research/cordis.patch.yml) selects basic directory and pnpm development commands. Actual assessment operations retain the empty default grant and require scope configuration. Downstream guards and sandbox policy remain independent.

## Rationale

An empty assessment grant cannot identify an authorized host or target for ordinary workspace development. Requiring a target for `pwd` prevents the agent from discovering its own workspace. Explicit command entries distinguish trusted development operations from assessment effects without guessing a target from arbitrary shell text.

Disabling the scope consumer globally would admit unrelated network and assessment effects. Broad shell parsing would create an unsupported safety classifier. Exact matching instead trusts the deployment's workspace scripts and command environment; filesystem confinement remains the sandbox's responsibility.

## Verification

The policy tests cover exact matching, child directories, absent or outside directories, excluded arguments, and invalid configuration. The shipped Web composition checks policy activation, assembles the research persona snapshot, executes `pwd` through the guarded tools pipeline, rejects a compound command with the empty grant, and verifies a sidebar terminal. These checks do not call a real model provider.
