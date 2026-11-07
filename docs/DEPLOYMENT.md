# Deploying Uptime Arcade

For whoever runs the server. One script does all of it, for `arcade.wh1teraven.site`.

## Before you run it

1. **A server:** Ubuntu 24.04 with Python 3.12 or newer, and root access. It can already run other projects (see below).
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

## On a server with other projects

The script spots other Nginx sites, open ports or running containers, and then leaves them alone:

- **Firewall:** if it's on, it only adds 80 and 443. If it's off, it stays off.
- **Nginx:** it only gains one more site, in its own file. If Nginx rejects that file it's removed again, so your other sites keep running. The `default` site stays.
- **Packages:** nothing is upgraded, and tools you already have are kept. If your Node is older than 22, this app gets a private copy in `/opt/uptime-arcade-node`.
- **Ports:** the app takes the first free port from 8600, on localhost only.
- **Postgres and Redis:** it adds its own database to Postgres, on whichever port your cluster uses. In Redis it uses its own numbered database. If your Redis has a password or isn't on 6379, it runs a private Redis in a container instead.

It stops before changing anything if something other than Nginx on this machine holds port 80 or 443, such as a container acting as your web proxy. This site would then need adding to that proxy by hand.

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
