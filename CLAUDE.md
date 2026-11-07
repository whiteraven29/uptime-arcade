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

**Security:** never add a server-only field to a public serializer, list fields one by one, and never read a time from the client. Nothing in `frontend/` may import `content/`, and `tools/check_bundle.mjs` enforces it. Never reveal whether an email is in use.

**Curriculum rule:** a solution may only use what its own or an earlier lesson in that track teaches. List new ideas under `teaches`; `tools/check_taught_before_used.mjs` enforces it.
