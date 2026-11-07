# Uptime Arcade

Real focus earns play time, and play time teaches real technical skills. `docs/DESIGN.md` is the source of truth; read it before non-trivial work.

- Follow the repository layout in section 12. Don't add top-level folders.
- Changing a decision: edit `docs/DESIGN.md` in the same change and record why in `docs/adr/`.
- `engines/` stays framework-free: no React and no DOM. Hosts connect through `engines/host.js`.
- All colours and fonts come from `frontend/src/styles/tokens.css`.
- The scene is painted in code (`frontend/src/ui/scene/`). Use no third-party logos, characters or art.
- Animate only what matters, and respect `prefers-reduced-motion`. Terminal text gets no glow, blur or animation, and `frontend/src/styles/readability.test.js` measures its contrast.
- `make check` must pass before a change is finished. `make e2e` runs a real browser against a real server, and `make screenshots` checks every screen at 1400px and 400px.

**Where the build stands:** missions live only in `content/missions/*.yaml`, and each track runs from zero (`docs/adr/0004-thirty-missions-from-zero.md`). The server owns the rules, time, XP and answers (`docs/adr/0005-yaml-and-server-rules.md`), and screens get everything through `frontend/src/api/game.js` (`docs/adr/0007-the-game-runs-on-the-server.md`).

**NetLab:** the browser runs the simulator, but a pass only comes from the server re-running `engines/netsim` on the submitted configs through `runner/grade_lab.mjs` (`docs/adr/0011-netlab.md`). Goals' assertions stay server-only. Each lab names the Networking mission that opens it under `requires`. Replays of cleared missions, fault drills and the sandbox cost nothing and earn nothing, and all wait for a focus block (`docs/adr/0012-free-replays-and-a-complete-netlab.md`).

**Grading:** a shell or vi result only counts once the server has replayed the player's log on a clean machine, and Python and Go only count from the sandbox (`docs/adr/0015-the-server-decides.md`). Never trust a pass the browser claims. Operations are a side track, outside the 213 (`docs/adr/0016-operations-on-the-side.md`).

**Accounts:** no tokens before a confirmed email, and nothing may reveal whether an account or email exists (`docs/adr/0014-confirmed-email-and-a-clock-that-stops.md`). Clearing a mission closes its session.

**Focus:** a block earns only by keeping a study plan set in advance, and paid minutes in a week can never pass what was planned (`docs/adr/0010-study-plans.md`).

**Security:** never add a server-only field to a public serializer, list fields one by one, and never read a time from the client. A block's `check_at` stays server-only until it's due. Nothing in `frontend/` may import `content/`, and `tools/check_bundle.mjs` enforces it. Never reveal whether an email is in use.

**Curriculum rule:** a solution may only use what its own or an earlier lesson in that track teaches. List new ideas under `teaches`; `tools/check_taught_before_used.mjs` enforces it.
