---
description: "Opt-in Cinlan persistent Browser profile bundle."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-cinlan-browser`

English | [中文](README.zh.md)

## Summary

This bundle composes the persistent Browser service, Harness-owned Playwright provider, approval policy, and model-facing tools as an opt-in profile layer.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

`@deepseek-ai/dsh-cinlan-browser` is an opt-in profile patch bundle for native local browser access. Add it after [`@deepseek-ai/dsh-base`](../base/README.md); it does not join the base bundle or any profile that does not name it.

[`cordis.patch.yml`](cordis.patch.yml) mounts [`@deepseek-ai/dsh-browser`](../../browser/browser/README.md), pins its provider to local, mounts [@deepseek-ai/dsh-browser-playwright](../../browser/browser-playwright/README.md), installs [@deepseek-ai/dsh-browser-permission-policy](../../browser/browser-permission-policy/README.md), and exposes the sixteen browser tools through [@deepseek-ai/dsh-tool-browser](../../browser/tool-browser/README.md). The Provider launches an installed Chrome, Edge, or Playwright Chromium executable directly and keeps a Harness-owned browser profile. No Orca process, service, login, or configuration is required.

The bundle's default policy is least-privilege for an approval-capable profile: observation, navigation, and interaction are all `ask`. A later profile patch may replace the complete `browser-permission-policy` row config with deployment-specific decisions. Browser executable, channel, and storage overrides belong on the browser-playwright row; a patch replaces that row's complete config, after which omitted fields use the provider package defaults.

This bundle also mounts the [Browser Remote](../../api/browser-controller/README.md) for authenticated human settings actions. The native browser profile combines base, web-app, and this bundle; generic web does not enable it. Model approval policy covers the additional navigation, inspection, and transfer tools; human Remote commands do not execute as model tool calls.

## Model Experience

### Persistent-browser tools

#### What the model sees

When the bundle is present, the model receives the `browser_list`, `browser_open`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_screenshot`, `browser_close`, and the native home/search, history/network, and file-transfer schemas plus the stable persistent-browser guidance owned by [`@deepseek-ai/dsh-tool-browser`](../../browser/tool-browser/README.md). Calls that have not been approved return the class-specific approval text owned by the permission-policy package.

#### Token effect

The tool schemas and browser guidance add a fixed request-prefix contribution. Tool results are operation-dependent; screenshots retain image bytes through the composed attachment service instead of embedding encoded bytes in text.

#### KV Cache effect

The prefix is stable for a fixed bundle and child-package configuration. Adding or removing the bundle, or changing tool configuration that alters a schema or prompt, invalidates reuse from that point in the request prefix.

## Known Limitations and Deferred Work

- **Base services are required** - the bundle expects the profile to supply settings, attachment, system-prompt, tool, and approval services, normally through `dsh-base`.
- **Every operation asks by default** - a surface without an approval answerer rejects browser calls until its profile supplies a different explicit policy.
- **Browser executable required** - install the selected browser separately. The bundle does not download a browser. Settings can save the channel, headless mode, and viewport; restart the profile to apply them.
- **Browser is not Computer Use** - the composition does not control desktop windows, native applications, or operating-system input.


<a id="dev-note"></a>
### Dev Note

The bundle owns composition only; Browser transport and tool contracts remain in their dedicated packages.

No runtime invariant companion is published because the bundle declares a static plugin composition and retains no independent runtime state.
