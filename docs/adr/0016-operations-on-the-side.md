# 16. Operations sit beside the 213

## Context

The design planned 20 multi-tool Operations, with prerequisites written before the curriculum was rebuilt from zero. Levels and Archmage were since fixed at the 213 core missions.

## Decision

- **Operations are a side track.** They don't count toward levels or Archmage, and they can be played in any order. Each opens when its own prerequisites are cleared, and clearing them pays XP as usual and earns a badge.
- **Prerequisites were chosen again** from the current missions, by what each stage really needs. The content check enforces it: a stage may only use what those prerequisites have taught.
- **A stage is graded exactly like a mission,** by the same code, including the replay and the sandbox. The server tracks which stage a player is on, and shows only that stage. A later stage's content and every answer stay on the server.
- **The machine carries across stages,** so files changed in one stage are there in the next.
- **One lab and one code stage per Operation,** because saved lab work and editor text are kept per mission. All 20 fit.
- **The reward stays as it is:** the XP is paid once, after the last stage and the five questions.
- **A replay can practise any stage** for free, in the browser's own order.

## Consequences

The Operations table in section 8.7 now lists the real prerequisites and stages. Fault drills stay with NetLab labs.
