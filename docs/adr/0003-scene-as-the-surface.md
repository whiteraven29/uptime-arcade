# ADR 0003: The scene is the surface, with no floating frame or boxed panels

**Status:** accepted, 2026-11-07. Replaces the "Frame" and "Shape" decisions in ADR 0001.

## Context

ADR 0001 floated the HUD in a rounded window over a dimmed, zoomed copy of the scene, with separate glass panels and corner brackets inside it. The owner reviewed it and said the box margins looked like they were hanging, and asked for something more integrated while keeping the background. There were two causes: a dead band of blurred scene around the window, and boxes hovering over the scene with nothing tying them to it.

## Decision

- **Full bleed:** the scene fills the whole window. The outer canvas and the frame's margin, radius and edge are gone.
- **No boxes:** `HudPanel` is now a section with no fill, border or brackets. Sections are separated by hairlines that fade at their ends.
- **Reading screens:** a single veil over the scene carries the text contrast, instead of one fill per panel.
- **Deck:** the two sides rise out of the bottom corners on a rail that dissolves upward and toward the centre. The picture cards are removed, because a small picture of the scene sitting on the scene added another box.
- **Play:** the mission and the workspace are two panes running edge to edge.
- **Overlays stay as boxes**, because they interrupt on purpose.

## Consequences

- Less `backdrop-filter`: only the Deck rails use it, so the screens that scroll are cheaper to paint.
- Under 1040px the Missions screen now picks one track at a time, because 30 missions in each of five stacked lists was too long.
- `--veil`, `--veil-top`, `--rail` and `--pane` are new tokens. `--glass-sheen`, the corner brackets and `SceneThumb` are no longer used.
