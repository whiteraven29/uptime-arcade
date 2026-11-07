PY := $(CURDIR)/.venv/bin/python

.PHONY: setup check content validate-content test-backend test-engines test-frontend verify-content build dev-backend dev-frontend screenshots

setup:
	test -d .venv || python3 -m venv .venv
	$(PY) -m pip install -r requirements.txt
	cd engines && npm ci
	cd frontend && npm ci
	$(MAKE) content

# YAML is the source of truth. This builds the catalogue the browser game and the tools read.
content:
	node tools/compile_content.mjs

# Checks every mission against content/schema without touching a database.
validate-content:
	cd backend && $(PY) manage.py import_content --check

# Everything except end-to-end tests (section 18).
check: validate-content test-backend test-engines test-frontend verify-content build

test-backend:
	cd backend && $(PY) manage.py check
	cd backend && $(PY) manage.py makemigrations --check --dry-run
	cd backend && $(PY) -m pytest -q

test-engines: content
	cd engines && npx vitest run

test-frontend: content
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

dev-frontend: content
	cd frontend && npx vite

# Needs `make dev-frontend` running. Writes to frontend/screenshots/.
screenshots:
	node tools/screenshots.mjs frontend/screenshots http://localhost:5173
