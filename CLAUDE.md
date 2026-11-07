# Uptime Arcade

Real focus earns play time, and play time teaches real technical skills. `docs/DESIGN.md` is the source of truth; read it before non-trivial work.

- Follow the repository layout in section 12. Don't add top-level folders.
- Changing a decision: edit `docs/DESIGN.md` in the same change and record why in `docs/adr/`.
- `engines/` stays framework-free: no React and no DOM. Hosts connect through `engines/host.js`.
- All colours and fonts come from `frontend/src/styles/tokens.css`.
- The scene is painted in code (`frontend/src/ui/scene/`). Use no third-party logos, characters or art.
- Animate only what matters, and respect `prefers-reduced-motion`.
- `make check` must pass before a change is finished. `node tools/screenshots.mjs` checks every screen at 1400px and 400px.

**Where the build stands:** see `docs/adr/0002-local-game-before-the-api.md`. The game runs in the browser from `frontend/src/api/localGame.js` with missions in `content/legacy/`, until M1 and M2 move them to YAML and the server. Each track has its 30 missions, in order, from zero (`docs/adr/0004-thirty-missions-from-zero.md`).

**Curriculum rule:** a solution may only use what its own or an earlier lesson in that track teaches. List new ideas under `teaches`; `tools/check_taught_before_used.mjs` enforces it.
