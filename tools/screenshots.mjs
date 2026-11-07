#!/usr/bin/env node
/* Visual check (section 18): every screen at 1400px and 400px, on a real server and a fresh account.
   Fails if a screen scrolls sideways or the page logs an error. Build first: make build.
   Usage: node tools/screenshots.mjs [outDir] */
import { mkdirSync } from 'node:fs';
import { ALL_MISSIONS } from '../content/index.mjs';
import { chromePath, chromium, startStack } from './stack.mjs';

const outDir = process.argv[2] || 'frontend/screenshots';
mkdirSync(outDir, { recursive: true });
const stack = await startStack({ apiPort: 8766, webPort: 4766 });
const { base } = stack;
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];

for (const [width, height] of [[1400, 880], [400, 860]]) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${width}: ${e.message}`));
  page.on('console', (m) => {
    // A failed refresh on the login page is how the app learns you aren't logged in.
    if (m.type() === 'error' && !/401/.test(m.text())) problems.push(`${width}: console: ${m.text()}`);
  });
  const shot = async (name) => {
    await page.waitForTimeout(450);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) problems.push(`${width}/${name}: scrolls sideways`);
    await page.screenshot({ path: `${outDir}/${name}-${width}.png` });
  };
  const open = (path) => page.goto(base + path, { waitUntil: 'load' });
  /* A tall window, for a screen that's meant to scroll. */
  const shotWhole = async (name, tall) => {
    await page.setViewportSize({ width, height: tall });
    await shot(name);
    await page.setViewportSize({ width, height });
  };

  await open('/login');
  await page.waitForSelector('#loginBtn');
  await shot('login');
  await open('/register');
  await page.waitForSelector('#registerBtn');
  await page.fill('#username', `shots_${width}`);
  await page.fill('#email', 'shots@example.test');
  await page.waitForFunction(() => document.querySelector('#usernameNote').textContent === 'Available');
  await shot('register');

  const made = await ctx.request.post(`${base}/api/v1/auth/register/`, { data: { username: `shots_${width}`, email: 'shots@example.test', password: 'correct horse battery' } });
  const auth = { Authorization: `Bearer ${(await made.json()).access}` };
  const call = (path, data = {}) => ctx.request.post(`${base}/api/v1${path}`, { headers: auth, data });
  // The screens with history are only worth checking with a year of it behind them.
  const seedHistory = () => stack.manage('shell', '-c', `
import random
from datetime import timedelta
from django.utils import timezone
from apps.focus.models import FocusBlock
from apps.game.models import Player, XPLedger
player = Player.objects.get(user__username='shots_${width}')
chooser = random.Random(3)
now = timezone.now()
for back in range(1, 340):
    moment = now - timedelta(days=back)
    if moment.weekday() > 4 or chooser.random() < 0.3:
        continue
    for _ in range(chooser.randint(1, 4)):
        minutes = chooser.choice([15, 25, 45])
        block = FocusBlock.objects.create(player=player, goal='Worked through the backlog', note='Closed two tickets and wrote up the third', minutes=minutes, kind='plan', started_at=moment, ends_at=moment + timedelta(minutes=minutes), claimed_at=moment + timedelta(minutes=minutes), checked_at=moment, outcome='done')
        XPLedger.objects.create(player=player, delta=minutes + 10, reason='focus', multiplier=1, ref_type='block', ref_id=str(block.pk), created_at=moment)
`);

  await open('/');
  await page.waitForSelector('.deck');
  await shot('deck');
  await open('/focus');
  await page.waitForSelector('#planForm');
  await shot('focus-plan');
  await ctx.request.put(`${base}/api/v1/focus/plan/`, { headers: auth, data: { days: [0, 1, 2, 3, 4], blocks_per_day: 3, block_minutes: 25, windows: [{ start: '07:00', end: '09:00' }, { start: '18:00', end: '20:00' }] } });
  await open('/focus');
  await page.waitForSelector('#goal');
  await shot('focus');
  await open('/missions');
  await page.waitForSelector('.tracks');
  await shot('missions');
  await page.click('.tcard[data-track="SH"] .tcard-head');
  await page.waitForSelector('.chapter');
  await shot('missions-open');
  await open('/profile');
  await page.waitForSelector('.map-grid');
  await shot('profile');
  await shotWhole('profile-empty', 1700);
  seedHistory();
  await open('/profile');
  await page.waitForSelector('.map-grid');
  await page.locator('button.map-cell[data-level="4"]').last().hover({ force: true });
  await shotWhole('profile-history', 1700);
  await open('/missions/sh-01');
  await page.waitForSelector('#launch');
  await shot('briefing');
  await open('/rewards');
  await page.waitForSelector('.badge');
  await shot('rewards');
  await open('/system');
  await page.waitForSelector('#logoutBtn');
  await shot('system');

  await call('/sessions/open/');
  await open('/missions/sh-01/play');
  await page.waitForSelector('#cmd');
  await page.fill('#cmd', 'grep -c 500 ~/logs/api-access.log');
  await page.press('#cmd', 'Enter');
  await shot('play-terminal');
  await page.fill('#cmd', 'vi ~/vi/motd.txt');
  await page.press('#cmd', 'Enter');
  await page.waitForSelector('.vi');
  await shot('play-vi');
  await page.keyboard.type(':q!');
  await page.keyboard.press('Enter');

  await open('/missions/py-01/play');
  await page.waitForFunction(() => document.querySelector('.code-pane .btn.go') && !document.querySelector('.code-pane .btn.go').disabled, null, { timeout: 20000 });
  await shot('play-python');
  await open('/missions/go-01/play');
  await page.waitForSelector('.go-reader');
  await shot('play-go');

  // Real flow: solve a mission, see the debrief, then a question.
  await open('/missions/net-01/play');
  await page.waitForSelector('#cmd');
  await page.fill('#cmd', `submit ${ALL_MISSIONS.find((m) => m.id === 'net-01').answer[0]}`);
  await page.press('#cmd', 'Enter');
  await page.waitForSelector('.over', { timeout: 5000 }).catch(() => problems.push(`${width}: solving a mission showed no debrief`));
  await shot('debrief');
  await page.click('text=Start the questions');
  await page.waitForSelector('.rw-head');
  await shot('rewind');

  await call('/focus/blocks/', { goal: 'Fix the login endpoint bug', minutes: 25 });
  await open('/focus');
  await page.waitForSelector('#clock');
  await shot('focus-running');
  stack.manage('shell', '-c', `from django.utils import timezone; from apps.focus.models import FocusBlock; FocusBlock.objects.filter(player__user__username='shots_${width}', outcome='').update(check_at=timezone.now())`);
  await open('/focus');
  await page.waitForSelector('#presenceYes');
  await shot('focus-check');
  await page.click('#presenceYes');
  stack.manage('shell', '-c', `from django.utils import timezone; from datetime import timedelta; from apps.focus.models import FocusBlock; FocusBlock.objects.filter(player__user__username='shots_${width}', outcome='').update(ends_at=timezone.now() - timedelta(seconds=1))`);
  await open('/focus');
  await page.waitForSelector('#claimNote');
  await shot('focus-claim');
  await ctx.close();
}
await browser.close();
stack.stop();
console.log('screenshots in', outDir);
console.log('PROBLEMS:', problems.length);
problems.slice(0, 30).forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
