# Uptime Arcade

Real focus earns play time, and play time teaches real shell, vi, Python, Go and networking skills. You join Whiteraven, a fictional cloud company, as a Noob and work your way up to Archmage.

The design and roadmap are in [docs/DESIGN.md](docs/DESIGN.md).

## Run it

```bash
make setup
make dev-backend    # in one terminal: sets up the database and serves the API on port 8000
make dev-frontend   # in another: the game, on http://localhost:5173
```

The game needs both. Your progress is kept on the server, and you log in with a username.

## Check it

```bash
make check
make e2e
```

`make check` runs the backend, engine and client tests, checks that no mission uses anything it hasn't taught, validates every mission file, plays all 200 missions through the real engines, builds the frontend and scans the build for answers. Python solutions are also run under real `python3` and under Skulpt, and Go programs under real `go run`, when those are installed.

`make e2e` runs a real browser against a real server on a fresh account, including attempts to cheat. `make screenshots` checks every screen at 1400px and 400px.

## Layout

| Folder | What's in it |
|---|---|
| `backend/` | Django and DRF. Health endpoint and app scaffolds so far |
| `frontend/` | React and Vite: the HUD kit, screens and sound |
| `engines/` | Framework-free shell, file system, vi and rewind engines |
| `content/` | The curriculum. Every mission is one YAML file in `content/missions/` |
| `tools/` | Content verification and the screenshot check |
| `legacy/` | The original single-file game, for reference |
| `docs/` | The design document and decision records |
