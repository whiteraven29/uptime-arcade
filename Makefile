PY := $(CURDIR)/.venv/bin/python

.PHONY: sandbox-images sandbox-test setup check e2e content validate-content test-backend test-engines test-frontend verify-content build dev-backend dev-frontend screenshots

setup:
	test -d .venv || python3 -m venv .venv
	$(PY) -m pip install -r requirements.txt
	cd engines && npm ci
	cd frontend && npm ci
	$(MAKE) content

# A real browser against a real server, on a fresh account (section 18). Starts and stops both itself.
e2e: build
	node tools/e2e.mjs

# YAML is the source of truth. This builds the catalogue the browser game and the tools read.
content:
	node tools/compile_content.mjs

# Checks every mission against content/schema without touching a database.
validate-content:
	cd backend && $(PY) manage.py import_content --check

# Everything except end-to-end tests (section 18).
check: validate-content verify-content test-backend test-engines test-frontend build
	node tools/check_bundle.mjs

test-backend:
	cd backend && $(PY) manage.py check
	cd backend && $(PY) manage.py makemigrations --check --dry-run
	cd backend && $(PY) -m pytest -q

test-engines: content
	cd engines && npx vitest run

test-frontend:
	cd frontend && npx vitest run

verify-content: content
	node tools/check_taught_before_used.mjs
	node tools/verify_content.mjs

build: content
	cd frontend && npx vite build

dev-backend:
	cd backend && $(PY) manage.py migrate
	cd backend && $(PY) manage.py import_content
	cd backend && $(PY) manage.py runserver

# The game needs both: make dev-backend in one terminal, make dev-frontend in another.
dev-frontend:
	cd frontend && npx vite

# Starts its own server on a throwaway database. Writes to frontend/screenshots/.
screenshots: build
	node tools/screenshots.mjs frontend/screenshots

# The real containers, attacked from inside. Needs Docker. CI runs this too.
sandbox-images:
	docker build -q -t uptime-arcade/sandbox-python:1 -f runner/sandbox/python.Dockerfile runner/sandbox
	docker build -q -t uptime-arcade/sandbox-go:1 -f runner/sandbox/go.Dockerfile runner/sandbox

sandbox-test: sandbox-images
	cd backend && $(PY) -m pytest -q -m docker_sandbox --override-ini addopts=
