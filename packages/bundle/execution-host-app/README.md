---
description: "Standalone stdio worker profile for authenticated SSH directory inspection with explicitly exported roots."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-execution-host-app`

English | [中文](README.zh.md)

## Summary

This standalone bundle supplies the supported `dsh --profile execution-host` worker. It mounts local process identity, filesystem and subprocess providers, and the bounded execution-host protocol. It starts no Agent, model adapter, HTTP listener, or SDK Session server.

## Table of Contents

- [Use the worker](#use-the-worker)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use the worker

Install the same Harness version on the target and configure OpenSSH authentication and known-host verification on the connecting Host. The [saved target owner](../../execution-host/execution-host-targets/README.md) launches the fixed worker command through a saved SSH configuration alias; it does not accept arbitrary remote commands. Launch and inspect the shipped composition with:

```sh
dsh --profile execution-host --dump-default-config
dsh --profile execution-host
```

The worker exports **no roots by default**. On the target, replace the `execution-host-worker` configuration in `$DSH_HOME/profiles/execution-host/cordis.patch.yml`, retaining the desired bounds:

```yaml
- id: execution-host-worker
  config:
    roots:
      - id: workspace
        label: Workspace
        path: /srv/workspace
    maxFrameBytes: 262144
    operationTimeoutMs: 30000
    maxEntries: 1000
    maxResultBytes: 131072
    maxConcurrentOperations: 16
    maxCompletedOperations: 256
```

Use an existing target-owned absolute path, with native Windows path syntax on Windows. A remote root never becomes a local Harness Workspace. The [worker](../../execution-host/execution-host-worker/README.md) validates containment and process identity for each inspection. Standard output belongs exclusively to protocol frames; diagnostics use standard error. Profile and home patches apply at startup, not through live reload.

## Model Experience

None, as the standalone worker registers no prompt, model tool, or Session event and forwards no model credentials or Agent permissions.

#### KV Cache effect

The worker sends no model request and creates no cached context.

## Known Limitations and Deferred Work

- Only read-only, bounded directory inspection is exported. Saved targets do not provide remote Session or Workspace routing, generic command execution, file upload, or device control.
- Empty roots are a real unconfigured state, not permission to inspect the login directory. Target administrators must choose exported roots explicitly.
- Trusted profile patches can expand the process composition or corrupt standard output. Keep the dedicated profile restricted to its supported worker protocol.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published: the bundle owns static composition and retains no independent observation of worker operations or connection state.
