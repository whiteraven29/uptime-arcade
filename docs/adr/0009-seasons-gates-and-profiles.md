# ADR 0009: Seasons are content, tracks can be gated, and players have faces

**Status:** accepted, 2026-11-07. Changes sections 5, 6.5, 6.6, 6.9 and 16.

## Context

The owner asked for the next rewind question to arrive without a click, for a username and picture on screen, and for the Missions screen to stop being a stack. They also asked for NetLab to stay shut until a player reaches a point in Networking, and said a player can't reset a season: old seasons can be revisited while new ones add new content.

## Decision

- **Seasons are content we publish.** A track has a `season` in `content/tracks.yaml`, and the current season is the highest published. `seasons/new/` and the button are gone, because nothing a player has done is ever reset. Older seasons stay open.
- **Revisiting:** any cleared mission can be played again. It's checked as usual but changes nothing: no XP, no tries, no state. Hints are free. It still uses play time, because that's what play time is for. A goal you've already met would pass at once, so terminal and vi revisits run on a clean machine, and yours comes back when you leave.
- **Track gates:** a track can name a mission in `requires`. NetLab requires NET-11, the local-or-gateway decision, because the lab assumes it. The track exists now with no missions and is shown as on its way, so its lock holds from the first day missions arrive. The importer refuses a requirement that doesn't exist.
- **Rewind:** the next question comes as soon as the server answers, with how the last one went above it, and finishing moves on by itself. Answers are ignored for 350ms after a new question appears, so a double click can't answer one you haven't read.
- **Missions screen:** a card per category, showing progress, difficulty mix, and its chapters cycling one at a time. Opening a card reveals chapter dropdowns, with the chapter you're up to already open. Only one card is open at a time. The cycling stops on hover or focus, and under reduced motion the chapters are simply listed.
- **Profile:** your username and picture sit at the top right and lead to `/profile`. Everyone starts with one of sixteen operators drawn in code, chosen from their username, and can pick another.

## Uploaded pictures

An upload is the one place users send files, so it's treated as hostile.

| Risk | Decision |
|---|---|
| Scripts disguised as images, including SVG | Only PNG, JPEG, WebP and GIF are opened, judged by their contents and not their name. Everything is decoded and redrawn as a new 256px WebP, so nothing from the original file survives |
| Location and camera details | Dropped by the same redraw |
| A small file that expands to gigabytes | Pixel count is checked from the header before decoding |
| Large files | 3 MB limit, and 10 uploads a minute |
| Serving | From the database, at an unguessable address that changes with each upload, with `nosniff` and a sandboxed content policy. Deleting an account deletes the picture |

The address is public because an image tag can't send a login. Anyone who has someone's link can see their picture, but there's no way to list them.

## Consequences

- `Player.season` stays on the model, fixed at 1. New seasons add missions rather than resetting anything, so progress keeps working as it is.
- Pictures live in the database, which suits one server. If they grow, moving them to object storage changes only this one view.
