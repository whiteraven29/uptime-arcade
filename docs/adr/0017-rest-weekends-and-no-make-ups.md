# ADR 0017: Study times on your own terms, with play in the breaks

**Status:** accepted, 2026-11-22. Changes sections 5, 6.1, 15 and 16, and replaces the make-ups, the fixed block lengths and the fixed earning table from [ADR 0010](0010-study-plans.md).

## Context

The owner studies in set periods, for example 04:00 to 06:00 and 21:00 to 23:00. Each period has about 30 minutes of rest, split into two breaks, and those breaks should be played in the arcade instead of on a phone. Several things in ADR 0010 got in the way:

- **A plan was blocks a day of one fixed length** (15, 25 or 45), spread across study times. The periods themselves, and the breaks inside them, couldn't be described.
- **Make-ups** let two blocks a week earn outside your study times, so the times you set weren't really the times that counted.
- **Earnings were a fixed table** (15 → 5:00, 25 → 8:00, 45 → 15:00, plus 2:00 for finishing the goal), which didn't match the breaks someone actually takes.

They also wanted weekends on different times from the five working days, and the System screen to show an account card and a password change, without printing the email.

## Decision

- **Each study time is set on the player's terms:** a start, an end, how many rest breaks (1 to 4) and how long each break is (5 to 30 minutes). Study and rest take turns, and the study between breaks is what the breaks leave. 04:00 to 06:00 with two 15:00 breaks is 45 study, 15 play, 45 study, 15 play. That stretch must come to 10 to 90 minutes, and a break can be at most half the study before it.
- **Each study time earns its own study minutes.** A missed morning can't be studied in the evening, and a day is at most 8 hours of study times, because "any time at all" isn't a plan.
- **Nothing earns outside your study times.** Make-ups are gone. A block outside your times, or past what its study time holds, is an extra: it goes on the map and earns nothing. Older make-up blocks keep their kind in history.
- **A kept block earns the break after it.** A block can be any length from 10 to 90 minutes. It starts at its study time's own length, and another length earns in step, rounded down to the second. Finishing the goal still adds 10 XP, but no time.
- **What a block earns is fixed when it starts** (`earn_seconds`), so a plan that changes before the claim can't change it.
- **The server says how many minutes can still earn right now (`room_minutes`), and at what rate.** The screen previews any length from that with the same sum. The server decides again when the block starts.
- **The weekend can have its own study times.** Saturday and Sunday either follow the weekday ones or have their own. They're stored on the same plan row, so all of ADR 0010's rules still apply: one change a week, starting tomorrow, in the plan's own time zone.
- **Today shows its turns of study and play,** worked out on the server.
- **System shows an account card** (picture, username, level, XP, join date, View profile) and a change-password form. The account API no longer returns the email at all, because nothing on screen needs it.
- **Changing a password while logged in** needs the current password, counts wrong tries per account as account delete does, logs out every other device, and gives this device fresh tokens.

## Why not the alternatives

- **Blocks a day of one length:** the plan said how much, but not when or how the time is split, which is what the owner actually decides.
- **Keeping two make-ups a week:** it would bring back earning at any hour, which is the habit the owner wants to break.
- **One daily allowance across all study times:** a missed morning could be made up at night, which also brings back earning at any hour.
- **Breaks as long as the study:** 15 minutes of play after 15 of study would turn the arcade into the main event. Half keeps study first, and the numbers live in `rules.py`.
- **Seven separate day schedules:** more flexible, but a long form for a need that is really weekdays and weekends.
- **Showing the email behind a button:** nothing on screen uses it, so not sending it at all is safer than hiding it.

## Consequences

- Existing plans are converted to keep their daily study: each old window holds as many of the old blocks as fit, each followed by a break near what it used to earn (15 → 5, 25 → 10, 45 → 15). A window with nothing left to hold is dropped. Blocks already running when this ships keep the old table's amount.
- A missed study time can't be made up. The weekly and monthly goals still have their 80% and 75% room for that.
- The bank still holds 30:00 at most, so breaks only add up if they're played. Two study times of 30:00 of play each are fine when each break is played as it comes.
