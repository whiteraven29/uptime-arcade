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

  // NetLab, from a lab with a real problem to solve. The missions it needs are marked clear, and the rest is real play.
  stack.manage('shell', '-c', `
from apps.content.models import Mission
from apps.game.models import Player
from apps.missions.models import MissionProgress
p = Player.objects.get(user__username='shots_${width}')
order = Mission.objects.get(code='lab-32').order
for m in [*Mission.objects.filter(code__in=['net-05', 'net-46']), *Mission.objects.filter(track__code='LAB', order__lt=order)]:
    MissionProgress.objects.get_or_create(player=p, mission=m, season=p.season, defaults={'state': 'cleared'})
`);
  await open('/missions/lab-32/play');
  await page.waitForSelector('.lab-map');
  await page.locator('.lab-device[data-device="PC-HQ"]').click();
  await page.fill('#cmd', 'ping 10.42.0.10');
  await page.press('#cmd', 'Enter');
  await page.click('#labCheck');
  await page.waitForSelector('.lab-goals .bad');
  await page.waitForTimeout(1600);
  await shot('netlab');
  // A replay, with a drill running, and a packet to step through.
  await open('/missions/lab-21/play');
  await page.waitForSelector('.lab-map');
  await page.click('#drillOne');
  await page.waitForSelector('#drillStatus');
  await page.locator('.lab-device[data-device="GUEST-1"]').click();
  await page.fill('#cmd', 'curl 10.40.41.80');
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(900);
  await shot('netlab-drill');
  await open('/sandbox');
  await page.waitForSelector('.sandbox-palette');
  for (const id of ['#add-router', '#add-switch', '#add-ap', '#add-laptop', '#add-pc']) await page.click(id);
  // Halfway through dragging a cable, which is the moment worth seeing.
  const end = async (key) => {
    const b = await page.locator(`.lab-socket[data-port="${key}"]`).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  await page.locator('.lab-map').scrollIntoViewIfNeeded();
  const [ax, ay] = await end('R-1|Gi0/0');
  const [bx, by] = await end('SW-1|Gi0/3');
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 6 });
  if (!(await page.locator('#labWire').count())) problems.push(`${width}: a port could not be grabbed`);
  await shot('netlab-wiring');
  if (width < 700) {
    // A device off to one side has to be reachable, so the map slides along with the cable.
    for (let i = 0; i < 12; i++) await page.mouse.move(width - 6, by + (i % 2));
    if (!(await page.locator('.lab-canvas').evaluate((e) => e.scrollLeft > 0))) problems.push(`${width}: the map doesn't slide while wiring`);
  }
  await page.mouse.move(bx, by);
  await page.mouse.up();
  await shot('netlab-sandbox');
  await open('/missions');
  await page.waitForSelector('.tracks');
  await page.click('.tcard[data-track="LAB"] .tcard-head');
  await page.waitForSelector('.tcard[data-track="LAB"] .chapter');
  await shot('netlab-missions');

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

/* The landing pages must fit the window at every size, with nothing to scroll. */
const SIZES = [[2560, 1440], [1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1280, 600], [1024, 768], [1024, 600], [820, 1180], [768, 1024], [600, 960], [430, 932], [400, 860], [390, 844], [375, 667], [360, 640], [320, 568], [844, 390], [667, 375]];
const fits = (page, name, selectors) => page.evaluate(({ selectors }) => {
  const found = [];
  const de = document.documentElement;
  if (de.scrollHeight > innerHeight + 1) found.push(`the page is ${de.scrollHeight}px tall in a ${innerHeight}px window`);
  if (de.scrollWidth > innerWidth + 1) found.push('it scrolls sideways');
  for (const e of document.querySelectorAll('main, .screen, .deck')) if (e.scrollHeight > e.clientHeight + 1) found.push(`${e.className || e.tagName} overflows`);
  for (const sel of selectors) {
    for (const e of document.querySelectorAll(sel)) {
      const b = e.getBoundingClientRect();
      if (b.width && (b.bottom > innerHeight + 1 || b.right > innerWidth + 1 || b.left < -1 || b.top < -1)) found.push(`${sel} is off screen`);
    }
  }
  return found;
}, { selectors }).then((found) => found.forEach((f) => problems.push(`${name}: ${f}`)));
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    for (const [path, ready] of [['/login', '#loginBtn'], ['/register', '#registerBtn']]) {
      await page.goto(base + path);
      await page.waitForSelector(ready);
      await fits(page, `${path} ${width}x${height}`, [ready]);
    }
  }
  await ctx.request.post(`${base}/api/v1/auth/register/`, { data: { username: 'shots_fit', email: 'fit@example.test', password: 'correct horse battery' } });
  await page.goto(`${base}/`);
  await page.waitForSelector('.deck');
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(120);
    await fits(page, `deck ${width}x${height}`, ['.top', '.strip-main .btn', '.path', '.tile', '.core']);
  }
  await ctx.close();
}
await browser.close();
stack.stop();
console.log('screenshots in', outDir);
console.log('PROBLEMS:', problems.length);
problems.slice(0, 30).forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
