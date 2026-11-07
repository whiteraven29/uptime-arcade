# ADR 0002: Build the HUD on a local game layer before the API exists

**Status:** accepted, 2026-11-07. Replaced as M1, M2 and M5 land.

## Context

Section 19 orders the work M0, M1, M2, then M3, with the HUD built on real API data. The owner asked for the new look and the section 12 layout now, while the only working game was the single-file legacy version with no API behind it.

## Decision

Do M0, the look from M3 and the engine port from M4 first, without M1 and M2:

- `frontend/src/api/localGame.js` holds the rules and state, ported from the legacy `ui.js`, and keeps the same save format. Screens call this module only, so moving rules to the server later replaces one module rather than the screens.
- Missions stay as JavaScript in `content/legacy/`, because some have `check()` functions that YAML can't express until the M1 `expect` rules exist.
- Level thresholds stay below section 6.4's, because Archmage at 200 would be unreachable with today's catalogue. Section 6.4's ladder takes over in M7. (ADR 0004 moved the interim ladder to 150.)
- Screens without content yet (`/ops`, `/profile`) show an honest "arrives in milestone" panel.

## Consequences

- Section 14's trust model doesn't hold yet: answers, time and XP all live in the browser. That's acceptable only while this is a single-player local game.
- Focus timing uses the client clock until M2.
- `tools/verify_content.mjs` already provides the M4 guarantee that every mission's solution passes, so the M1 conversion has a safety net.
