---
description: "Typed authorization scope model for security assessment operations."
kind: "package-reference"
---
# @deepseek-ai/dsh-assessment-scope

English | [中文](README.zh.md)

## Summary
This package defines the authorization model for security assessments. A scope names targets, allowed operations, execution hosts, time bounds, credential references, egress policy, and evidence rules. Providers publish validated grants; assessment consumers must check the grant before admitting work.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the service with a provider such as dsh-assessment-scope-static and, when session binding is needed, dsh-assessment-scope-session. Keep the default grant empty until an operator supplies explicit authorization.

The report-download action specifically authorizes report delivery through the authenticated Harness client channel. It requires target, Execution Host, validity, approval, and evidence policy checks, but no invented outbound endpoint. Arbitrary data-export and external-reporting retain exact egress grants. Each Consumer must select the action that matches its actual effect.

<a id="model-experience"></a>
## Model Experience

Indirectly, through assessment consumers that apply the authorization policy.

#### KV Cache effect

No direct effect; scope data reaches a model only through authorized assessment results rendered by a consumer.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The package models authorization but does not execute scans or attest ownership of a target.
- Providers decide how grants are loaded and persisted.

The invariant companion validates canonical grants, delegated subsets, and recorded decisions in the Session stream. An empty grant denies operations only for Consumers that consult the policy.

<a id="dev-note"></a>
### Dev Note

An empty scope is a deliberate deny-all default, not a request to infer authorization.
