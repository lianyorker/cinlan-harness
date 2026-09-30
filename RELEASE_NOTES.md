# Cinlan Harness (星澜 Harness) v0.2.0-rc.1 Release Notes

We are excited to announce the initial release of **Cinlan Harness (`clh`)** (星澜 Harness), a deeply isolated, brand-reimagined agent harness forked and evolved from the DeepSeek Harness ecosystem.

- **Release Version**: `v0.2.0-rc.1`
- **Release Date**: 2026-09-30
- **Repository**: [https://github.com/lianyorker/cinlan-harness](https://github.com/lianyorker/cinlan-harness)

---

## 🌟 Key Highlights & Milestones

### 1. Dual-Namespace CLI Branding & Command Matrix
- **Primary CLI Command**: Introduced `clh` (Cinlan Harness) as the primary launcher command.
- **Full Formal Alias**: Added `cinlan-harness` alias with identical command surface and arguments.
- **Seamless Backward Compatibility**: Retained `dsh` command alias to ensure automated scripts, legacy integrations, and CI pipelines continue running without disruption.
- **Project Scripts**: Added `pnpm clh` and `pnpm cinlan-harness` shortcuts to root `package.json`.
- **Python SDK Runtime**: Updated `python/sdk-runtime` console scripts to export `clh` and `cinlan-harness`.

### 2. Complete User Home Directory & Cache Isolation
To prevent configuration cross-talk, state clashes, or cache corruption with upstream `~/.dsh` environments:
- **Default User Home**: Relocated from `~/.dsh` to **`~/.clh`**.
- **Isolated Storage Directories**:
  - Cache: `~/.clh/cache`
  - Profiles: `~/.clh/profiles`
  - Sessions: `~/.clh/sessions`
- **Hierarchical Environment Precedence**:
  1. `CLH_HOME`
  2. `CINLAN_HARNESS_HOME`
  3. `DSH_HOME` (fallback for smooth migration)
  4. Default `~/.clh`
- **Python SDK Alignment**: Subprocess and client environments in `deepseek_harness.client` now automatically resolve and propagate `CLH_HOME` / `CINLAN_HARNESS_HOME`.

### 3. Environment Variables & Runtime Resource Isolation
- **Environment Prefix Upgrade**: Transitioned core variables to `CLH_*` prefix (`CLH_HOME`, `CLH_SESSION_ROOT`, `CLH_CORDIS_CONFIG`, `CLH_PERMISSION_MODE`, `CLH_TELEMETRY_MODE`, etc.) with dual-prefix fallback.
- **Process & Resource Namespaces**:
  - IPC sockets, lockfiles, and process-tree markers now use `clh-` / `clh_` prefixes.
  - Subprocess sandboxes and temporary directories isolate in `clh-*` namespaces.
- **Desktop Protocol Registration**: Registered custom URI protocols `clh://` and `clh://open` for deep linking into the desktop client.

### 4. Official Cinlan Brand Identity & Visual Assets
- **Web Favicon**: Replaced `apps/web/public/favicon.svg` and `website/public/favicon.svg` with the official Cinlan star vector.
- **Desktop & OS Assets**: Generated multi-resolution platform icons for macOS and Windows (`icon.svg`, `icon.png`, `icon.ico`, `tray-windows.ico`).
- **UI Header Component**: Upgraded the client header logo component (`FishLogo.tsx` / `CinlanLogo`) to render high-definition Cinlan official vector artwork.
- **Product Metadata**: Updated application display titles to **Cinlan Harness** / **星澜 Harness**.

### 5. Robust Multi-Face Monorepo Build Pipeline
- **Typert Remote Resolution**: Resolved OxLint / Rolldown resolution discrepancies where generated Remote RPC contracts were mistakenly mapped to `.d.ts` during browser client bundling, redirecting them precisely to runtime JavaScript implementations.
- **Client Bundle Purity**: Added pure fold and metadata utility modules (`dsh-native-command/types`, `dsh-api-workspace-controller/default-workspace`, `dsh-plugin-manager/registry`) to the `INLINE_SAFE` whitelist.
- **Compilation Health**: Achieved 100% green status across `build:lib:host`, `build:lib:client`, `build:web`, and root `build`, with complete type-safety verification under `tsc -b`.

---

## 🚀 Quick Start Guide

### From Source

```sh
# Clone the repository
git clone https://github.com/lianyorker/cinlan-harness.git
cd cinlan-harness

# Install dependencies (requires pnpm 11.7+ and Node.js 22.19+ / 24+)
pnpm install

# Build repository packages
pnpm run build

# Start the Web UI
pnpm clh web
```

### CLI Execution Modes

```sh
# Run the Web client on http://127.0.0.1:3080
pnpm clh web

# Run an autonomous single task in headless mode
pnpm clh headless "Refactor authentication flow and write unit tests"

# Launch terminal TUI interface
pnpm clh tui

# View full launcher help and profile configurations
pnpm clh --help
```

### Desktop Packaging

```sh
# Run desktop client in development mode
pnpm run dev:desktop

# Package standalone Windows client directory
pnpm run package:desktop:dir
```

---

## 🔒 Safety & Compatibility Notice

Cinlan Harness is currently in **developer preview**. While core DeepSeek and OpenAI-compatible API providers remain fully compatible at the protocol level, configuration and internal APIs are subject to rapid evolution.

Please review [SAFETY.md](SAFETY.md) / [SAFETY.zh.md](SAFETY.zh.md) before executing untrusted agent tasks or sandbox commands.

---

## 💬 Community & Feedback

- **GitHub Repository**: [https://github.com/lianyorker/cinlan-harness](https://github.com/lianyorker/cinlan-harness)
- **Issues & Bug Reports**: [https://github.com/lianyorker/cinlan-harness/issues](https://github.com/lianyorker/cinlan-harness/issues)
- **Discussions**: [https://github.com/lianyorker/cinlan-harness/discussions](https://github.com/lianyorker/cinlan-harness/discussions)
