# ADR 0018: Streaks that settle when you return, a check-in you can hear, logins that end with the tab, and rewind misses that cost

**Status:** accepted, 2026-11-22. Changes sections 6.1, 6.6, 6.7, 6.8 and 16.

## Context

The owner raised four things after using the game:

- **The check-in:** deep in a problem, they missed the "Still there?" check-in. Three minutes and one chime weren't enough, and the block earned nothing.
- **Streaks:** a streak broken by a missed study day without a shield should show 0 as soon as they come back, not only once their next block is claimed. The milestones should be 3, 7, 30, 90, 180 and 365 days, with a badge for 1000.
- **Logins:** a login should end when its tab is closed or on logout. It lasted 14 days.
- **Rewind misses:** a question missed three times showed its answer for free.

## Decision

- **The check-in gives 10 minutes to answer,** or half the block for one under 20 minutes, so the window always fits after the earliest moment the check can come. The chime repeats every minute until it's answered, the tab title asks, and a desktop notification asks when the tab isn't in view. Permission for that is asked when a block starts, since that's a click. A check that isn't answered in time still voids the block.
- **A streak is settled the first time you come back after a missed study day,** and on anything that pays against it, since the streak sets the XP multiplier. Enough shields freeze it over the missed days, and the game says so. Otherwise the streak is 0 at once, and the next kept block starts it at 1. Shields are kept either way. Today never counts as missed until it's over, and planned days off never count.
- **Milestones are 3, 7, 30, 90, 180 and 365 days,** each paying once. The 365-day milestone gives two shields. A 1000-day streak earns the Thousand Days badge. Rewards already paid for the old 14, 21, 60 and 100-day milestones stay paid.
- **A login belongs to its tab.** The refresh cookie has no date, and each refresh token lasts 30 minutes from its last renewal. The open tab renews it every 10 minutes, so a long study block never logs you out. The tab marks itself in its own `sessionStorage`, which survives a reload but not a close. A tab without the mark asks the other open tabs (over a `BroadcastChannel`) whether any is logged in. If one is, it shares the login. If none is, it ends the login the cookie still held and shows the login page. Logging out in one tab logs out the others.
- **A rewind question's third miss costs 30 XP** off what the mission pays on clear, once per question, never below the 10 XP floor. That's the miss that shows its answer, and the screen says what it cost.

## Why not the alternatives

- **Counting a late check-in anyway:** it would bring back idling, which the check exists to stop. A longer window, a repeated chime and a notification reach a busy person without paying someone who isn't there.
- **Resetting the streak only at the next claim:** the screen would show a streak that's already gone, and pay a multiplier on it.
- **Strict 30 minutes without renewal:** a 45-minute block after its check-in would log someone out before they could claim it.
- **Logging out on `pagehide`:** that also fires on a reload, so every refresh would log you out.
- **Charging for every miss:** a hard question already comes back with a hint. The cost is for the answer being given away, which happens once.

## Consequences

- A tab restored with "reopen closed tab" can bring its mark back with it. The 30-minute lifetime still ends that login once nothing has renewed it.
- Two tabs renewing at the same moment can still race, as before. Each renewal rotates the token, so the loser is asked to log in again. It's rare, since each tab renews only every 10 minutes.
- Tools that log in through the API and then open pages, like `tools/screenshots.mjs`, mark the tab themselves.
