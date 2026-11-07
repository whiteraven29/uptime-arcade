# Deploying Uptime Arcade

For whoever runs the server. It assumes a fresh Ubuntu 24.04 VPS and a domain pointing at it.

## 1. What you need first

- A domain with an A record for the server.
- An SMTP account for the codes. Any provider's free tier works. Brevo is one option, and a Gmail account with an app password works for small numbers. Set up SPF and DKIM on your domain, or the codes land in spam.
- Somewhere off the server for backup copies.

## 2. Prepare the server

```sh
apt update && apt -y upgrade
apt install -y nginx postgresql redis-server python3-venv certbot python3-certbot-nginx ufw unattended-upgrades fail2ban
# Install Node 22 and Docker from their own apt repositories.
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

adduser --system --group --home /srv/uptime-arcade uptime
adduser --system --group uptime-runner
usermod -aG uptime uptime-runner
usermod -aG docker uptime-runner   # only this user
```

Keep Postgres and Redis on localhost, which is the default. In `/etc/ssh/sshd_config` turn off password login. Docker access amounts to root on the machine, which is why only the worker's user has it. For stronger isolation, install gVisor and set `RUNNER_RUNTIME=runsc`.

## 3. Database and settings

```sh
sudo -u postgres createuser --pwprompt uptime
sudo -u postgres createdb -O uptime uptime_arcade
install -d -m 750 -o root -g uptime /etc/uptime-arcade
cp .env.example /etc/uptime-arcade/env && chmod 640 /etc/uptime-arcade/env
install -d -m 700 -o uptime -g uptime /var/backups/uptime-arcade
```

Fill in every value in `/etc/uptime-arcade/env`. Generate the key with `python3 -c "import secrets; print(secrets.token_urlsafe(64))"`. Choose a private `DJANGO_ADMIN_PATH`. The app refuses to start if a required value is missing.

## 4. Code and first deploy

```sh
git clone <your repo> /srv/uptime-arcade && cd /srv/uptime-arcade
python3 -m venv .venv
set -a; . /etc/uptime-arcade/env; set +a
deploy/scripts/deploy.sh
cd backend && DJANGO_SETTINGS_MODULE=config.settings.prod ../.venv/bin/python manage.py createsuperuser
```

## 5. Services and HTTPS

```sh
cp deploy/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now uptime-web uptime-worker uptime-maintenance.timer

cp deploy/nginx/uptime-proxy.conf /etc/nginx/snippets/
cp deploy/nginx/uptime-arcade.conf /etc/nginx/sites-available/uptime-arcade
# Edit it: your domain, your admin address, and your DJANGO_ADMIN_PATH.
ln -s /etc/nginx/sites-available/uptime-arcade /etc/nginx/sites-enabled/
certbot certonly --nginx -d arcade.example.com
nginx -t && systemctl reload nginx
```

## 6. Prove it before anyone signs up

1. **Sandbox:** as `uptime-runner`, run `cd /srv/uptime-arcade/backend && ../.venv/bin/python -m pytest -m docker_sandbox --override-ini addopts=`. Every attack in it must fail.
2. **Mail:** register an account and confirm the code arrives, then try a password reset.
3. **Game:** play one Python mission, one Go mission and one lab.
4. **Headers:** check the site on an external scanner such as SSL Labs and Mozilla Observatory.
5. **Backup:** run the maintenance unit, then restore into a scratch database:
   ```sh
   systemctl start uptime-maintenance
   deploy/scripts/restore.sh /var/backups/uptime-arcade/db-XXXX.dump uptime_restore_test
   ```
6. **Monitoring:** point an external uptime monitor at `https://arcade.example.com/api/v1/health/`, and alert when it fails.

## 7. Keeping it safe

- Security updates install themselves with `unattended-upgrades`. Rebuild the sandbox images monthly by running the deploy script.
- Run `pip-audit -r requirements.txt` and `npm audit` in `frontend` before each release.
- Copy `/var/backups/uptime-arcade` off the server every night.
- If the secret key ever leaks, change it. Everyone is logged out, and any code that's waiting stops working.
