PY := $(CURDIR)/.venv/bin/python

.PHONY: setup check test-backend test-engines test-frontend verify-content build dev-backend dev-frontend screenshots

setup:
	test -d .venv || python3 -m venv .venv
	$(PY) -m pip install -r requirements.txt
	cd engines && npm ci
	cd frontend && npm ci

# Everything except end-to-end tests (section 18).
check: test-backend test-engines test-frontend verify-content build

test-backend:
	cd backend && $(PY) manage.py check
	cd backend && $(PY) manage.py makemigrations --check --dry-run
	cd backend && $(PY) -m pytest -q

test-engines:
	cd engines && npx vitest run

test-frontend:
	cd frontend && npx vitest run

verify-content:
	node tools/verify_content.mjs

build:
	cd frontend && npx vite build

dev-backend:
	cd backend && $(PY) manage.py runserver

dev-frontend:
	cd frontend && npx vite

# Needs `make dev-frontend` running. Writes to frontend/screenshots/.
screenshots:
	node tools/screenshots.mjs frontend/screenshots http://localhost:5173
