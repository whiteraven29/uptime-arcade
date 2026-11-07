# ADR 0005: YAML is the only source, and the server owns the rules

**Status:** accepted, 2026-11-07. Replaces the "Decision" list in ADR 0002 for the backend. The browser game described there keeps running until M3 connects it.

## Context

M1 and M2 were next. The owner also asked for XP to be earned only when a mission and its rewind are both finished. That rule can't be trusted unless the server grades both, and those endpoints were planned for M4 and M5.

## Decision

- **YAML is the only place missions are written.** All 175 are in `content/missions/`, and the starting file tree is in `content/fixtures/fs/base.yaml`. `content/legacy/` is gone. The one-off conversion script isn't kept, because it needed the JavaScript it replaced.
- **Two readers, one source.** `manage.py import_content` validates against `content/schema/mission.schema.json` and upserts into the database. `tools/compile_content.mjs` builds `content/build/catalogue.json` for the browser game and the Node tools. The build file is not committed.
- **Goals are data.** JavaScript `check()` functions became `expect` rules, applied by `engines/fs/expect.js` and `apps/missions/grading.py` with the same meaning.
- **Rewind tasks are data in each mission's YAML**, rather than generated at runtime. `engines/rewind-preview/` is gone. Anyone can reword a confusing question by editing one file, and the server never needs a JavaScript generator. New missions need five tasks written by hand, and the schema enforces it.
- **The server gets mission play now:** `missions` and `rewind` endpoints from sections 14 and 16, brought forward from M4 and M5, because the XP rule depends on them.
- **Not connected yet.** The browser game still runs on its own rules and catalogue until M3. So today's game has the new rules, but not the server's protection.

## Security decisions

| Risk | Decision |
|---|---|
| Stolen tokens | Access tokens last 15 minutes and live in memory. Refresh tokens are in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth/`. They rotate on each use, and the old one is blacklisted |
| Password guessing | Argon2, password validators, 10 attempts a minute per address and per account, and one error message for wrong password and unknown email |
| Dodging rate limits | `NUM_PROXIES` is set, so a faked `X-Forwarded-For` doesn't change who you are to the limiter |
| Answers leaking | Public data is listed field by field, never `__all__`. Rewind tasks drop their answer until it has been earned. Tests check real responses |
| Faking time | No endpoint reads a time from the client, and all rules use one server clock. Time zone changes are limited to one a day, so they can't fake a streak day |
| Double payment | Every change takes the player's row lock in a transaction. The database also refuses a second payment, a second open block and a second open session |
| Overposting | Serializers read only named fields, so sending `xp` or `is_staff` does nothing |
| Other people's data | Everything is filtered by the logged-in player, and someone else's block answers 404 |
| Oversized requests | A parser enforces the 1 MB limit, because DRF's JSON parser skips Django's check |
| Malicious content files | `yaml.safe_load` only, so a YAML file can't run code |
| Ledger tampering | Ledgers and missions are read-only in the admin |

## Known limits

- **`fs`, `vi` and `py` results are reported by the browser** (section 14). Someone can fake those until M9's runner replays them. Time, bank, XP, unlocks and answers to `answer` and Go missions are safe now. This must be fixed before any leaderboard.
- **Rate limit counters are per process** until Redis arrives in M5, so several workers would each allow the full rate.
- **Registering with a taken email says so.** Hiding it needs email verification, which doesn't exist yet. There's also no password reset yet.
- **The build file holds the answers.** It must stop being served to browsers when M3 lands.
