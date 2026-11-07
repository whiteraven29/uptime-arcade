#!/usr/bin/env bash
# One script for the whole deployment. Run it as root on an Ubuntu 24.04 server:
#
#   git clone https://github.com/whiteraven29/uptime-arcade.git /srv/uptime-arcade
#   /srv/uptime-arcade/deploy/install.sh
#
# It asks for what it can't work out the first time, then keeps it in /etc/uptime-arcade/env. Running it again later
# updates the site to the latest code, with no questions. Point the domain's DNS at this server first.
set -euo pipefail

DOMAIN="${UA_DOMAIN:-arcade.wh1teraven.site}"
APP=/srv/uptime-arcade
ENV_DIR=/etc/uptime-arcade
ENV_FILE="$ENV_DIR/env"
BACKUPS=/var/backups/uptime-arcade
export DEBIAN_FRONTEND=noninteractive

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARNING: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run this as root."
[ -f "$APP/deploy/install.sh" ] || die "Clone the project to $APP first (see the top of this script)."
cd "$APP"

# ---------- the latest code, then start again on it ----------
if [ -z "${UA_UPDATED:-}" ]; then
  say "Getting the latest code"
  apt-get update -qq && apt-get install -y -qq git >/dev/null
  git pull --ff-only || warn "Couldn't update the code, so this deploys what's already here."
  UA_UPDATED=1 exec "$APP/deploy/install.sh"
fi

# ---------- what only you can answer ----------
ask() { # ask VAR "question" [default]
  local var="$1" question="$2" default="${3:-}" answer=""
  if [ -n "${!var:-}" ]; then return; fi
  [ -t 0 ] || die "$var isn't set, and there's nobody to ask. Set it in the environment or run this in a terminal."
  read -r -p "$question${default:+ [$default]}: " answer
  printf -v "$var" '%s' "${answer:-$default}"
}
ask_secret() { # ask_secret VAR "question"
  local var="$1" question="$2" answer=""
  if [ -n "${!var:-}" ]; then return; fi
  [ -t 0 ] || die "$var isn't set, and there's nobody to ask."
  read -r -s -p "$question: " answer; echo
  printf -v "$var" '%s' "$answer"
}
quote() { printf "'%s'" "$1"; } # single quotes work for both systemd and the shell

if [ -f "$ENV_FILE" ]; then
  say "Using the settings in $ENV_FILE"
else
  say "A few questions, once only"
  command -v openssl >/dev/null || apt-get install -y -qq openssl >/dev/null
  ask CERT_EMAIL "Email for HTTPS certificate expiry notices"
  ask EMAIL_HOST "SMTP host (for example smtp-relay.brevo.com or smtp.gmail.com)"
  ask EMAIL_PORT "SMTP port" 587
  ask EMAIL_HOST_USER "SMTP username"
  ask_secret EMAIL_HOST_PASSWORD "SMTP password or app password"
  ask DEFAULT_FROM_EMAIL "Send emails from" "Uptime Arcade <no-reply@${DOMAIN#*.}>"
  ask ADMIN_IP "Your own IP address, for the admin page (blank turns the admin page off)" "$(echo "${SSH_CLIENT:-}" | cut -d' ' -f1)"
  [ -n "$EMAIL_HOST_PASSWORD" ] || die "The SMTP password can't be empty, or nobody could confirm their email."
  for value in "$CERT_EMAIL" "$EMAIL_HOST" "$EMAIL_PORT" "$EMAIL_HOST_USER" "$EMAIL_HOST_PASSWORD" "$DEFAULT_FROM_EMAIL"; do
    case "$value" in *\'*) die "A value can't contain a single quote. Use a different password or address." ;; esac
  done
  case "$ADMIN_IP" in *[!0-9a-fA-F:.]*) die "That doesn't look like an IP address: $ADMIN_IP" ;; esac

  install -d -m 750 "$ENV_DIR"
  umask 077
  {
    echo "DJANGO_SECRET_KEY=$(quote "$(openssl rand -base64 64 | tr -d '\n=+/')")"
    echo "DJANGO_ALLOWED_HOSTS=$(quote "$DOMAIN")"
    echo "DJANGO_ADMIN_PATH=$(quote "manage-$(openssl rand -hex 8)/")"
    echo "DJANGO_NUM_PROXIES=1"
    echo "POSTGRES_DB=uptime_arcade"
    echo "POSTGRES_USER=uptime"
    echo "POSTGRES_PASSWORD=$(quote "$(openssl rand -hex 32)")"
    echo "POSTGRES_HOST=localhost"
    echo "POSTGRES_PORT=5432"
    echo "REDIS_URL=redis://127.0.0.1:6379/0"
    echo "RUNNER_RUNTIME="
    echo "EMAIL_HOST=$(quote "$EMAIL_HOST")"
    echo "EMAIL_PORT=$(quote "$EMAIL_PORT")"
    echo "EMAIL_HOST_USER=$(quote "$EMAIL_HOST_USER")"
    echo "EMAIL_HOST_PASSWORD=$(quote "$EMAIL_HOST_PASSWORD")"
    echo "DEFAULT_FROM_EMAIL=$(quote "$DEFAULT_FROM_EMAIL")"
    echo "CERT_EMAIL=$(quote "$CERT_EMAIL")"
    echo "ADMIN_IP=$(quote "$ADMIN_IP")"
  } > "$ENV_FILE"
  umask 022
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# ---------- the server ----------
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "This was written for Ubuntu 24.04, and this is ${PRETTY_NAME:-something else}."

say "Installing what the server needs"
apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade >/dev/null
apt-get install -y -qq nginx postgresql redis-server python3-venv libpq5 certbot docker.io ufw \
  unattended-upgrades fail2ban curl ca-certificates sudo >/dev/null
python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))' || die "Python 3.12 or newer is needed, so use Ubuntu 24.04."
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
systemctl enable --now docker redis-server postgresql fail2ban >/dev/null

say "Firewall"
# Whichever port this session came in on stays open, so this can't lock you out.
SSH_PORT="$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')"
ufw default deny incoming >/dev/null
ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

say "Service accounts"
id uptime >/dev/null 2>&1 || adduser --system --group --no-create-home --home /nonexistent uptime >/dev/null
id uptime-runner >/dev/null 2>&1 || adduser --system --group --no-create-home --home /nonexistent uptime-runner >/dev/null
# Docker amounts to root on this machine, so only the grading worker has it. The web service doesn't.
usermod -aG docker uptime-runner
chown -R root:root "$APP"
chmod -R a+rX "$APP"
chown root:uptime "$ENV_DIR" "$ENV_FILE"
chmod 750 "$ENV_DIR"
chmod 640 "$ENV_FILE"
install -d -m 700 -o uptime -g uptime "$BACKUPS"

say "Database"
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$POSTGRES_USER'" | grep -q 1; then
  sudo -u postgres psql -qc "create role $POSTGRES_USER login password '$POSTGRES_PASSWORD'"
fi
if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname='$POSTGRES_DB'" | grep -q 1; then
  sudo -u postgres createdb -O "$POSTGRES_USER" "$POSTGRES_DB"
fi

# ---------- the app ----------
say "Building the app and the sandbox images (the first time takes several minutes)"
[ -d .venv ] || python3 -m venv .venv
install -m 644 deploy/systemd/uptime-web.service deploy/systemd/uptime-worker.service \
  deploy/systemd/uptime-maintenance.service deploy/systemd/uptime-maintenance.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable uptime-web uptime-worker >/dev/null
systemctl enable --now uptime-maintenance.timer >/dev/null
deploy/scripts/deploy.sh
chmod -R a+rX "$APP"

# ---------- HTTPS ----------
say "Nginx and HTTPS for $DOMAIN"
# Behind Cloudflare's proxy every request arrives from a Cloudflare address, so rate limits and the admin allow-list
# would see those instead of the visitor. The real address is only believed when the request came from Cloudflare.
CF_V4="$(curl -fsS -m 20 https://www.cloudflare.com/ips-v4 || true)"
CF_V6="$(curl -fsS -m 20 https://www.cloudflare.com/ips-v6 || true)"
if [ -n "$CF_V4" ] && [ -n "$CF_V6" ]; then
  {
    echo "# Written by deploy/install.sh from Cloudflare's published ranges."
    for range in $CF_V4 $CF_V6; do echo "set_real_ip_from $range;"; done
    echo "real_ip_header CF-Connecting-IP;"
  } > /etc/nginx/conf.d/uptime-cloudflare.conf
else
  warn "Couldn't fetch Cloudflare's address ranges, so keeping what's there. Behind its proxy, rate limits need them."
fi
SITE=/etc/nginx/sites-available/uptime-arcade
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
install -d /var/www/certbot
rm -f /etc/nginx/sites-enabled/default
ln -sf "$SITE" /etc/nginx/sites-enabled/uptime-arcade
if [ ! -f "$CERT" ]; then
  HERE="$(hostname -I)"
  THERE="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
  [ -n "$THERE" ] || die "$DOMAIN doesn't resolve yet. Add an A record pointing at this server, wait a few minutes, then run this again."
  case " $HERE " in
    *" $THERE "*) ;;
    *) warn "$DOMAIN points at $THERE, and this server has: $HERE. That's normal behind Cloudflare's proxy, as long as its A record holds this server's address." ;;
  esac
  # Just enough to prove the domain is ours, because the full config needs the certificate to exist.
  cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
NGINX
  nginx -t -q
  systemctl reload nginx || systemctl restart nginx
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" \
    --deploy-hook "systemctl reload nginx" || die "No certificate yet. In Cloudflare, set this record to DNS only (the grey cloud) with this server's address, wait a few minutes, then run this again."
fi
install -m 644 deploy/nginx/uptime-proxy.conf /etc/nginx/snippets/uptime-proxy.conf
ADMIN_LOCATION="${DJANGO_ADMIN_PATH%/}"
sed -e "s/arcade\.example\.com/$DOMAIN/g" -e "s#/manage-CHANGE-ME/#/$ADMIN_LOCATION/#" deploy/nginx/uptime-arcade.conf > "$SITE.new"
if [ -n "${ADMIN_IP:-}" ]; then
  sed -i "s/YOUR\.ADMIN\.IP/$ADMIN_IP/" "$SITE.new"
else
  sed -i "/YOUR\.ADMIN\.IP/d" "$SITE.new"
fi
mv "$SITE.new" "$SITE"
nginx -t -q
systemctl reload nginx || systemctl restart nginx

# ---------- prove it ----------
say "Attacking the real sandbox from inside"
FAILED=""
SANDBOX_LOG="$(mktemp)"
node tools/verify_content.mjs >/dev/null 2>&1 || warn "The content check reported a problem."
(cd backend && env -i PATH="$PATH" HOME=/root DJANGO_SETTINGS_MODULE=config.settings.test \
  ../.venv/bin/python -m pytest -q -p no:cacheprovider -p no:warnings -m docker_sandbox --override-ini addopts=) > "$SANDBOX_LOG" 2>&1 || FAILED="sandbox"
tail -15 "$SANDBOX_LOG"
# Tests that were all skipped exit cleanly too, and they'd have proved nothing.
if ! grep -q ' passed' "$SANDBOX_LOG" || grep -q ' skipped' "$SANDBOX_LOG"; then FAILED="sandbox"; fi

say "Checking the live site"
sleep 2
curl -fsS "https://$DOMAIN/api/v1/health/" >/dev/null && echo "API: OK" || FAILED="$FAILED site"
PAGE="$(curl -fsS "https://$DOMAIN/" || true)"
case "$PAGE" in *'id="root"'*) echo "Frontend: OK" ;; *) FAILED="$FAILED frontend" ;; esac
systemctl is-active --quiet uptime-worker && echo "Grading worker: OK" || FAILED="$FAILED worker"
systemctl is-active --quiet uptime-web && echo "Web service: OK" || FAILED="$FAILED web"

if [ -n "$FAILED" ]; then
  die "It's installed, but these checks failed:$FAILED. Look at: journalctl -u uptime-web -u uptime-worker -n 50"
fi

cat <<DONE

Live at https://$DOMAIN

Still to do by hand:
  0. If you use Cloudflare's proxy (the orange cloud), set SSL/TLS to Full (strict). Any lower setting loops or isn't safe.
  1. Register an account there, and check the code arrives (and isn't in spam).
  2. Make an admin account:
       cd $APP/backend && set -a && . $ENV_FILE && set +a && DJANGO_SETTINGS_MODULE=config.settings.prod ../.venv/bin/python manage.py createsuperuser
     The admin page is https://$DOMAIN/$DJANGO_ADMIN_PATH, from ${ADMIN_IP:-nowhere, since you left the address blank}.
  3. Point an uptime monitor at https://$DOMAIN/api/v1/health/
  4. Copy $BACKUPS off this server every night.

To update later: push your code, then run this script again.
DONE
