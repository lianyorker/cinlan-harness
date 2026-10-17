---
description: "Cinlan Design Studio: Collaborative AI design workspace with TasteSkill anti-slop engine, 20 direction presets, and responsive sandbox."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cinlan-design

English | [中文](README.zh.md)

## Summary

Cinlan Design Studio provides a responsive preview sandbox (1440px desktop, 768px tablet, 390px mobile), an automated Anti-Slop design linter distilled from TasteSkill v2, 20 curated master design direction presets, and visual pin annotation to feed structured UI feedback directly into the Agent loop.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open **Cinlan Design** from the right-Sidebar guide or press `Ctrl+Alt+D` (`Cmd+Alt+D` on macOS). Enter an HTTP/HTTPS address or local dev URL (e.g. `http://localhost:3000`).

### When to choose it

Choose Cinlan Design for collaborative AI design, responsive inspection, verifying layouts against Anti-Slop guidelines, or applying curated design directions.

### Minimal configuration

The package registers automatically when included in the profile's cordis patch:

```yaml
- id: ui-cinlan-design
  name: '@deepseek-ai/dsh-client-ui-cinlan-design'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Anti-Slop Linter

The embedded TasteSkill engine inspects HTML and CSS for 22 banned generative tells (monospaced body fonts, purple/indigo gradients, gradient text, arbitrary box shadows, 01/02 numbering, kicker labels, and default web font fallbacks), producing an Anti-Slop Health Score from 0 to 100.

### Visual Pin Annotations

Users click elements on the sandbox canvas to drop numbered pins with structured categories (Typography, Space, Palette, Component, Copy). Submitting a pin injects structured markdown feedback into the session draft.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Use the **20 Master Directions** drawer to guide the Agent toward Swiss International grids, Warm Editorial aesthetics, or High-Contrast Monochrome layouts.

-----

<a id="model-experience"></a>
## Model Experience

The structured pin feedback and audit reports supply concrete line and selector targets, reducing vague revisions and alignment loops.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

CDP remote computed-style probing requires an active Electron desktop bridge; web profiles use client-side source linting.

-----

<a id="dev-note"></a>
## Dev Note

Complies with strict typed i18n copy dictionaries and `--dsw-*` design tokens.
