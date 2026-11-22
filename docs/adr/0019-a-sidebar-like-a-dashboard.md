# ADR 0019: A sidebar like a dashboard

**Status:** accepted, 2026-11-22. Changes sections 4.5 and 5.

## Context

The screens were a row of links in the top bar, beside the logo and the player's numbers. The owner asked for them in a sidebar on the left, like a dashboard, that can be collapsed.

## Decision

- **A sidebar lists the screens:** Deck, Focus, Missions, Rewards, Profile and System, each with an icon drawn in code and its name. Profile joins the list, so it's no longer reached only through your picture.
- **A header stays across the top** with the screen's name, level, XP, streak, the play-time or session clock with its Stop button, and your picture.
- **One button collapses the sidebar** to a rail of icons, each named for screen readers and on hover, and expands it again. The choice is kept in this browser's local storage, as a convenience that can be lost without harm. Until you choose, the sidebar is full from 1280px and icons below, so the Deck keeps room for its core.
- **On a phone it becomes a bar along the bottom,** within reach of a thumb, with the logo moving to the header. The collapse button isn't shown there.
- **The scene still runs to every edge.** The sidebar is a translucent panel with the same fading hairline as the header, and every colour comes from tokens.

## Why not the alternatives

- **A menu button that opens a drawer on phones:** it hides the screens behind a tap. Six short names fit along the bottom of a 320px phone.
- **Remembering the choice on the server:** it's a matter of screen size, which differs from device to device.

## Consequences

- The class `.side` was already the mission panel on the play screen, so the sidebar is `.sidebar`.
- Screens are a little narrower on wide windows. Every screen still fits at 1400px and 400px, and the Deck at every size `tools/screenshots.mjs` checks.
