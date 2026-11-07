# Uptime Arcade

Real focus earns play time, and play time teaches real shell, vi, Python, Go and networking skills. You join Whiteraven, a fictional cloud company, as a Noob and work your way up to Archmage.

The design and roadmap are in [docs/DESIGN.md](docs/DESIGN.md).

## Run it

```bash
make setup
make dev-frontend   # http://localhost:5173
make dev-backend    # http://localhost:8000/api/v1/health/
```

The game currently saves to your browser, so the backend is optional for playing.

## Check it

```bash
make check
```

This runs the backend, engine and rules tests, checks that no mission uses anything it hasn't taught, validates every mission file, plays all 175 missions through the real engines, and builds the frontend. Python solutions are also run under real `python3` and under Skulpt, and Go programs under real `go run`, when those are installed.

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
