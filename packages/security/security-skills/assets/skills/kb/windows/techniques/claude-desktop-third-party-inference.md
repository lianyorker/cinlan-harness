---
id: "windows/claude-desktop-third-party-inference"
title: "Claude Desktop Windows third-party inference mode"
summary: >
  Verified configuration and troubleshooting notes for running Claude Desktop on
  Windows in official third-party inference (3P) mode without Claude.ai sign-in.
board: "windows"
category: "techniques"
signals:
  - "Claude Desktop"
  - "third-party inference"
  - "Not logged in"
  - "Configure Third-Party Inference"
  - "disableDeploymentModeChooser"
  - "Claude-3p"
keywords:
  - "Claude Desktop"
  - "Windows"
  - "3P"
  - "custom gateway"
  - "managed configuration"
  - "Anthropic-compatible API"
difficulty: "intermediate"
tags:
  - "desktop"
  - "configuration"
  - "electron"
  - "api-gateway"
language: "en"
last_updated: "2026-08-11"
related_articles: []
---

# Claude Desktop Windows Third-Party Inference

## Scope

These notes cover the official Claude Desktop 3P deployment mode. They do not apply to Claude Code CLI configuration under `~/.claude/settings.json`.

Verified against Claude Desktop `1.26832.0.0` (MSIX/Electron) on Windows.

## User-facing setup entry

Before signing in:

1. Open the top-left application menu.
2. Select `Help -> Troubleshooting -> Enable Developer Mode`.
3. Select `Developer -> Configure Third-Party Inference...`.
4. Apply the configuration locally and fully restart the app.

The setup page is loaded internally from:

```text
app://localhost/setup-desktop-3p
```

## Local configuration paths

The 3P configuration is separate from normal Claude Code and Desktop settings:

```text
%LOCALAPPDATA%\Claude-3p\claude_desktop_config.json
%LOCALAPPDATA%\Claude-3p\configLibrary\_meta.json
%LOCALAPPDATA%\Claude-3p\configLibrary\<uuid>.json
```

`_meta.json` identifies the applied configuration. The selected UUID file stores flat 3P keys. `claude_desktop_config.json` persists the deployment mode.

Minimal deployment-mode state:

```json
{
  "deploymentMode": "3p",
  "awaitingSignIn": false
}
```

## Minimal static gateway configuration

```json
{
  "inferenceProvider": "gateway",
  "inferenceCredentialKind": "static",
  "inferenceGatewayBaseUrl": "https://gateway.example.com",
  "inferenceGatewayApiKey": "<secret>",
  "inferenceGatewayAuthScheme": "bearer",
  "modelDiscoveryEnabled": true,
  "disableDeploymentModeChooser": true
}
```

`disableDeploymentModeChooser=true` is the flat key whose UI title is `Disable Claude.ai sign-in`. It hides the first-party login choice and starts the configured 3P deployment directly.

For Anthropic-style `x-api-key` authentication, use:

```json
{
  "inferenceGatewayAuthScheme": "x-api-key"
}
```

Practical mapping:

| Existing client setting | Desktop gateway setting |
|---|---|
| `ANTHROPIC_AUTH_TOKEN` | `bearer` |
| `ANTHROPIC_API_KEY` | `x-api-key` |

Never print the credential while copying it between stores.

## Model discovery

With `modelDiscoveryEnabled=true`, a gateway provider is queried at:

```text
<inferenceGatewayBaseUrl>/v1/models
```

If the endpoint is unavailable, set `modelDiscoveryEnabled=false` and provide an `inferenceModels` JSON array. Gateway model IDs must look like Anthropic/Claude models, for example:

```json
[
  {"name":"claude-opus-4-8","anthropicFamilyTier":"opus","isFamilyDefault":true},
  {"name":"claude-sonnet-4-5","anthropicFamilyTier":"sonnet","isFamilyDefault":true}
]
```

The first entry is the default. Non-Claude model names are rejected by the Desktop model guard even when the upstream gateway can translate protocols.

## Windows managed configuration

Claude Desktop also reads policy values from:

```text
HKCU\SOFTWARE\Policies\Claude
HKLM\SOFTWARE\Policies\Claude
```

`HKLM` takes precedence and locks the setup window as managed. Some managed Windows environments deny writes below the user `Policies` key; use the local configuration library for single-machine evaluation when that occurs.

## Local policy and audit boundaries

The following official bootstrap keys control user-local Cowork and Code behavior:

```json
{
  "autoModeEnabled": true,
  "mcpPersistentAlwaysAllowEnabled": true,
  "requireCoworkFullVmSandbox": false
}
```

`builtinToolPolicy` defaults to `allow`; an explicit `ask` value adds per-call approval. Leaving `allowedWorkspaceFolders` unset avoids a profile-level folder allowlist. A locally relaxed profile can also omit `disabledBuiltinTools` and `coworkEgressAllowedHosts`. Registry or MDM policy still takes precedence, and Auto mode continues to run the Desktop action classifier.

Local agent sessions can contain:

```text
local-agent-mode-sessions/**/.audit-key
local-agent-mode-sessions/**/audit.jsonl
```

`.audit-key` protects an HMAC-chained local audit log. Backing up and deleting these files clears local session audit material, but Desktop can recreate them. It does not disable gateway-side review, model-side content policy, managed configuration, or the Auto mode classifier. Automation should back up tracked files, merge JSON instead of replacing it, avoid printing credentials, and not patch the signed `app.asar` or application bundle.

The corresponding macOS 3P root is:

```text
~/Library/Application Support/Claude-3p
```

## Troubleshooting sequence

1. Confirm the app opens an `app://localhost/cowork/...` page instead of `https://claude.ai/login`.
2. Confirm the provider, base URL, token, and auth scheme came from the same provider profile. Configuration switchers can produce a mixed URL/token pair.
3. Probe `<baseUrl>/v1/models` with the configured auth scheme without logging the token.
4. Fully terminate all packaged `Claude.exe` processes before relaunching.
5. Inspect the UI model picker. Successful discovery proves the configuration, credential, and model-list path were accepted.
6. Send a minimal prompt to verify the complete Desktop -> gateway -> model path.

Common failures:

| Symptom | Cause |
|---|---|
| Standard Claude.ai login page | No valid 3P config or `deploymentMode` remained `1p` |
| `401 Authentication Fails` | Wrong token, mixed provider profile, or wrong auth scheme |
| No models available | `/v1/models` missing and no fixed `inferenceModels` list |
| Config ignored until restart | Desktop was still running when settings changed |

## References

- https://claude.com/docs/third-party/claude-desktop/installation
- https://claude.com/docs/third-party/claude-desktop/in-app-configuration
- https://claude.com/docs/third-party/claude-desktop/mdm
