# Inert Loader Contract Reconstruction

## Scenario

Use this method when a short-lived web loader and its payload files are no longer reachable, but a prior evidence-backed report preserves hashes, logical module IDs, filename derivation, version gates, request shapes, and state transitions. filename derivation, version gates, request shapes, and state transitions. filename derivation, version gates, request shapes, and state transitions. filename derivation, version gates, request shapes, and state transitions.

## Reconstruction boundary

- Treat the report as contract evidence, not as recovered source code.
- Reproduce status branches, URL derivation, selection precedence, request ordering, retry limits, payload length, and interface fields that have direct evidence.
- Represent unknown endpoint/body values as `null`; do not invent protocol details.
- Replace remote modules with marked inert stubs and payload bytes with a marked inert placeholder of the documented size.
- Never use `eval`, `new Function`, native payload execution, installation, or callback traffic in the reconstruction.

## Verification pattern

1. Assert every documented logical ID derives to the documented filename.
2. Test every version boundary and failure status independently.
3. Serve the rebuild on loopback only and preserve fake-error versus loader branches.
4. Run a real browser capture and verify the HAR request sequence.
5. Persist final state as non-visible JSON so branch, byte count, and `executed=false` assertions are inspectable without runtime hooks.
6. If an iframe is only part of the observation harness, label it as a harness and keep it separate from target-origin behavior.

## Completion criteria

A reconstruction is complete only for the proven contract surface. Missing original module bodies, payload bytes, native runtime state, and runtime-produced C2 fields stay explicitly unverified even when the local HTTP and state-machine behavior passes E2E. explicitly unverified even when the local HTTP and state-machine behavior passes E2E. explicitly unverified even when the local HTTP and state-machine behavior passes E2E. explicitly unverified even when the local HTTP and state-machine behavior passes E2E.
