---
description: "Opt-in profile bundle for desktop Computer Use with approval required by default."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-computer-use

English | [中文](README.zh.md)

## Summary

Opt-in profile bundle for desktop Computer Use with approval required by default.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

`@deepseek-ai/dsh-cinlan-computer-use` is an opt-in profile patch bundle for local desktop Computer Use through the Cinlan CLI. Add it after [`@deepseek-ai/dsh-base`](../base/README.md); it does not join the base bundle or any profile that does not name it.

[`cordis.patch.yml`](cordis.patch.yml) mounts [`@deepseek-ai/dsh-computer-use`](../../computer-use/computer-use/README.md), pins its Provider to `cinlan`, mounts [`@deepseek-ai/dsh-computer-use-cinlan`](../../computer-use/computer-use-cinlan/README.md), installs [`@deepseek-ai/dsh-computer-use-permission-policy`](../../computer-use/computer-use-permission-policy/README.md), and exposes six grouped [`computer_*`](../../computer-use/tool-computer-use/README.md) tools through [`@deepseek-ai/dsh-tool-computer-use`](../../computer-use/tool-computer-use/README.md). The Provider keeps its package defaults: the `orca` executable (`orca-ide` on Linux), protocol probe, bounded subprocess output, one local session namespace, and local-runtime environment tombstones.

The bundle's default policy is least-privilege for an approval-capable profile: observation, pointer, keyboard, and accessibility mutation are all `ask`. A later profile patch may replace the complete `computer-use-permission-policy` row config with deployment-specific decisions. Provider overrides belong on the `computer-use-cinlan` row; a patch replaces that row's complete config, after which omitted fields use the Provider package defaults.

## Model Experience

### Local desktop Computer Use tools

#### What the model sees

When the bundle is present, the model receives `computer_list_apps`, `computer_list_windows`, `computer_observe`, `computer_pointer`, `computer_keyboard`, and `computer_accessibility` plus the stable desktop guidance owned by [`@deepseek-ai/dsh-tool-computer-use`](../../computer-use/tool-computer-use/README.md#model-experience). Calls that have not been approved return the class-specific approval text owned by the permission-policy package.

#### Token effect

The tool schemas and Computer Use guidance add a fixed request-prefix contribution. Application, window, accessibility-tree, action, and optional screenshot results are operation-dependent.

#### KV Cache effect

The prefix is stable for a fixed bundle and child-package configuration. Adding or removing the bundle, or changing tool configuration that alters a schema or prompt, invalidates reuse from that point in the request prefix.

## Known Limitations and Deferred Work

- **Base services are required** - the bundle expects the profile to supply subprocess, attachment, system-prompt, and tool services, normally through `dsh-base`. Optional LLM route metadata enables screenshot capture for image-capable models; without it, observations retain the accessibility tree and skip screenshots.
- **Every operation asks by default** - a surface without an approval answerer rejects Computer Use calls until its profile supplies a different explicit policy.
- **Cinlan CLI availability is external** - the configured executable must be installed, authenticated, and expose a protocol-version-1 `computer` command with application and window listing.
- **The bundle is not a desktop application** - it contributes a CLI-backed capability to existing CLI or Web profiles; it does not ship a Windows, macOS, or Linux native client shell.
- **Other device families remain separate** - the composition does not add persistent Browser, Mobile Device, Android/iOS emulator or simulator, Speech/Audio, microphone, speaker, STT, or TTS capabilities.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
