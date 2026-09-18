# Task modes and evidence

Apply the [decision order](../SKILL.md#decision-order) per region and property. An approved reference is evidence for the view it depicts, not permission to invent backend behavior, content, or unshown states.

| Task | Mode and evidence | Expected decision | Failure to avoid |
|---|---|---|---|
| Add a settings section to a desktop application | Extend product; inspect current shell, controls, theme, and accepted settings view | Reuse its sidebar width, content alignment, row density, text roles, and selectors | Replace the application with a generic card dashboard or add a hero |
| Match an approved settings screenshot inside that application | Reference for the shown view; product implementation for unshown states | Measure the screenshot at its known viewport, map colors to existing roles, preserve host behavior | Let generic blue or radius defaults override a reference's green or compact controls |
| Recreate a supplied landing page | Reference; supplied assets and copy | Match the visible hierarchy and proportions; mark uncertain fonts or unseen mobile behavior | Add mandatory feature cards, testimonials, or invented claims because an example includes them |
| Design an operational dashboard without a host UI | New design; task/data first, dashboard example second | Select metrics and layout for the actual decision; adopt one token set | Treat the example's four metrics or event schema as product requirements |
| Explore a new brand or standalone tool | New design; brief and assets | Compare distinct compositions, choose one, then implement and measure | Reopen exploration after the user has selected a direction |

## Evidence record

Keep a short record in the project's design document: task mode; approved reference and its scope; implementation/token paths; viewport and fixture; measured shell widths, content edges, type roles, row heights, and controls; uncertain properties; required states; accessibility deviations. Label each decision as supplied, measured, inherited, or provisional. Do not describe an estimate as a measurement.

A screenshot with unknown viewport or scale supports relative proportions; it does not establish exact CSS pixel values. Use the supplied dimensions when available and state any uncertainty. Source code and computed styles establish values for the current product; screenshot inspection establishes what actually rendered.

## Portable evidence

This skill includes token defaults, task cases, and a [fixed comparison protocol](verification.md). It does not include approved full-page screenshots, success/failure image pairs, or completed model benchmark results. Do not fabricate these or depend on private workspace artifacts. A project can supply approved assets and their provenance; an accepted result becomes a baseline only when the user or designated reviewer explicitly accepts it.
