#!/bin/sh
# Run on the server from /srv/uptime-arcade as the deploy user, after pulling the code you tested.
set -eu
.venv/bin/python -m pip install -q -r requirements.txt
(cd engines && npm ci --omit=dev)
(cd frontend && npm ci && npm run build)
node tools/compile_content.mjs
cd backend
export DJANGO_SETTINGS_MODULE=config.settings.prod
../.venv/bin/python manage.py check --deploy --fail-level WARNING
../.venv/bin/python manage.py migrate --noinput
../.venv/bin/python manage.py import_content
../.venv/bin/python manage.py collectstatic --noinput
cd ..
docker build -q -t uptime-arcade/sandbox-python:1 -f runner/sandbox/python.Dockerfile runner/sandbox
docker build -q -t uptime-arcade/sandbox-go:1 -f runner/sandbox/go.Dockerfile runner/sandbox
sudo systemctl restart uptime-web uptime-worker
sleep 2
curl -fsS http://127.0.0.1:8000/api/v1/health/ -H 'X-Forwarded-Proto: https' -H "Host: $(echo "$DJANGO_ALLOWED_HOSTS" | cut -d, -f1)"
echo
