---
description: "Native read-only GitHub, GitLab, and Gitee readiness checks in Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-integrations

English | [中文](README.zh.md)

## Summary

The Integrations page in the Development settings group checks the real Host readiness of GitHub, GitLab, and Gitee. It reports the provider's status and available account hint; it does not install tools, authenticate accounts, or change credentials.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Open Integrations to check all three providers. Refresh all retries after the current checks settle. Each row independently distinguishes connected, missing CLI, missing authentication, missing configuration, unavailable, and checking states. A failed Remote request shows an error; it does not become an unconfigured account.

GitHub and GitLab display the applicable installation or authentication command when the Host reports that prerequisite missing. Gitee shows the token setup instruction when the token is missing or rejected; a present token alone does not establish a connection. Commands are displayed as text and are not executed by this page.

Settings search indexes localized provider descriptions and Refresh all. Account hints and other response data are excluded. Four stable anchors belong to the provider rows and refresh control.

<a id="implementation"></a>
## Implementation

The [preflight controller](../../api/integration-preflight-controller/src/index.ts) checks GitHub through `gh auth status`, GitLab through `glab auth status`, and Gitee through its user endpoint. The component owns one AbortController per check pass; replacing the callback, refreshing, or leaving the page cancels the retired pass and suppresses late results.

The section id remains `integrations` with order 40. Its UI, Development group metadata, and four search descriptors share one `slots.inject` lifecycle; labels follow the active locale without indexing live account data.

No runtime invariant companion is published: readiness belongs to the Host controller and this page renders a disposable request snapshot.

<a id="model-experience"></a>
## Model Experience

None, as the page registers no model-facing tool or prompt content and does not change Session logs.

#### KV Cache effect

None; these browser-triggered checks do not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Status is refreshed on opening and explicit Refresh all; this page does not subscribe to external authentication changes. CLI installation guidance contains the existing Windows commands. The visual reference's Linear connection, add-connection flow, and verify-on-start preference have no corresponding operations or settings and are not exposed here.
