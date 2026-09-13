# Skill Bootstrap Supply-Chain Provenance

When bootstrapping a bundled reverse-engineering skill, installation must be explicit and reproducible. Treat GitHub `latest`, floating `pip`/`npm`, unpinned `git clone`, and mutable Go module versions as unverified inputs. Require a commit, version, or SHA-256 pin for automatic installation; otherwise stop with an operator-facing manual-install instruction. Permit an explicit override only when the operator accepts unverified downloads. Always remove temporary files on download failure and verify a downloaded archive before extraction.

This boundary applies to installers and manifests as well as generated skill guides. A capability marked `canAutoInstall: false` must never be pulled merely because a skill was selected.
