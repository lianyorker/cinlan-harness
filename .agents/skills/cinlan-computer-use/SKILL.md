---
name: cinlan-computer-use
description: Use when operating a desktop or browser GUI through screenshots and input actions — clicking, typing, scrolling, dragging, navigating — where the agent must perceive, decide, act, and verify each step. Triggers include computer use, GUI automation, screenshot-driven operation, element location, UI control, desktop automation, browser control, and any task that drives a real interface rather than an API.
metadata:
  distilled_from: gpt-6-astra (api.cinlan.online)
  method: model-behavioral-distillation
---

# Cinlan Computer Use

Operate a real GUI reliably: perceive the screen, decide the smallest correct action, act once, and verify the result independently. Distilled from `gpt-6-astra`. The core discipline is **never infer success from having acted** — every mutation is confirmed by a fresh observation against a postcondition.

## The loop

1. **Perceive** — capture a fresh observation (screenshot and/or accessibility tree). Record app, window, URL/document, modal stack, focused control, viewport, scale, scroll position, timestamp.
2. **Decide** — identify the target by at least two independent cues; pick the smallest operation that advances the task.
3. **Act once** — record intent as pending, perform the operation, record delivery status. Never infer application success from delivery.
4. **Verify independently** — take a fresh observation and test the postcondition. Absence of an error is not success.
5. **Update or recover** — on confirm, checkpoint and continue; on failure, apply recovery policy; on uncertainty, investigate read-only before mutating again.

## Element location (in preference order)

- **Accessibility tree** — standard native/web controls; match `role + accessible name + parent`; reacquire after rerender.
- **Selectors** — permitted web automation with stable DOM identity; require exactly one visible enabled match; avoid generated classes and positional selectors.
- **Visual grounding** — canvas/remote/custom/poorly-labeled elements; anchor context, then ≥2 independent cues (label+icon, label+position).
- **OCR** — propose text locations when semantics unavailable; inspect the crop before clicking; OCR alone never establishes clickability.
- **Coordinates** — final actuator, not durable identity. `input_x = origin_x + image_x / scale_x`; refresh screenshots older than **2s** and after any geometry change.

## Action primitives (key rules)

- **Click**: move to verified hit point, wait `100ms`, click once; verify focus/selection/navigation; never re-click for slow feedback.
- **Type**: verify editable control + focus first; read existing content before replacing; `20ms/key` when key events required; verify final value + validation.
- **Scroll**: pointer over the container, `~60%` of visible height per increment; after **3 increments without the target**, reassess or search; 2 unchanged increments = boundary or wrong container.
- **Drag**: hold `100ms`, ≥8 intermediate positions over `400ms`, pause `100ms` at destination, release; verify resulting order/position, not pointer movement.
- **Hotkey**: confirm OS/app/focus/modal first; release all modifiers even on failure; never use Enter/Escape/Space as generic confirm without identifying their current effect.
- **Async**: a started upload ≠ completed upload; at deadline classify failed-or-uncertain rather than re-clicking.

## Error recovery

- **Classify first**: wrong context / missing target / ambiguous target / obstruction / lost focus / stale geometry / loading delay / validation error / permission denial / transport failure / uncertain commit — each gets a different remedy.
- **Stuck detection**: no progress after **2 state-changing operations leave the same relevant state**, or an `A→B→A→B` cycle without advancing a completion criterion.
- **Retry budget**: **3 total attempts** per operation; `500ms` before attempt 2, `1500ms` before attempt 3; each retry needs a fresh observation + targeted repair.
- **Recovery cycle**: diagnosis → one repair → reobservation. Stop auto-recovery after **2 cycles without a new verified checkpoint**.
- **Protect uncertain commits**: never auto-repeat payment/send/submit/create/delete after a timeout — inspect authoritative history first; retry only with evidence the earlier op didn't commit or a verified idempotency mechanism.
- **Escalate with evidence**: intended op, last confirmed state, observed error, attempts+repairs, side effects, the precise decision needed. Label uncertainty explicitly.

## Reference

- `references/action-primitives.md` — full per-primitive timing/verification rules and state-tracking record schema
