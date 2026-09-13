# Capability Settings design reference

English | [中文](DESIGN.zh.md)

## Scope

This reference covers the Cinlan Settings contribution, not the Settings shell or its plugin registry. The user's reference images define a quiet, neutral setup page: capability identity and real state first, supported next steps second, component diagnostics last.

## Layout

- The content column is at most 840px wide; all capability headings share its left edge.
- Headers use 22px/30px type and a hairline bottom rule; body copy uses 14px/22px.
- Hero cards use 20px padding, 10px corners, a 44px icon, and a text-labelled status.
- Computer Use, Security Research, and Design use a two-column guidance grid with a 12px gap. Below 640px it becomes one column.
- Browser uses three ordered setup rows. Mobile Emulator separates availability, SDK/default-device explanations, and Agent control setup.
- Copy and recheck targets are at least 40px. Focus outlines are 2px with a 2px offset.

## Theme and status

All colors use the existing semantic theme aliases in [the stylesheet](src/client/CapabilitySection.module.css). Status labels use readable neutral text; colored dots are supplementary. Missing configuration is neutral, while actual failures have both error text and a status label. No component declares a static palette or a separate light/dark theme.

Loader activation, Provider reachability, installation, and authorization are distinct facts. Unsupported SDK and installer operations appear as explanations. Browser cookie/file controls require explicit input and display only Host-confirmed receipts. Raw Loader details stay collapsed by default.

## Sidebar relationship

The independently installed workbench stays collapsed by default. With visible Session-header utilities, its collapsed controls align to the title row; opening the right panel moves the controls into its tab strip. Reduced motion removes the transition. The real-browser scenario checks 1680px, 1000px, and 600px widths and includes an uncompensated negative control.

Browser launch preferences use native labelled controls inside the first setup row. Saving reports persistence separately from activation and preserves failed drafts; preference controls do not launch a browser. Explicit navigation and file controls sit below the preference form, use native labelled inputs, and keep status separate from deployment configuration.

Security scope and report controls use native labels, 40px controls, the same semantic borders, and explicit saved/error states. Failed edits remain visible; loading Settings does not trigger report generation. Egress and credential references use separately labelled row groups, stacked fields, and explicit add/remove buttons. New rows leave protocol, purpose, and target unset; credential guidance distinguishes reference names from secret values.

## Verification

The [Web scenario](../../../apps/web/tests/device-capabilities.e2e.ts) owns ARIA expectations, narrow-column overflow checks, and sidebar geometry. [Security Research coverage](../../../apps/web/tests/security-capabilities.e2e.ts) loads the actual optional bundle and withdraws its preset contribution. Native Orca inputs and third-party installers are outside this visual verification.
