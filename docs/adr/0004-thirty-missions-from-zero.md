# ADR 0004: Bring the 30-per-track catalogue forward, from zero

**Status:** accepted, 2026-11-07. Changes the order in section 19 and the interim ladder in ADR 0002.

## Context

The game had 30, 12, 18, 18 and 22 missions per track, in the legacy order. Shell opened on awkward file names, and Python opened on `def`. The owner pointed out that this teaches nothing to a real beginner, and asked for 30 missions per area running from basics to competence, before going further. Section 8 already specified this, but only as part of M7.

## Decision

- **Do the five existing tracks of M7 now**, ahead of M1. NetLab and Operations still wait for M6 and M7, because their engines don't exist.
- **Follow section 8's order**, reusing legacy missions wherever they fit a slot. 31 legacy missions do not fit and are retired, 69 carry over, and 81 are new. The retired ones stay in `legacy/` and git history.
- **Permanent IDs that match section 8** (`sh-01`), so M1 can convert without renumbering. Older saves move across through a mapping table, and `peak` keeps titles from falling.
- **Enforce the rule.** `tools/check_taught_before_used.mjs` fails the build if a solution uses anything no earlier lesson taught. It's JavaScript rather than the Python named earlier, because the catalogue is still JavaScript.
- **Interim ladder:** section 6.4's thresholds scaled to 150, so Archmage still means every mission cleared.

### Changes to section 8, forced by what runs in the browser

Skulpt, the Python used in the browser, has no `ipaddress` or `dataclasses`.

- PY-24 "Networks in code" works out subnets with bit shifts, without `ipaddress`.
- PY-26 becomes "Objects that remember", about state on `self`, without `@dataclass`.
- PY-19 uses a small `json` module shipped to Skulpt. PY-20 reads files, and writing waits for the runner.
- `tools/verify_content.mjs` now runs every Python solution under both `python3` and Skulpt, because passing on one doesn't prove the other.

Other changes:

- The vi engine gained redo, `t T ,`, text objects, visual modes, block insert, named registers, marks, macros, ex ranges, `:g`, `:v`, `:r`, `:w name` and `:e`.
- Go fix missions are "fill the blank", run for real with the answer put in. They become write-and-run in M9.
- NET-30 is reasoned from a saved transcript rather than a `multi` check.

## Consequences

- This is more JavaScript for M1 to convert (150 missions rather than 100), but the IDs, order and lessons are now final, so M1 changes format only.
- Solutions and answers still live in the browser until M2, as ADR 0002 records.
