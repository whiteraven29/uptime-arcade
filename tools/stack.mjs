/* Starts the real server and the production build together, on a throwaway database. Used by the
   end-to-end test and the screenshot tool, so they need nothing running first. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const { chromium } = createRequire(join(ROOT, 'frontend/'))('playwright-core');
export const chromePath = () => process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(existsSync);

const PY = join(ROOT, '.venv/bin/python');

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => { setTimeout(r, 200); });
  }
  throw new Error(`${url} never came up`);
}

/* The exact policy production sends, so anything it would block fails here first. */
const productionCsp = () => /add_header Content-Security-Policy "([^"]+)"/.exec(readFileSync(join(ROOT, 'deploy/nginx/uptime-arcade.conf'), 'utf8'))[1];

export async function startStack({ apiPort = 8765, webPort = 4765 } = {}) {
  const env = { ...process.env, DJANGO_SETTINGS_MODULE: 'config.settings.e2e', E2E_DB: join(mkdtempSync(join(tmpdir(), 'uptime-e2e-')), 'db.sqlite3') };
  const manage = (...args) => execFileSync(PY, ['manage.py', ...args], { cwd: join(ROOT, 'backend'), env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  manage('migrate', '--noinput');
  manage('import_content');
  const api = spawn(PY, ['manage.py', 'runserver', `127.0.0.1:${apiPort}`, '--noreload'], { cwd: join(ROOT, 'backend'), env, stdio: 'ignore' });
  const web = spawn('npx', ['vite', 'preview', '--port', String(webPort), '--host', '127.0.0.1', '--strictPort'], { cwd: join(ROOT, 'frontend'), env: { ...process.env, CSP: productionCsp(), API_URL: `http://127.0.0.1:${apiPort}` }, stdio: 'ignore', detached: true });
  const stop = () => {
    api.kill();
    try { process.kill(-web.pid); } catch { /* already gone */ }
  };
  process.on('exit', stop);
  const base = `http://127.0.0.1:${webPort}`;
  /** The newest code emailed to this username, read from the mail files the way a person reads their inbox. */
  const latestCode = (username) => {
    const dir = join(dirname(env.E2E_DB), 'mail');
    const files = readdirSync(dir).map((f) => join(dir, f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
    const mails = files.flatMap((f) => readFileSync(f, 'utf8').split(/-{70,}/));
    const mine = mails.filter((m) => m.includes(`Hi ${username.toLowerCase()},`));
    return mine.at(-1)?.match(/\n\s+(\d{6})\n/)?.[1];
  };
  await waitFor(`http://127.0.0.1:${apiPort}/api/v1/health/`);
  await waitFor(`${base}/`);
  return { base, manage, stop, latestCode };
}
