# ADR 0007: The game runs on the server, and usernames replace email login

**Status:** accepted, 2026-11-07. Finishes what ADR 0002 and ADR 0005 left open.

## Context

After M1 and M2, the API enforced the rules, but the screens still ran their own copy in the browser, with every answer inside them. The owner also pointed out that registering shouldn't reveal whether someone's email is in use. A taken username is fine to reveal, and it should show available or taken as you type.

## Decision

- **The browser holds no rules and no answers.** `frontend/src/api/localGame.js` became `game.js`, which calls the API and shows what comes back. The browser no longer imports the catalogue, and `tools/check_bundle.mjs` fails the build if a solution, hint or question appears in the production bundle.
- **What stays on the device:** the virtual machine, meaning terminal history, files and code in progress. It's a practice machine, so losing it costs nothing, and nothing the server trusts is read from it without being checked against the goal rules.
- **Login is by username.** Usernames are 3 to 20 letters, numbers, `_` or `-`, ignoring capitals, with a few reserved. `GET auth/username/?name=` answers available or not, and is rate limited so it can't be used to list players.
- **Email is private and no longer unique.** Two accounts can share one, which is the only way to never reveal whether an address is in use without email verification. It isn't a login. Password reset will need to handle accounts that share an address.
- **Goals are checked by the server after each command.** The browser can't see them, so `POST missions/{code}/check/` receives the machine's state. It has its own rate limit, and a check that fails isn't recorded as a wrong try.
- **Countdowns use the server's clock.** `GET player/` includes `server_time`, and the client works out the difference, so a wrong device clock shows the right time and can't earn anything.
- **Rewind hints count the questions not yet answered.** The owner confirmed this, and that the answer shows after three misses.
- **Beyond has 50 missions:** ten per tier, one more set per skill. Existing missions kept their ids and moved within their tiers.

## What was removed for now

- **On-call:** it generated incidents and their answers in the browser. It shows an "arrives in M11" panel until the server generates them, so the Night Shift badge can't be earned yet.
- **Backing up and loading a save file:** progress lives on the server. Saves from the old browser game aren't imported, and they stay in that browser's storage. Section 16's `import/` is planned for M10.

## Consequences

- The game needs the server, so it no longer works offline. Section 17's offline shell (M11) is still planned.
- `fs`, `vi` and `py` results are still reported by the browser until M9. Someone who writes their own client can fake those, but not time, the bank, unlocks, or answers to `answer` and Go missions. XP for faked missions is the remaining gap, and must be closed before any leaderboard.
- `tools/verify_content.mjs` saves the state each goal mission really ends in, and a backend test feeds those to the grader, because a disagreement between engine and server now leaves a player stuck.
- `tools/e2e.mjs` runs a real browser against a real server in CI.
