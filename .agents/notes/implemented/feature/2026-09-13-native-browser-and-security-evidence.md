# Agent Note: Native browser preferences and durable security evidence

Status: implemented

English | [中文](2026-09-13-native-browser-and-security-evidence.zh.md)

## Problem

An external application CLI adapter does not implement a native Harness capability. Loader activation also does not prove that a browser can start or that an assessment effect is authorized. Process-local Artifact storage cannot preserve evidence referenced by durable Findings after the Host exits.

## Decision

The opt-in cinlan-browser bundle selects the existing Harness-owned Playwright Provider. Its Settings namespace layers browser channel, headless mode, and viewport preferences over deployment defaults. Writes use the existing Settings service and revision fence. Preferences apply on Provider remount, keeping live pages and their observations stable until then. Paths, provider identity, and permission policy remain outside the preference form.

Security Research uses the existing local Artifact Provider. References remain opaque, scoped, and integrity-checked; bytes and metadata persist independently of Provider instances. Empty JSON and Markdown reports use the Unix epoch rather than the wall clock, so repeated export of identical data produces identical bytes.

The NodeNext consumer check uses directory junctions on Windows and directory symlinks elsewhere. Setup errors retain their original diagnostic and are distinguished from compiler failures. This preserves the declaration corpus instead of skipping packages when the host lacks symlink privileges.

The four small security bundles publish real insert patches and source-built empty namespace entries. The Findings fragment mounts its Session Provider rather than also mounting an abstract Service Definition under the same service key. The build includes these carriers; no hand-written lib stub is required.

## Alternatives considered

Continuing to call Orca would retain a separate application's installation and runtime as a product prerequisite. Renaming buttons would not remove that dependency. Copying the Orca settings store would duplicate the existing Harness Settings and Cordis plugin lifetimes.

Restarting a live browser after every field edit would invalidate active pages and observations. An explicit restart requirement separates successful persistence from activation.

Keeping reports in memory would preserve references without their evidence bytes after restart. Local storage is reused instead of adding another report database.

## Consequences

Browser operations are opt-in and ask for approval by default. Saving preferences neither starts a browser nor grants permissions. The Settings form reports missing, read-only, rejected, and saved states separately. The current namespace supports one configured Playwright Provider per Host.

Computer Use and Mobile Device still use legacy CLI adapters. Security scope configuration is not yet enforced by all shell and network Consumers; the bundle is not an assessment confinement mechanism. Cookie import, native desktop/mobile Providers, and the remaining staged capability families are not delivered by this decision. Local Artifact retention labels do not implement expiry cleanup or encryption, and bytes lost from a former in-memory Provider cannot be reconstructed.

## Verification

The real Web Loader scenario saves preferences through Remote, restarts the Host, opens a local Chromium page through browser tools, clicks an observed element, and checks PNG dimensions against the saved viewport. The security scenario verifies every Finding state, rejected evidence-free promotions, three report formats, Provider reconstruction, and cross-scope read denial. These tests do not call a model or operate the system desktop or a mobile device.

Focused NodeNext fixtures verify real link creation, staging cleanup, compiler rejection, and setup diagnostics. The built declaration consumer check covers the complete configured workspace corpus.

## Related decisions

The [migration composition note](2026-09-10-worktree-sidebar-security-integration.md) remains active for Worktree, Sidebar, and optional preset ownership. This decision replaces its process-local evidence choice. The [device readiness note](2026-09-12-device-profile-and-provider-readiness.md) remains active for the current device interfaces, not as evidence of native desktop or mobile execution.
