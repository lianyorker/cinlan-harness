---
description: "Cinlan-private Web composition layer for the Cinlan Harness fork: notifications, git, worktree, execution hosts, MCP, voice, usage, security research, and Cinlan Design Studio rows kept out of dsh-web-app."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-web

English | [中文](README.zh.md)

Cinlan-private Web composition layer for the Cinlan Harness fork.

## Summary

`dsh-cinlan-web` is a patch-only bundle that carries every Cinlan-private
composition row that used to live inside `dsh-web-app`. Keeping those rows in a
separate bundle lets `packages/bundle/web-app/` track upstream
`deepseek-ai/deepseek-harness` with only the mounting-point differences the fork
still needs.

## Use this package

The `web` profile template already lists this bundle right after
`@deepseek-ai/dsh-web-app`; `dsh` resolves its `cordis.patch.yml` automatically
when the profile selects it.

### What you get

- Notifications, quick commands, and the working-directory rows.
- Git source control, sidebar git, and worktree task surfaces.
- Execution host rows (local, targets, binding, runtime, controller).
- MCP registry, management, and controller rows.
- Voice dictation and sherpa-onnx rows.
- Usage query and usage controller rows.
- Security research controller and security skills rows.
- Cinlan Design Studio, mobile host tunnel, and the Cinlan settings surfaces.

## Understand the implementation

The bundle ships only `cordis.patch.yml`; `src/index.ts` exists solely so the
workspace build has an artifact. Each row is an `- insert:` entry that resolves
its package through this bundle's `dependencies`, so every mounted package is
listed there explicitly.

## Further exploration

- `packages/bundle/web-app/cordis.patch.yml` 鈥?the upstream-tracked layer this
  bundle builds on.
- `packages/bundle/security-research/` 鈥?the Security Research preset bundle.
