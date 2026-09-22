# Agent Note: Desktop packages boot peer dependencies

Status: implemented

English | [中文](2026-09-22-desktop-boot-peer-dependencies.zh.md)

## Problem

The Electron development tree resolves Cordis packages through workspace links, but the packaged Desktop shell collects only its production dependency tree. `dsh-app-boot` imports Cordis and its required Loader, Include, Group, home, launch-environment, and system-prompt peers at runtime, so leaving those peers outside the Desktop production manifest produces an application that fails before startup. The release tarballs for `dsh-workspace` and `dsh-execution-binding` also contain tsdown-generated top-level chunks imported by `lib/index.js`; excluding those chunks produces the same startup failure after offline installation.

## Decision

`apps/desktop/package.json` declares every non-optional runtime peer of `@deepseek-ai/dsh-app-boot` in `dependencies`. The package-selection test models the complete direct dependency set and rejects listings that omit any member. The two packages with generated top-level chunks include `lib/*.js` in their publish files so every relative runtime import survives `pnpm pack`.

## Alternatives considered

**Bundle the boot package into the Electron main bundle:** Rejected because Desktop keeps the shared boot package as a separately resolved runtime package and package preparation already owns its production closure.

**Rely on transitive peer installation:** Rejected because electron-builder receives the Desktop package's production dependency selection; the application entry must own the runtime packages it requires.

**List generated chunk names individually:** Rejected because tsdown content hashes change between builds; the package files rule must match all top-level JavaScript chunks without depending on a generated name.

## Consequences

Desktop release preparation now retains `@deepseek-ai/cordis` and the required boot peers in the staged installation, so the packaged Electron main process can resolve `dsh-app-boot` without workspace-only links. The workspace and execution-binding tarballs retain their generated chunks, so the offline profile can import their entrypoints. The manifest has a larger direct dependency list, which makes the runtime contract explicit and lets the existing dependency-selection validation detect future omissions.
