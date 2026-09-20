# Agent Note: Package and update the Electron desktop application

Status: implemented

English | [中文](2026-08-25-electron-desktop-packaging-and-updates.zh.md)

## Problem

DeepSeek Harness needs an Electron desktop application that reuses the Web UI, works without system Node.js or pnpm, installs dsh and desktop plugins through an application-bundled pnpm, and updates the complete desktop release through one user-facing flow.

The desktop application and an npm-installed dsh share the `.dsh` data root, but they may have different dsh and plugin versions. They must share supported product data without sharing executable packages, lockfiles, `node_modules`, plugin activation, or package-manager configuration.

The current GUI protocol binds the Web client and backend release. Independently versioning the Electron artifact and its pnpm-installed dsh would create unqualified shell, client, backend, and plugin combinations and make update availability ambiguous.

## Decision

Ship a small Electron shell with a bundled upstream Node.js executable and pinned pnpm. Electron starts the private Desktop Host package as an isolated child process; that package composes the installed dsh backend and matching client graph. Fetch metadata and bounded raw request and response chunks travel over two versioned framed byte pipes, Node IPC carries readiness, fatal failure, shutdown acknowledgement, and update task controls, and Electron serves validated assets through `dsh-app://`; it opens no listening port. Each frame carries a fixed marker, type, monotonic stream id, payload length, and validated payload. Serialized writers honor pipe drain, readers pause globally when a request or response stream applies backpressure, cancellation closes the matching stream, and late response frames for a retired stream stay inert. The Connection plugin provides its carrier-neutral RPC and Fetch registries without requiring `webServer`, while Client Modules provides the exact advertised combo-bundle responses to the shell-owned carrier; Web compositions attach their optional HTTP routes for both. The renderer keeps the same Fetch, RPC, and Remote-stream formats, while the child carrier avoids Base64 expansion and V8 serialization compatibility between Electron and the bundled upstream Node.js. Electron closes its request-pipe writer after sending shutdown, releasing an in-flight Windows pipe read before it waits for child exit. This follows the Electron reservation in the [GUI layering and RPC protocol note](../../archived/architecture/2026-07-19-gui-layering-and-rpc-protocol.md).

Electron owns the reserved profile at `.dsh/profiles/desktop`. Its exact `@deepseek-ai/dsh` dependency supplies the backend and matching Web UI, while the matching private `@deepseek-ai/dsh-desktop-host` dependency supplies only the Electron child-process entry and composition overlay. The dsh release, private Host, and their first-party dependency closures use local npm tarballs packed from the same source build; the profile manifest lists every core package as a local `file:` dependency, and `pnpm-workspace.yaml` repeats the mapping as overrides. The Host remains outside the public CLI package and is never published to npm. Desktop plugins are additional registry npm dependencies and ordered `dsh.profile.bundles` entries in the same profile, and resolve from its one `node_modules`.

One Desktop release number identifies the Electron artifact and its exact `@deepseek-ai/dsh` and `@deepseek-ai/dsh-desktop-host` dependencies. A release cannot select a different core version at build or runtime. Updating dsh therefore requires a new Electron release even when shell code is unchanged.

The browser Web UI, dsh backend, existing `dsh plugin` CLI, user npm, and user pnpm cannot mutate this profile's package graph. The Desktop Host accepts individual plugin enablement through its launcher-owned configuration capability; its patch reader retains mandatory Desktop overlays and never repairs shared CLI resolver links. The CLI reserves every case variant of the `desktop` name and rejects boot, config-dump, and plugin-management requests for it. Electron acquires its process-lifetime single-instance lock before project recovery or Host startup; later launches focus or recreate the primary window without touching profile state. An Electron-only GUI sends structured install, remove, and update requests through preload; Electron invokes only its bundled pnpm.

## Ownership

| Owner | Responsibility |
|---|---|
| Electron shell | Window and child lifecycle, framed byte pipes, lifecycle IPC, custom protocol, reserved desktop profile, plugin GUI, update coordination, rollback |
| Bundled Node.js and pnpm | Execute dsh and install exact desktop-project dependencies without consulting user `PATH` or pnpm state |
| Desktop profile | One dependency graph, ordered bundle list, and `node_modules` for the desktop dsh package and desktop plugins |
| Private Desktop Host package | Electron-only child-process entry and composition overlay installed with dsh but excluded from the public CLI package and npm publication |
| Installed dsh package | Backend, matching Web UI, boot manifest, client bundles, and product behavior |
| Shared `.dsh` owners | Sessions, settings, credentials, workspaces, and storage, guarded by their existing locks and format versions |
| npm-installed dsh | Its own executable installation and user-managed profiles; no access to the reserved desktop profile or package state |

The renderer uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Preload exposes typed RPC, lifecycle, update, locale, and desktop-plugin actions rather than raw `ipcRenderer`, filesystem access, shell commands, or pnpm arguments. Electron selects a typed English or Chinese dictionary from its application locale and falls back to English; menus, native dialogs, and the plugin-management renderer use that locale-owned copy.

The [floating workspace ownership decision](2026-09-17-floating-workspace-command-ownership.md) specifies admission and cleanup for an app-owned child within this same Host and artifact ownership.

## Filesystem layout

```text
~/.dsh/
  desktop/
    staging/<transaction-id>/profile/
    rollback/profile/
    pending.json
    lock
    pnpm/
      store/
      cache/
      state/
      config/
  profiles/
    desktop/
      package.json
      pnpm-lock.yaml
      pnpm-workspace.yaml
      desktop-release.json
      desktop-packages.json
      desktop-packages/
      node_modules/
  sessions/
  storages/
```

`.dsh/profiles/desktop` is the only active desktop profile. Its package manifest records the built-in and installed plugin bundle order; Electron alone mutates its dependencies, lockfile, and `node_modules`. Production startup rejects a bundle resolved outside this profile, including the CLI-maintained `.dsh/profiles/node_modules` fallback. Package content installed for the desktop profile uses `.dsh/desktop/pnpm/store`.

## Installation and resolution

The installer never mutates the active profile in place. It copies profile metadata, including the saved `cordis.patch.yml`, into a transaction staging directory and applies an exact dependency change with the bundled pnpm. Electron stops and drains the active Host before copying metadata, then starts and stops the staged backend alone. The active backend stays stopped until activation or safe failure recovery, so configuration writes cannot race the snapshot and two Desktop backends never concurrently share `.dsh` state. Release reconciliation preserves the same saved patch. Activation persists each next `pending.json` phase before its corresponding filesystem move, moves the active profile to `rollback/profile`, moves staging into `.dsh/profiles/desktop`, and restarts. Recovery combines the write-ahead phase with the actual active, rollback, and staging directories so either write-to-move interruption retains or restores a complete profile.

The process-lifetime Electron lock is the authoritative Desktop owner. The package transaction lock is depth defense and records the process that can still mutate package state: Electron between package operations and the spawned pnpm PID while pnpm runs. The owner change is truncated, written, and synchronized through the already-open exclusive lock file. If Electron terminates during pnpm execution, a later process observes the live worker and refuses to start a competing store or staging transaction; after that worker exits, the stale PID can be recovered.

The packaged seed is an offline installation kit, not an executable dsh tree. It contains the release identity, initial desktop-project manifest, a descriptor and immutable tarballs for the union of the first-party package closures rooted at dsh and the private Desktop Host, lockfile, integrity inventory, and required store subset. Each `mac-arm64`, `mac-x64`, and `win-x64` build owns its packed packages, runtime, package set, seed, pnpm preparation state, unpacked application, update metadata, and final artifacts under `.desktop-build/targets/<target>`; only the immutable, checksum-verified Node.js download cache is shared. The release build requires the Electron package, root dsh package, and private Host package to have the same version, creates final npm tarballs from the official source build, locally packs the private Host, selects the reachable dsh, Host, and vendored packages plus the Landlock entry, and verifies that the Host tarball contains `lib/index.js` and `config/desktop.cordis.patch.yml`. The Host `files` manifest contains only that runtime entry and overlay, and the package is never published to npm. Public package tarballs remain the official `pnpm pack` results governed by each package's publication manifest; Desktop does not remove published declarations or otherwise create a second package-content policy. The seed manifest lists every selected package as a local direct dependency, automatic peer installation is disabled, and the workspace file overrides every selected first-party name to its local tarball. The target Node.js executes bundled pnpm, so pnpm's operating-system and CPU selection makes the materialized dependency graph and seed target-specific. Bundled pnpm disables its global virtual store, materializes external production dependencies from npm without lifecycle scripts, deletes `node_modules` and every temporary pnpm cache, config, and state directory, then performs a clean offline installation from the final store alone and checks the private Host entry and overlay. The build rejects any lockfile that resolves one of the local first-party names by registry version. Inventory generation follows removal of that second `node_modules` tree and temporary pnpm project registrations. Requiring both Host files before copying the package set and after offline installation prevents a release whose process entry loads but cannot compose its required overlay from reaching application signing.

The seed stores pnpm content in 16 deterministic uncompressed tar shards selected by normalized store path. Apple notarization inspects Mach-O code inside those archives, so macOS seed preparation stages every referenced Mach-O content-addressed object and runs at most four independent Developer ID signers concurrently with a secure timestamp and hardened runtime. A signer failure is observed only after every active signer exits and leaves the original CAS objects and package index unchanged. After all signers succeed, preparation writes each object at its new SHA-512 path and transactionally rewrites every base and side-effects file reference in pnpm's MessagePack SQLite index. A second offline installation proves that pnpm resolves the rewritten store; preparation then shards it, extracts the final archives, and verifies every embedded signature. Package paths and non-native bytes remain unchanged, and the seed retains bundled architecture variants because removing files would create a Desktop-specific package file set. Seed integrity covers the shard manifest and every archive before extraction. Installation and reconciliation validate archive paths, entry types, uniqueness, and counts, extract every shard into a unique Desktop-owned staging directory, replace matching immutable store files, and transactionally merge each pnpm store version's SQLite `package_index` into `.dsh/desktop/pnpm/store`. Seed records replace matching keys while records downloaded for Desktop plugins remain. An interrupted file merge may leave valid immutable cache content, but each SQLite merge is atomic, and profile installation and activation still require pnpm integrity and the complete health check.

Startup requires the packaged release version to equal Electron's application version. Every reuse of `.dsh/profiles/desktop` verifies both the seed and active core tarballs and compares the normalized release metadata, installed dsh and Desktop Host versions, and complete core-package descriptors. Equal version numbers alone do not establish content identity: every tarball's name, version, filename, size, and SHA-512 integrity must match, as must the bundled Node.js and pnpm versions. An exact match reuses the installed profile without reading the full seed integrity inventory or store archives, which are unused installation inputs. Corrupt core tarballs fail verification; valid content differences, including under the same version, require full seed integrity verification before the staging transaction. That transaction installs the seed manifest and lockfile with `pnpm install --offline --frozen-lockfile --trust-lockfile` and restores every registered plugin bundle at its exact installed version through one offline pnpm add from the existing desktop store and metadata cache. The complete graph must pass the same health check before activation, while shared settings and Session data remain outside the replaced profile.

Recovery runs only after the transaction lock is acquired and performs journal validation, necessary profile moves, and journal-file unlinking. The activation journal atomically replaces each persisted preparation, active-profile movement, staging activation, and commit record. Recovery restores rollback for an interrupted activation and retains the journal when restoration is incomplete; a committed journal retains the active profile. Rollback rotation and failed replacement move discarded profiles into fresh UUID staging roots so activation and recovery do not wait for recursive deletion. A partially started replacement backend must stop before rollback restoration; failed shutdown retains the journal and profile directories. Windows profile moves and owned staging cleanup retry transient file-handle errors within a bounded interval. Startup failures write a stack trace to `$DSH_HOME/desktop/startup-error.log` unless an explicit diagnostic path is configured.

After the main application loads and after plugin mutations, Electron calls `cleanupOrphanedStaging(signal?)` for asynchronous maintenance under the transaction lock. A pending journal or a retained non-active Host prevents cleanup. Maintenance removes only direct UUID staging roots, unlinks root symlinks or junctions without traversing them, and leaves the rollback profile untouched. Invalid or unowned staging paths and failed removals produce maintenance warnings and leave residue for a later run. Plugin mutations await current maintenance and stop any retained failed Host before journal recovery; a failed health-check Host must stop before the active backend restarts. Exit cancels maintenance between roots and joins any removal already in progress. Canceled startup can retain orphan staging until a later successful startup.

The plugin GUI performs registry npm-package operations equivalent to `pnpm add <package> --save-exact`, `pnpm remove <package>`, and exact-version update in staging. Every mutation retains the local core-package descriptor, tarballs, dsh and Desktop Host dependencies, and complete override map. Electron validates the installed package manifest and updates the profile's dependency and ordered bundle entries; no renderer request can choose the registry, install directory, lifecycle policy, or arbitrary pnpm flags.

The Electron-builder production collector selects only `@deepseek-ai/dsh-desktop` through a builder-only pnpm filter. It retains the complete shell dependency tree, including both direct runtime dependencies and their transitive versions; source builds and seed preparation use separate graphs. A preflight records the selected JSON tree and rejects extra project roots or missing direct shell dependencies before installer creation. The backend and Loader use `.dsh/profiles/desktop/package.json` as their profile manifest and npm resolution anchor. The shared profile loader composes its ordered bundle entries, then the private Desktop Host applies its packaged overlay. The Host, dsh, Cordis, desktop plugins, plugin dependencies, and peer dependencies resolve through the ordinary pnpm `node_modules` graph. A desktop plugin contributing `dsh.client` code enters the boot manifest only after the complete profile passes health checking.

## Updates and recovery

Electron uses one signed Desktop release stream for shell and seed. Metadata checks never download automatically. Download and exact-version installation consent are separate; the native Host closes API admission, drains admitted requests, and rechecks running or queued agents and jobs before clean shutdown. An acknowledgement plus exit code zero authorizes installer handoff. Confirmed but unclean exit refuses installation and permits one replacement Host; an unconfirmed exit forbids replacement. The permanent startup cancellation belongs to final application quit, not recoverable update preparation.

Mandatory decisions belong to the main process and can cancel ordinary confirmations without cancelling existing tasks. The native carrier enforces admission because it dispatches Fetch and remote streams without the Web connection/request event. A remote opening remains admitted until wireStream.open settles; response/SSE lifetime is not an admitted write. A generation change cancels a pending lock. Profile repair uses the existing Desktop transaction lock and activation recovery before filesystem-only bundle disabling; a second backend or profile lock would allow competing writers.

The optional update journal records only fixed, redacted lifecycle evidence. It neither restores mandatory state nor replaces the activation journal. Product windows receive semantic status/open operations, while main-owned shell documents hold installation consent. Floating and plugin windows cannot bypass mandatory blocking.

The primary window paints the application's shared `HARNESS` / `Loading plugins…` view before reconciling dsh from its packaged seed while retaining installed desktop plugins. Desktop's Vite renderer bundle imports `BootPage` and its CSS through the Web boot kernel's public [`./boot-page` entry](../../../../packages/client/web/README.md#use-this-package), keeping one maintained loading view available before the Host starts. Preparation stages remain internal; normal loading shows only the shared view, while a startup error reveals localized diagnostics and safe restart/exit actions. After backend readiness, the same window navigates from the shell document to the installed application document, which creates the same view with fresh DOM and animation state. Only the exact shell startup document receives the lifecycle preload bridge; the application receives its protocol marker and an action that opens the native Plugins window. The action accepts only `dsh-app://app` without a port; package operations remain restricted to the shell renderer. After an applied plugin switch and refreshed inventory, the application renderer reloads once to apply client plugin contributions while the Host remains running.

Profile preparation runs in a worker: archive extraction and package verification can perform synchronous work without starving Electron's window event loop. The health check covers dependency resolution, native modules, shell API compatibility, backend startup and shutdown, Web assets, and the client boot graph. An incompatible plugin blocks activation and leaves the previous project available for rollback; the application UI remains bound to the verified installed release.

Native window close during preparation requests cooperative cancellation. An in-flight pnpm operation finishes before cancellation is observed at a transaction checkpoint; the shell awaits transaction work, the probe Host, and worker exit before quitting. A probe that fails to stop retains the transaction lock and staging files while cleanup retries; cancellation joins the same cleanup. Forcing worker termination could leave a package operation writing after Electron releases its ownership lock. A restart therefore starts a new application only after the current startup and backend work have stopped. Native editing and macOS window/application roles remain in the menu independently of backend availability.

`DSH_DESKTOP_AUTO_UPDATE_ENV` selects the test deployment by default or the production deployment for both the target-specific generic-provider URL and COS destination. Release automation supplies the test HTTPS origin through `DOWNLOAD_TEST_ORIGIN` and each deployment's bucket through `DOWNLOAD_TEST_COS_BUCKET` or `DOWNLOAD_PROD_COS_BUCKET`; keeping mutable test routing and COS storage identities out of source lets deployment infrastructure change without a code release, while the public production origin remains fixed. Packaging resolves only the public updater URL, disables electron-builder publishing, removes every COS credential field from its subprocess environment, and writes a completion record only after electron-builder and every signing or notarization hook succeeds. Target upload additionally requires the selected bucket, then requires the completion record, root dsh version, Desktop version, nightly channel metadata, artifact names, sizes, and SHA-512 values to agree before it reads the selected credentials or sends data. It uploads immutable versioned updater payloads and any separate blockmaps before replacing the channel metadata emitted by electron-builder, and it never deletes historical objects. Stable versions and prereleases share nightly metadata; the release owner must bridge previously installed clients consuming other channel names before publishing this feed. NSIS and the macOS ZIP each carry an external blockmap. The Windows upload plan requires the emitted nonempty `.exe.blockmap`; external-map metadata does not declare an embedded `blockMapSize`. Both let electron-updater download changed blocks when supported, while application replacement and the local pnpm staging transaction remain separate operations.

## Security and release policy

Core dsh and the private Desktop Host come only from integrity-recorded local npm tarballs inside the signed Electron release; pnpm overrides prevent transitive core packages from falling back to a registry. Store archives are integrity-checked and fully validated in an isolated extraction directory before their files can enter writable package state. Plugin installation accepts registry package specs allowed by desktop policy but never raw pnpm commands. Exact versions, lockfile integrity, a reviewed `allowBuilds` set, user-only directory permissions, redacted diagnostics, and health checking are required before activation.

Release Electron artifacts are signed; macOS artifacts are notarized. Local Windows acceptance builds may be unsigned when no EV certificate is configured; their successful packaging does not establish release signing. Release automation must supply the application ID, macOS Developer ID qualifier, expected Team ID, and one complete notarytool credential strategy through explicit environment variables. Configuration loading rejects missing or malformed identifiers and incomplete notarization credentials, while macOS packaging requires signing so certificate discovery cannot silently select another installed identity or emit an unsigned release. Seed preparation verifies the exact Authority and Team ID plus the timestamp and hardened-runtime flags on every embedded Mach-O file. An after-sign hook performs Apple's deep strict application verification and requires the same leaf Authority and Team ID before artifact creation continues. Electron-builder then notarizes and staples the application and signs the DMG. The DMG artifact-completion hook separately notarizes and staples every DMG before requiring the configured identity, a valid ticket, and Gatekeeper acceptance; the upload event runs only after that hook succeeds. DMG blockmaps are disabled because macOS updates consume the signed ZIP, and stapling would otherwise invalidate an already-generated DMG blockmap. The custom protocol serves the installed frontend distribution plus client files named by the active module graph and rejects traversal or access outside those roots. The plugin installer API is available only to the Electron-owned management GUI and is absent from the browser application and backend RPC.

Windows release packaging supplies the public EV leaf certificate named by `DSH_DESKTOP_WINDOWS_CER_FILE` to the configured SafeNet-compatible SignTool through `/f` and identifies its matching private key through the required `DSH_DESKTOP_WINDOWS_KEY_CONTAINER`. The certificate file remains outside source control, and the private key remains on the USB token. The electron-builder hook passes each artifact to the CRLF `windows-sign.cmd`, whose single SignTool invocation uses the SafeNet `/kc "[{{PIN}}]=container"` value and CSP, a SHA-256 file digest, and a DigiCert SHA-256 RFC 3161 timestamp. The hook never substitutes another SignTool and never retries a failed request. Package orchestration withholds every `DSH_DESKTOP_WINDOWS_*` field from build and seed-preparation children and passes only the certificate path, SignTool path, key container, and PIN into electron-builder. The signer supplies only validated signing fields in an otherwise scrubbed CMD environment; the CMD disables delayed expansion, clears those fields before SignTool starts, and preserves the PIN only in the required SignTool command line. Every surfaced diagnostic replaces the PIN, and only the dedicated build account and administrators may inspect the runner. The signer signs electron-builder's temporary NSIS bootstrap before enterprise Code Integrity evaluates that executable and clears a generated executable's certificate-table entry only when it points beyond the file before applying the final signature. When EV signing is configured, packaging fails before producing unsigned artifacts if the SignTool, certificate, container, PIN, token, or signature is unavailable. The custom protocol serves the installed frontend distribution plus client files named by the active module graph and rejects traversal or access outside those roots. The plugin installer API is available only to the Electron-owned management GUI and is absent from the browser application and backend RPC.

Packaged applications ignore development resource and project environment overrides. Only an unpackaged Electron process can replace the Node.js binary, pnpm entry, seed, or active project.

The bundled upstream Node.js and pnpm are expected to add about 35–50 MB compressed and 120–165 MB installed before the seed store subset. Architecture-specific builds must report actual component-level size deltas.

## Implementation

| Surface | Implementation |
|---|---|
| Shell | `apps/desktop` owns Electron windows, restricted preloads, the custom protocol, child lifecycle, project transactions, the plugin GUI, update coordination, and electron-builder configuration. |
| Installed runtime | Private `@deepseek-ai/dsh-desktop-host` boots the portless desktop composition from the active project and streams API and asset responses over validated framed byte pipes. |
| Package state | The release seed and every later mutation run through bundled Node.js and pnpm with desktop-owned store, config, cache, state, and home paths; core packages resolve from release tarballs while plugins resolve from the fixed npm registry. |
| Qualification | macOS packaging requires the configured company identity and notary credentials, verifies every native seed object after final archive extraction, verifies the completed application signature, and requires notarization plus Gatekeeper acceptance for both the application and DMG. Windows EV release packaging requires the configured public certificate, SafeNet private-key container, Token Password, and SignTool, and verifies every produced signature. Update hosting, previous-version installed-artifact tests, and platform GUI recordings remain release-environment gates. |

`dev:desktop` builds the current workspace, projects the built CLI and private Desktop Host packages plus their dependency links into a disposable project, uses an isolated Harness home, opens the Main, Renderer, and Host debuggers, and starts unpackaged Electron without preparing release resources. Package mutation is disabled in this mode because its linked dependency graph is not a pnpm-installed desktop project. Fixed macOS arm64, macOS x64, and Windows x64 package commands pass one target through runtime preparation, seed installation, and electron-builder; each also has an unpacked-directory variant for release-path verification before installer generation.

### Startup reuse measurement

After `pnpm run build:desktop`, the [startup reuse diagnostic](../../../../apps/desktop/tests/startup-reuse.perf.mjs) measures only `applyRelease()` returning `false` for an identical profile. Five Windows x64 samples under Node.js v24.9.0 use 320 synthetic 64 KiB core tarballs and 16 synthetic 34 MiB archives with a warm OS file cache and no application cache. Fixture construction, model calls, network, backend startup, and UI are outside the measured interval; memory use is unmeasured.

| Reuse path | Samples (ms) | Median (ms) |
|---|---|---|
| Baseline with full seed verification | 943.79, 1101.51, 1131.78, 1156.35, 980.52 | 1101.51 |
| Core verification with deferred maintenance | 230.98, 229.61, 232.39, 219.09, 218.50 | 229.61 |

The median for this endpoint is 79.2% lower, or 4.80 times faster. The diagnostic's bundled preparation-worker check runs outside the timed interval.

## Alternatives considered

**Use Electron's Node.js for dsh.** This saves package size but couples dsh to Electron's Node patches, fuses, native ABI, TLS behavior, and process lifecycle. A bundled upstream Node.js keeps dsh on its supported runtime.

**Carry Fetch bodies through JSON IPC as Base64.** JSON IPC keeps one message mechanism but expands every request and response body, constructs large strings in both processes, buffers each request before dispatch, and double-encodes image bytes already represented as Base64 inside RPC JSON. Raw framed pipes retain an explicit versioned protocol without relying on Electron and upstream Node.js to share V8 serialization behavior.

**Bake the product Web UI into Electron.** Independent UI and backend updates would require a new versioned compatibility program. Installing backend and Web UI from the same dsh package preserves the current release binding.

**Reuse the existing CLI or browser plugin installer.** That crosses the desktop authorization and release scope and can use the user's package-manager state. Desktop package mutation remains exclusively Electron-owned.

**Let the desktop profile use CLI-managed packages or plugins.** Either product could change the other's dependency graph, Cordis version, plugin version, or native module. The desktop profile therefore owns a complete `node_modules` and rejects bundle resolution through the CLI profile fallback.

**Install dsh and plugins into separate desktop projects.** This creates a second resolution anchor and peer-dependency fallback. One ordinary npm project already provides the required installation and resolution model.

**Revalidate the complete seed and recursively clean every orphan before profile reuse.** Store archives are installation inputs, and orphan trees do not determine whether the active release can run. Reading or deleting them delays backend startup. Reuse verifies both core package sets and release metadata; installation still requires full seed verification, and later cleanup remains serialized under the transaction lock.

**Remove non-target Mach-O files from registry packages.** Architecture pruning saves a small amount of seed space, but packages can deliberately ship several architecture variants and callers can observe their installed file set. Signing every shipped Mach-O object satisfies notarization without inventing a Desktop-specific package layout.

**Export the Windows EV private key in a PFX file.** The externally supplied public leaf certificate lets SignTool construct the signature while `/csp` and `/kc` locate the hardware key. The EV private key remains non-exportable on the token.

**Commit a credential-bearing signing script or persist the Token Password.** A credential-bearing CMD file, `.env`, or Windows user or system environment variable leaves the Token Password recoverable at rest. The checked-in CMD contains only environment-variable references, and the packaging step accepts the password as an ephemeral runner secret.

**Let electron-builder or a general directory sync publish directly.** A direct publisher can expose channel metadata before every referenced artifact exists, mix stale or cross-target files into a release, and cannot prove that the completed signed build still matches the current dsh version. A target-specific validated upload keeps publication ordering and release identity explicit.

## Consequences

- A clean offline machine with no system Node.js or pnpm installs the seed into `.dsh/profiles/desktop` and starts a working dsh session.
- The signed application inventories a fixed small set of seed store shards instead of every pnpm cache file; every Mach-O object inside the macOS shards has the release Developer ID, secure timestamp, and hardened runtime, every Windows EV release artifact has the configured hardware-backed EV signature, and the installed private store retains the ordinary pnpm layout.
- `.dsh/profiles/desktop/node_modules` contains and resolves the desktop dsh package and every GUI-installed desktop plugin.
- Every desktop pnpm operation uses the bundled executable and `.dsh/desktop/pnpm/store`; none reads user `PATH`, config, store, or profile `node_modules`.
- The Electron-only GUI installs, removes, and updates ordinary npm plugin packages without exposing raw pnpm arguments.
- The backend and browser application cannot mutate desktop packages.
- npm/CLI dsh and Electron never resolve or install plugins from each other's `node_modules`.
- The primary window shows the shared application loading view before profile preparation, and loads the application only after its active backend and Web UI report the same dsh version and a compatible shell API.
- Failed installation, health checking, or update leaves the current profile usable or restores `rollback/profile` after restart.
- One Desktop version binds Electron and dsh; every dsh update arrives through one Electron update dialog and one user-visible restart.
- Shared `.dsh` data rejects incompatible readers before migration or mutation.
- No loopback listener is opened, and the sandboxed renderer cannot access arbitrary filesystem or Electron APIs.
- Workspace development runs current built code without downloading release resources, while unpacked-package verification retains the production installation path.
- Windows release packaging requires the validated SignTool, EV token, matching public leaf certificate, Token Password, and explicit key container; it never falls back to an unsigned artifact or an exportable key file.
- A target update cannot expose new channel metadata until the completed signed build and every referenced artifact pass release validation; retained historical artifacts remain available for differential updates.
- Signed installed artifacts update successfully from the previous supported release on each release-blocking platform.

## Review decisions

| Decision | Recommendation |
|---|---|
| First launch | Bundle an offline seed store subset and install it through pnpm |
| Desktop profile | One Electron-owned reserved profile containing exact dsh and plugin dependencies |
| Plugin management | Electron-only GUI and package service; no CLI, backend, or browser installation path |
| Activation | Staging project, complete health check, journaled directory replacement, one rollback copy |
| Initial platforms | macOS arm64/x64 and Windows x64; Linux has no supported release target |
| Update behavior | Background check, explicit confirmation before differential download and restart, startup dsh reconciliation |

## Risks

Plugin lifecycle scripts execute third-party code. The allowed registry, package policy, exact versions, integrity, `allowBuilds`, and diagnostics require security review before GUI installation ships.

Updating the bound dsh can invalidate plugin peer dependencies or native modules. pnpm resolution and full-project health checking must reject the staged project before replacing the active one.

An npm-installed dsh and desktop dsh may have different versions while sharing durable data. Each shared owner must enforce its format version and process lock before reading, migrating, or writing.

Directory replacement differs across operating systems and can be interrupted. The activation journal and installed-artifact fault tests must prove recovery at every filesystem move.

Code signing, notarization, and update hosting require production release infrastructure. Repository tests alone cannot complete that qualification.
