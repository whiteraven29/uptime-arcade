# ADR 0008: A data centre, a wired-up Deck and a terminal built for reading

**Status:** accepted, 2026-11-07. Replaces the landscape in ADR 0001, and refines ADR 0003.

## Context

The owner supplied new references in `resources/` (kept out of git): a neon lab with a frosted login card, cut-corner login and register cards over red and cyan light, and a game dashboard with a central ring, labelled tiles wired to it, a list of icon rows and a bottom strip. They asked for the background to suit programming and networking, for the colours to shift a little, and for a sci-fi terminal whose text stays visible and doesn't tire the eyes.

These are references for the look only. Nothing is copied from them: no art, names or characters, and the scene is still painted in code.

## Decision

- **Scene:** a server aisle in one-point perspective. Racks with status lights line both walls, hologram panels show real network maps, code, terminal output and routing tables, a network map fills the far wall, and a glossy floor reflects it with red and cyan light across it.
- **Colours:** near black with violet in it. Cyan stays first, with violet and magenta behind it. Gold is for frames and for what matters, and red for alerts. Lava is gone.
- **Deck:** a central ring with the clock inside it, tiles wired to it on the left, a list of skill paths with their medals on the right, and a bottom strip with the next mission, level progress and medals.
- **Shape:** buttons and tiles have cut corners. Tiles are solid, because the room behind them is now busy. ADR 0003 still holds for reading screens: the scene runs to every edge, and they have no boxes.
- **Login and register:** a violet glass card with cut corners and side tabs, dark rounded fields and a white button, beside the operator in the aisle. There are no social login buttons, because no such login exists.
- **Terminal:**
  - Each command is its own block, showing where you were, what you ran, what came back and how it ended.
  - Errors, warnings, hints and results each have their own shape and wording, so colour is never the only signal. A failed command says how to find out more.
  - `grep` finding nothing is shown as a result, not a failure.
  - While typing, a grey suggestion shows what Tab would add, and a line says what the command does, or that the box has no such command.
  - The status bar shows the session and commands against par.

## Readability rules for the terminal

The background may look futuristic, but it stays still and well below the text.

- Text is soft off-white on near black, not pure white on pure black.
- Every text colour reaches at least 7:1, and is salmon rather than saturated red for errors.
- No glow, blur or animation on text, no flicker, and the scanlines stop at the terminal's edge.
- Text is at least 14px.

`frontend/src/styles/readability.test.js` measures these from the real tokens and fails the build if they slip.

## Consequences

- The scene is busier than the landscape, so reading screens rely on the veil, and the terminal has a nearly solid background.
- Only the Deck, login, register and the workspaces were reshaped. Other screens picked up the colours, buttons and room, and keep their layouts.
- The mockups show social login and a large cast of characters. Neither is planned.
