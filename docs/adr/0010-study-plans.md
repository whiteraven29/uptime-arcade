# ADR 0010: Play time comes from keeping a study plan

**Status:** accepted, 2026-11-07. Changes sections 4.2, 5, 6.1, 6.7, 15, 16 and 19.

## Context

Until now, anyone could start a timer at any hour, walk away, come back and claim play time. The owner asked for a way to control this that goes beyond a timer, suggesting a daily study time, how many times a day, and weekly and monthly goals. They also asked for history charts and a green map of focus days.

Nothing in a browser can prove someone studied, and a determined person can script any check. So the aim is narrower: make idling pointless and make honest study easy, with every rule enforced on the server.

## Decision

- **A plan comes first.** Before their first block, a player sets their days, blocks a day, block length and study times. Its daily amount is blocks times length.
- **Earning follows the plan.** Each block is classed when it starts as plan, make-up or extra. Plan and make-up blocks pay, and extra blocks only go on the map.
- **One ceiling covers every route.** Minutes paid in a week can never pass the minutes planned up to that day. Make-ups, plan changes and missed days all sit under it.
- **A plan can't chase you.** The first starts today and can be corrected until a block has started. After that it can change once every 7 days, and a change starts tomorrow. Each plan row keeps its own time zone, so moving your clock opens no window and no new day until tomorrow.
- **Life happens.** Two make-up blocks a week can earn outside your study times, but only to cover planned minutes you haven't earned yet, and a missed week doesn't carry over.
- **One check-in per block.** It comes at a random moment that stays on the server until it's due, with three minutes to answer. Missing it voids the block. It can't be answered early.
- **Claiming asks for something.** A line on what you actually did, within 15 minutes of the end. The note is kept and shown back on Profile, so it's a record and not just a gate.
- **Goals come from the plan,** at 80% of planned minutes for a week and 75% for a month, so there's room for a bad day. Rewards scale with the target up to a cap, so a tiny plan can't collect a big reward.
- **Streaks follow the plan.** A planned day off no longer breaks a streak or uses a shield. Only blocks that earned extend one.
- **Profile draws the history.** A map of the last 53 weeks in fixed green steps, focus minutes a day for 30 days, XP a week for 12 weeks, and recent blocks. Each has a table or list for its numbers, and the dates are the player's own.

## Why not the alternatives

- **Refusing blocks outside the plan:** real work done at an unplanned hour is still worth seeing. It goes on the map and just doesn't pay.
- **Half pay for a missed check-in:** idling would still earn something, which is what this exists to stop.
- **Goals the player picks freely:** the plan already says what they intend, and a separate number would be one more thing to game.

## Consequences

- A check-in needs the tab open, so someone who closes it to work elsewhere loses that block. The Focus screen says so before they start, and a chime and the tab title ask when it's due. If this proves too harsh, the window in `rules.py` is the first thing to widen.
- Existing players need to set a plan before their next block, and blocks already running are paid as before.
- A script can still answer a check-in. That's accepted: this is a tool people choose in order to study, and the daily amount limits what cheating could win.
