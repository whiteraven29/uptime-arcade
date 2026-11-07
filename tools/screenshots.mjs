#!/usr/bin/env node
/* Visual check (section 18): screenshots of every screen at 1400px and 400px, against a running
   build. Fails if a screen scrolls sideways or the page logs an error.
   Usage: node tools/screenshots.mjs [outDir] [baseUrl] */
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { TK } from '../content/index.mjs';

const require = createRequire(resolve('frontend/package.json'));
const { chromium } = require('playwright-core');

const outDir = process.argv[2] || 'frontend/screenshots';
const base = process.argv[3] || 'http://127.0.0.1:4173';
mkdirSync(outDir, { recursive: true });
const executablePath = process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);

const browser = await chromium.launch({ executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];

const SAVE = { v: 3, xp: 1240, focusMin: 415, blocks: 17, cleanBlocks: 9, streak: 4, bestStreak: 6, shields: 1, bank: 8 * 60, claimed: { 3: true }, badges: { firstblock: true, first: true } };

for (const [width, height] of [[1400, 880], [400, 860]]) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${width}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${width}: console: ${m.text()}`);
  });
  await page.addInitScript((s) => {
    if (!localStorage.getItem('uptime-arcade-v5')) localStorage.setItem('uptime-arcade-v5', JSON.stringify({ ...s, day: new Date().toDateString() }));
  }, SAVE);

  const shot = async (name, after) => {
    if (after) await after();
    await page.waitForTimeout(450);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) problems.push(`${width}/${name}: scrolls sideways`);
    await page.screenshot({ path: `${outDir}/${name}-${width}.png` });
  };
  const open = (path) => page.goto(base + path, { waitUntil: 'load' });
  const sessionOpen = () => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('uptime-arcade-v5'));
    s.bank = 0;
    s.sessionEndsAt = Date.now() + 36e5;
    localStorage.setItem('uptime-arcade-v5', JSON.stringify(s));
  });

  // The first mission of every track is open on a new save.
  await open('/missions');
  const firstOpen = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.node.open').forEach((n) => {
      out[n.dataset.id.split('-')[0]] = n.dataset.id;
    });
    return out;
  });

  await open('/');
  await shot('deck');
  await open('/focus');
  await shot('focus');
  await open('/missions');
  await shot('missions');
  await open(`/missions/${firstOpen.sh}`);
  await shot('briefing');
  await open('/rewards');
  await shot('rewards');
  await open('/system');
  await shot('system');

  await sessionOpen();
  await open(`/missions/${firstOpen.sh}/play`);
  await page.fill('#cmd', 'grep -c 500 ~/logs/api-access.log');
  await page.press('#cmd', 'Enter');
  await shot('play-terminal');

  await page.fill('#cmd', 'vi ~/vi/motd.txt');
  await page.press('#cmd', 'Enter');
  await shot('play-vi');
  await page.keyboard.type(':q!');
  await page.keyboard.press('Enter');

  await open(`/missions/${firstOpen.py}/play`);
  await page.waitForFunction(() => document.querySelector('.code-pane .btn.go') && !document.querySelector('.code-pane .btn.go').disabled, null, { timeout: 15000 });
  await page.click('.code-pane .btn.go');
  await page.waitForFunction(() => !/Running/.test(document.querySelector('.code-out').textContent), null, { timeout: 15000 });
  await shot('play-python');

  await open(`/missions/${firstOpen.go}/play`);
  await shot('play-go');

  // Real flow: solve a mission, see the debrief, then a rewind task.
  await open(`/missions/${firstOpen.net}/play`);
  await page.fill('#cmd', `submit ${TK.NET[0].answer[0]}`);
  await page.press('#cmd', 'Enter');
  await page.waitForSelector('.over', { timeout: 3000 }).catch(() => problems.push(`${width}: solving a mission showed no debrief`));
  await shot('debrief');
  await page.click('text=Start the questions');
  await shot('rewind');

  // Timer running.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('uptime-arcade-v5'));
    s.sessionEndsAt = null;
    s.focus = { goal: 'Fix the login endpoint bug', len: 25, startedAt: Date.now() - 9 * 60000, endsAt: Date.now() + 16 * 60000, drifts: 0 };
    localStorage.setItem('uptime-arcade-v5', JSON.stringify(s));
  });
  await open('/focus');
  await shot('focus-running');

  await ctx.close();
}
await browser.close();
console.log('screenshots in', outDir);
console.log('PROBLEMS:', problems.length);
problems.slice(0, 30).forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
