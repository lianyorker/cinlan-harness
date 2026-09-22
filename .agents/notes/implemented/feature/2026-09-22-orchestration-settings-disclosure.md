# Agent Note: Compact orchestration settings disclosure

Status: implemented

English | [中文](2026-09-22-orchestration-settings-disclosure.zh.md)

## Problem

The orchestration page presents host execution settings and evaluated preset diagnostics in one settings section. Showing every preset row and engine explanation in the initial view makes the page harder to scan, while hiding those diagnostics would remove the evidence needed to explain unavailable workflow capabilities.

## Decision

The page uses one primary capability card with a short status summary, the editable parallel tool-call limit, and a recheck action. Engine details and per-preset workflow, delegation, and engine rows stay in a collapsed disclosure. Settings search expands that disclosure before it focuses the workflow-limit or coverage anchor. Short Workflow, Parallel, and Pipeline examples remain below the card to match the orchestration usage flow without adding another setup surface.

The Host settings mirror and inventory projection remain the owners of persistence and capability semantics. The page preserves draft input after rejected writes, read-only and unavailable states, inventory errors, and the distinction between configured plugin rows and active lifecycle instances. It does not copy Orca's skill installation flow because this package manages Host settings and reports composition-owned capabilities.

## Alternatives considered

- **Render every diagnostic row in the first view.** This keeps all evidence visible but makes the setting page dense and duplicates the detail hierarchy users reach through search.
- **Remove capability diagnostics and show only parallelism.** This simplifies the page but loses the evaluated inventory needed to explain preset availability and workflow ownership.
- **Add an installation wizard copied from Orca.** The Host package has no installation authority or terminal lifecycle; adding that flow would misrepresent the ownership of preset composition and setup.

## Consequences

The common path is shorter and the details remain available through explicit expansion or search. Automated tests must cover both collapsed default rendering and search-triggered expansion. The snapshot for the parallelism row changes with the shortened help copy; workflow and coverage rows remain available only after expansion.

## Verification

`packages/client/ui-orchestration/tests/section.client.spec.tsx` and `packages/client/ui-orchestration/tests/apply.client.spec.ts` cover the compact card, examples, persistence, error recovery, and search expansion. The package TypeScript build passes with `pnpm exec tsc -b packages/client/ui-orchestration/tsconfig.json --pretty false`.
