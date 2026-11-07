#!/usr/bin/env bash
# One script for the whole deployment. Run it as root on an Ubuntu 24.04 server:
#
#   git clone https://github.com/whiteraven29/uptime-arcade.git /srv/uptime-arcade
#   /srv/uptime-arcade/deploy/install.sh
#
# It asks for what it can't work out the first time, then keeps it in /etc/uptime-arcade/env. Running it again later
# updates the site to the latest code, with no questions. Point the domain's DNS at this server first.
#
# On a server that runs other projects it leaves them alone: no firewall lockdown, no system upgrades, no global Node,
# its own port and its own Redis database, and Nginx only gains one more site, checked before it's used.
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
  apt-get update -qq
  command -v git >/dev/null || apt-get install -y -qq git >/dev/null
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

set_env() { # set_env KEY VALUE: changes one setting and uses it from here on
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.new" || true
  echo "$1='$2'" >> "$ENV_FILE.new"
  cat "$ENV_FILE.new" > "$ENV_FILE"
  rm -f "$ENV_FILE.new"
  export "$1=$2"
}
port_free() { ! ss -tlnH "sport = :$1" | grep -q .; }
first_free_port() { local port="$1"; while ! port_free "$port"; do port=$((port + 1)); done; echo "$port"; }
holder_of() { ss -tlnpH "sport = :$1" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }
redis_answers() { timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1 && printf 'PING\r\n' >&3 && read -r reply <&3 && [[ \$reply == +PONG* ]]" 2>/dev/null; }

# ---------- does this server run other things? ----------
# If it does, nothing they depend on gets changed: no firewall changes that could block them, no system upgrades, no
# new global Node, and Nginx only gains one more site. Decided once, the first time, and remembered.
if [ ! -f "$ENV_DIR/.installed" ] && [ ! -f "$ENV_DIR/.shared" ]; then
  OTHER_SITES="$(find /etc/nginx/sites-enabled -mindepth 1 ! -name default ! -name uptime-arcade 2>/dev/null | tr '\n' ' ' || true)"
  OTHER_PORTS="$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|\[::ffff:127\.)' | sed 's/.*://' | grep -vxE "22|80|443|$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')" | sort -un | tr '\n' ' ' || true)"
  CONTAINERS="$(docker ps -q 2>/dev/null | wc -l || true)"
  if [ -n "$OTHER_SITES$OTHER_PORTS" ] || [ "${CONTAINERS:-0}" -gt 0 ]; then touch "$ENV_DIR/.shared"; fi
fi
SHARED=""
[ ! -f "$ENV_DIR/.shared" ] || SHARED=1
[ -z "$SHARED" ] || say "This server runs other projects, so they'll be left alone"

# Things that would stop this working, found before anything changes.
for port in 80 443; do
  HOLDER="$(holder_of "$port" || true)"
  if [ -n "$HOLDER" ] && [ "$HOLDER" != nginx ]; then
    die "Port $port is held by '$HOLDER', not by Nginx on this machine. If a container handles your web traffic, this site has to be added to that instead. Nothing has been changed."
  fi
done
python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))' || die "This needs Python 3.12 or newer, and this server has $(python3 --version). Nothing has been changed."

# ---------- what the app needs ----------
say "Installing what's missing"
[ -n "$SHARED" ] || apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade >/dev/null
MISSING=""
for pkg in postgresql python3-venv libpq5 curl ca-certificates sudo xz-utils; do
  dpkg -s "$pkg" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
done
for tool in nginx:nginx certbot:certbot docker:docker.io fail2ban-client:fail2ban ufw:ufw; do
  command -v "${tool%%:*}" >/dev/null || MISSING="$MISSING ${tool##*:}"
done
[ -n "$SHARED" ] || dpkg -s unattended-upgrades >/dev/null 2>&1 || MISSING="$MISSING unattended-upgrades"
if [ -n "$MISSING" ]; then
  # shellcheck disable=SC2086
  if ! apt-get install -y -q $MISSING; then
    echo "Held packages: $(apt-mark showhold | tr '\n' ' ')" >&2
    die "apt couldn't install:$MISSING. Its reason is just above. The firewall and Nginx haven't been changed."
  fi
fi
systemctl is-active --quiet docker || systemctl enable --now docker >/dev/null
systemctl list-unit-files docker.service >/dev/null 2>&1 || die "Docker isn't running as docker.service here, which the grading worker needs."

# Our own copy of Node when the server's is too old, because upgrading the shared one could break other projects.
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  NODE_DIR=/opt/uptime-arcade-node
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    say "Installing a private copy of Node 22 in $NODE_DIR"
    case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) die "No Node download for $(uname -m)." ;; esac
    WORK="$(mktemp -d)"
    curl -fsSL -o "$WORK/SHASUMS256.txt" https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
    NODE_FILE="$(grep -o "node-v22[^ ]*-linux-$ARCH.tar.xz" "$WORK/SHASUMS256.txt" | head -1)"
    curl -fsSL -o "$WORK/$NODE_FILE" "https://nodejs.org/dist/latest-v22.x/$NODE_FILE"
    (cd "$WORK" && grep " $NODE_FILE\$" SHASUMS256.txt | sha256sum -c --quiet) || die "The Node download didn't match its checksum."
    install -d "$NODE_DIR"
    tar -xJf "$WORK/$NODE_FILE" -C "$NODE_DIR" --strip-components=1
    rm -rf "$WORK"
  fi
  export PATH="$NODE_DIR/bin:$PATH"
  set_env NODE_BINARY "$NODE_DIR/bin/node"
fi

say "Firewall"
SSH_PORT="$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')"
if [ -n "$SHARED" ]; then
  # Only opens what this site needs. Turning a firewall on here could cut off the other projects.
  if ufw status | grep -q '^Status: active'; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    echo "Your firewall is on, so 80 and 443 are allowed. The rest of its rules are as they were."
  else
    echo "Your firewall is off, and it stays off, because turning it on could block your other projects."
  fi
else
  # Whichever port this session came in on stays open, so this can't lock you out.
  ufw default deny incoming >/dev/null
  ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  systemctl enable --now fail2ban >/dev/null
fi

say "Choosing ports and Redis"
[ -n "${UPTIME_PORT:-}" ] || set_env UPTIME_PORT "$(first_free_port 8600)"
REDIS_CONTAINER=uptime-arcade-redis
if docker ps -a --format '{{.Names}}' | grep -qx "$REDIS_CONTAINER"; then
  docker start "$REDIS_CONTAINER" >/dev/null
elif redis_answers 6379; then
  # Its own numbered database, so this app's keys never mix with another project's.
  set_env REDIS_URL redis://127.0.0.1:6379/7
elif port_free 6379 && ! dpkg -s redis-server >/dev/null 2>&1; then
  apt-get install -y -q redis-server
  systemctl enable --now redis-server >/dev/null
  set_env REDIS_URL redis://127.0.0.1:6379/7
else
  # A Redis with a password, or something else on its port: this app gets its own, reachable only from this machine.
  REDIS_PORT="$(first_free_port 6390)"
  docker run -d --name "$REDIS_CONTAINER" --restart unless-stopped -p "127.0.0.1:$REDIS_PORT:6379" redis:7-alpine redis-server --save '' --appendonly no >/dev/null
  set_env REDIS_URL "redis://127.0.0.1:$REDIS_PORT/0"
fi

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
systemctl enable --now postgresql >/dev/null
# With something else on 5432, such as Postgres in a container, apt's cluster gets another port.
PG_PORT="$(pg_lsclusters -h | awk '$4 == "online" {print $3; exit}')"
[ -n "$PG_PORT" ] || die "Postgres isn't running. See: pg_lsclusters"
set_env POSTGRES_PORT "$PG_PORT"
pg() { sudo -u postgres psql -p "$PG_PORT" "$@"; }
if ! pg -tAc "select 1 from pg_roles where rolname='$POSTGRES_USER'" | grep -q 1; then
  pg -qc "create role $POSTGRES_USER login password '$POSTGRES_PASSWORD'"
fi
if ! pg -tAc "select 1 from pg_database where datname='$POSTGRES_DB'" | grep -q 1; then
  sudo -u postgres createdb -p "$PG_PORT" -O "$POSTGRES_USER" "$POSTGRES_DB"
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
SITE=/etc/nginx/sites-available/uptime-arcade
LINK=/etc/nginx/sites-enabled/uptime-arcade
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
REAL_IP=/etc/nginx/snippets/uptime-real-ip.conf
install -d /var/www/certbot /etc/nginx/snippets
[ -n "$SHARED" ] || rm -f /etc/nginx/sites-enabled/default

# Puts a new version of the site in place. If Nginx rejects it, the old one goes back, so the other sites never suffer.
use_site() {
  local old=""
  if [ -f "$SITE" ]; then old="$(mktemp)"; cp "$SITE" "$old"; fi
  mv "$1" "$SITE"
  ln -sf "$SITE" "$LINK"
  if ! nginx -t -q; then
    if [ -n "$old" ]; then mv "$old" "$SITE"; else rm -f "$SITE" "$LINK"; fi
    die "Nginx rejected this site's config, so it has been taken back out and your other sites are untouched."
  fi
  [ -z "$old" ] || rm -f "$old"
  if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl enable --now nginx; fi
}

# Behind Cloudflare's proxy every request arrives from a Cloudflare address, so rate limits and the admin allow-list
# would see those instead of the visitor. This applies only to this site, and is only believed from Cloudflare's ranges.
CF_V4="$(curl -fsS -m 20 https://www.cloudflare.com/ips-v4 || true)"
CF_V6="$(curl -fsS -m 20 https://www.cloudflare.com/ips-v6 || true)"
if [ -n "$CF_V4" ] && [ -n "$CF_V6" ]; then
  {
    echo "# Written by deploy/install.sh from Cloudflare's published ranges."
    for range in $CF_V4 $CF_V6; do echo "set_real_ip_from $range;"; done
    echo "real_ip_header CF-Connecting-IP;"
  } > "$REAL_IP"
else
  warn "Couldn't fetch Cloudflare's address ranges, so keeping what's there. Behind its proxy, rate limits need them."
  [ -f "$REAL_IP" ] || echo "# Cloudflare's ranges couldn't be fetched." > "$REAL_IP"
fi
install -m 644 deploy/nginx/uptime-proxy.conf /etc/nginx/snippets/uptime-proxy.conf

if [ ! -f "$CERT" ]; then
  HERE="$(hostname -I)"
  THERE="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
  [ -n "$THERE" ] || die "$DOMAIN doesn't resolve yet. Add an A record pointing at this server, wait a few minutes, then run this again."
  case " $HERE " in
    *" $THERE "*) ;;
    *) warn "$DOMAIN points at $THERE, and this server has: $HERE. That's normal behind Cloudflare's proxy, as long as its A record holds this server's address." ;;
  esac
  # Just enough to prove the domain is ours, because the full config needs the certificate to exist.
  cat > "$SITE.new" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
NGINX
  use_site "$SITE.new"
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" \
    --deploy-hook "systemctl reload nginx" || die "No certificate yet. In Cloudflare, set this record to DNS only (the grey cloud) with this server's address, wait a few minutes, then run this again."
fi
ADMIN_LOCATION="${DJANGO_ADMIN_PATH%/}"
sed -e "s/arcade\.example\.com/$DOMAIN/g" -e "s#/manage-CHANGE-ME/#/$ADMIN_LOCATION/#" -e "s/127\.0\.0\.1:8000/127.0.0.1:$UPTIME_PORT/" deploy/nginx/uptime-arcade.conf > "$SITE.new"
if [ -n "${ADMIN_IP:-}" ]; then
  sed -i "s/YOUR\.ADMIN\.IP/$ADMIN_IP/" "$SITE.new"
else
  sed -i "/YOUR\.ADMIN\.IP/d" "$SITE.new"
fi
use_site "$SITE.new"

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

touch "$ENV_DIR/.installed"
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
