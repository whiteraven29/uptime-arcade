# ADR 0001: A cinematic landscape behind the holographic HUD

**Status:** accepted, 2026-11-07. The frame and panel shape were replaced by ADR 0003, and the landscape by ADR 0008.

## Context

Section 4 described a holographic HUD on a dark grid. The owner supplied a reference image (`resources/`, a third-party game landing page mock-up) as the target look, to be adjusted with a holographic feel: a floating rounded glass window in a night landscape with jagged mountains and lava, metallic wide display type, pill buttons and picture cards.

## Decision

Keep every holographic element from section 4 (corner brackets, the reactor core, cyan lines, amber for what matters) and set them in that kind of scene.

- **Scene:** painted in code from a seeded generator in `frontend/src/ui/scene/paintScene.js`. It ships no image files and copies nothing from the reference: not its name, logo, figure or art.
- **Frame:** the HUD floats in a rounded window over a dimmed, zoomed copy of the scene.
- **Hero:** the player is a hooded operator standing on the lava plain, projecting the core ring into the sky.
- **Holographic touches:** iridescent hairlines, faint scanlines, a chromatic split on metallic titles, a projector beam and a floor plate.
- **Tokens:** `--glass` and `--glass-strong` get darker so text stays at 4.5:1 over lava. `--line-soft`, `--glass-sheen`, `--iris`, `--metal`, `--lava`, `--lava-deep`, `--radius` and `--radius-frame` are new.
- **Shape:** panels get rounded corners with curved brackets, and buttons become pills.

## Consequences

- First paint of the scene takes about 200ms of main-thread time. It repaints only when the frame's size changes.
- Lava brightness breathes through CSS opacity, so idle animation costs almost nothing. It stops under `prefers-reduced-motion`.
- Text-heavy screens dim the scene with a veil, and only the Deck shows it at full strength.
- The look relies on `backdrop-filter` for glass. Without it, panels are still readable because their fill is dark enough alone.
