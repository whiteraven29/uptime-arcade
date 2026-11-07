# Deploying Uptime Arcade

For whoever runs the server. One script does all of it, for `arcade.wh1teraven.site`.

## Before you run it

1. **A server:** a fresh Ubuntu 24.04 VPS with at least 2 GB of memory, and root access.
2. **DNS:** in Cloudflare, make an A record for `arcade` holding the server's address. Set it to **DNS only (the grey cloud)** for the first run, so the HTTPS certificate can be issued. Records already there may need changing.
3. **An SMTP account:** any provider's free tier works. Brevo is one option, and a Gmail account with an app password works for small numbers. Set up SPF and DKIM for `wh1teraven.site`, or the codes land in spam.
4. **Your code is pushed:** the script deploys what's on GitHub, so push first.

## Run it

```sh
ssh root@YOUR_SERVER
git clone https://github.com/whiteraven29/uptime-arcade.git /srv/uptime-arcade
/srv/uptime-arcade/deploy/install.sh
```

It asks for your certificate email, the SMTP details and your IP address once, and generates every other secret itself. Then it does the rest:

- installs Nginx, Postgres, Redis, Docker and Node, and sets up the firewall and fail2ban
- creates the service accounts and the database, and builds the app and the sandbox images
- gets the HTTPS certificate and starts everything, with nightly backups
- attacks the real sandbox from inside, checks the live site, and stops with an error if anything fails

To use another domain, run it with `UA_DOMAIN=your.domain`.

## After it finishes

The script prints these too:

1. Register an account and confirm the code arrives.
2. Create an admin account with the command it shows. The admin page is at a private address that only your IP can reach.
3. Point an uptime monitor at `https://arcade.wh1teraven.site/api/v1/health/`.
4. Copy `/var/backups/uptime-arcade` off the server every night, and try a restore once:
   ```sh
   set -a; . /etc/uptime-arcade/env; set +a
   /srv/uptime-arcade/deploy/scripts/restore.sh /var/backups/uptime-arcade/db-XXXX.dump uptime_restore_test
   ```

## Turning Cloudflare's proxy on

The site works on DNS only. To put it behind the proxy (the orange cloud), first set **SSL/TLS to Full (strict)** in Cloudflare, or the site will loop or lose its encryption to the server. The script already makes Nginx see each visitor's real address behind Cloudflare, so rate limits keep working.

## Updating

Push your code, then run `/srv/uptime-arcade/deploy/install.sh` again. It asks nothing the second time.

## Keeping it safe

- Security updates install themselves with `unattended-upgrades`. Run `deploy/install.sh` monthly, which also rebuilds the sandbox images.
- Run `pip-audit -r requirements.txt` and `npm audit` in `frontend` before each release.
- Copy `/var/backups/uptime-arcade` off the server every night.
- If the secret key ever leaks, change it. Everyone is logged out, and any code that's waiting stops working.
