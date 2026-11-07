# ADR 0006: XP on completion, difficulty levels, Beyond and friendlier rewinds

**Status:** accepted, 2026-11-07. Changes sections 6.3, 6.5, 6.8 and 8.

## Context

The owner asked for four changes:

- XP should come from completing a full task, not from individual rewind questions.
- Missions and tasks should have difficulty levels, including missions after Archmage, from easy to brainfuck.
- Each level climbed should earn a badge.
- Rewind questions confused beginners, and hints should come after failing the questions.

## Decision

- **XP:** solving and answering pay nothing. A mission's whole value is paid once, on the last rewind answer. The rewind-task XP from section 6.3 is removed. The par bonus and hint cost still decide the amount, and focus blocks still pay XP. Saves from before this change aren't paid twice.
- **Difficulty:** Easy, Medium, Hard, Expert and Brainfuck. Each mission has one in its YAML, and it sets the XP. Core tracks use the first four: missions 1 to 10 are Easy (100 XP), 11 to 20 Medium (130), 21 to 28 Hard (160), and the last two Expert (200). The values live in `content/tracks.yaml`, not `rules.py`, because they describe the content. Rewind tasks have a level too, and run easiest first.
- **Beyond:** 50 missions that open at Archmage, five tiers of ten with two per skill in each. They pay 200, 300, 400, 500 and 750 XP. They don't count towards levels, so Archmage keeps its meaning (section 6.10).
- **Badges:** one for each level from 2 to 9 (Archmage already had one), and one for each Beyond tier, 30 in total.
- **Rewinds:**
  - Questions are in plain language, say what kind of answer they want, and name the mission.
  - A wrong answer no longer shows the right one. It says so and moves on.
  - Hints appear once every question still left has been failed at least once.
  - After three misses on one question, its answer is shown.

## Confirmed by the owner

Hints count the questions not yet answered, so someone who gets four right and is stuck on the fifth still gets one. The answer shows after three misses on one question, so nobody can get permanently stuck.

## Consequences

- A player who leaves mid-rewind has earned nothing yet, which makes rewinds matter more.
- Rewind questions were drafted by a script and can be reworded in YAML. Only a sample has been read by a person.
