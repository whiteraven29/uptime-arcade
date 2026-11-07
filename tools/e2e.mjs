#!/usr/bin/env node
/* Section 18: a real browser against a real server, on a fresh account. It starts both itself, on a
   throwaway database, and the only thing it reaches around the API for is moving a focus block's timer,
   because nobody wants this test to take 25 minutes. Exits 1 on any failure. */
import { join } from 'node:path';
import { ALL_MISSIONS } from '../content/index.mjs';
import { chromePath, chromium, startStack } from './stack.mjs';

const shots = process.argv[2];
const { base: BASE, manage, stop: stopServers } = await startStack();
const byId = (id) => ALL_MISSIONS.find((m) => m.id === id);

const failures = [];
const ok = (name, pass, extra = '') => {
  console.log(`${pass ? 'pass' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!pass) failures.push(name);
};

/* The one reach-around: the timer is over, as far as the server is concerned. */
const endBlockNow = () => manage('shell', '-c', "from django.utils import timezone; from datetime import timedelta; from apps.focus.models import FocusBlock; FocusBlock.objects.filter(outcome='').update(ends_at=timezone.now()-timedelta(seconds=1))");
/* The check comes up at a moment nobody can know, so here it's made to come up now. */
const dueCheckNow = () => manage('shell', '-c', "from django.utils import timezone; from apps.focus.models import FocusBlock; FocusBlock.objects.filter(outcome='').update(check_at=timezone.now())");
const setPeak = (user, n) => manage('shell', '-c', `from apps.game.models import Player; Player.objects.filter(user__username='${user}').update(peak_cleared=${n})`);

const browser = await chromium.launch({ executablePath: chromePath(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const external = [];
page.on('request', (r) => {
  if (!r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url())) external.push(r.url());
});
/* Everything the browser is ever told, so we can check nothing secret was in it. */
const seen = [];
page.on('response', async (r) => {
  if (!r.url().includes('/api/v1/')) return;
  try {
    seen.push({ url: r.url(), text: await r.text() });
  } catch { /* the page moved on before it finished */ }
});
const shot = async (name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};
const xp = async () => Number((await page.locator('.chips').innerText()).match(/XP\s*(\d+)/)[1]);
const typeCmd = async (c) => {
  await page.fill('#cmd', c);
  await page.press('#cmd', 'Enter');
};
/* The next question arrives by itself. Answers also pause briefly, so a double click can't skip one. */
const answered = () => page.waitForTimeout(450);
const openCategory = async (code) => {
  const head = page.locator(`.tcard[data-track="${code}"] .tcard-head`);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await page.waitForSelector(`.tcard[data-track="${code}"] .chapter`);
};
const answerTask = async (m) => {
  const q = await page.locator('.screen .title').first().innerText();
  const t = m.rewind.find((x) => x.q === q);
  if (t.type === 'mc') await page.locator('.opt', { hasText: t.answer }).first().click();
  else if (t.type === 'text') {
    await page.fill('#rwInput', t.answer[0]);
    await page.press('#rwInput', 'Enter');
  } else for (const a of t.answer) await page.locator('.tok:not(.good)', { hasText: a }).first().click();
  await answered();
};
const USER = 'e2e_amina';
const PASSWORD = 'correct horse battery';

try {
  // ---------- signing up ----------
  await page.goto(`${BASE}/`);
  await page.waitForURL('**/login');
  ok('a stranger lands on the login page', page.url().endsWith('/login'));
  await page.goto(`${BASE}/missions`);
  await page.waitForURL('**/login');
  ok("the game can't be reached without logging in", await page.locator('.node').count() === 0);
  await shot('login');

  await page.click('text=Create an account');
  await page.waitForSelector('#registerBtn');
  await page.fill('#username', 'ab');
  await page.waitForFunction(() => /letters, numbers/.test(document.querySelector('#usernameNote').textContent));
  ok('a bad username is explained as you type', true);
  await page.fill('#username', 'admin');
  await page.waitForFunction(() => /can't be used/.test(document.querySelector('#usernameNote').textContent));
  ok('a reserved username is refused as you type', await page.locator('#registerBtn').isDisabled());
  await page.fill('#username', USER);
  await page.waitForFunction(() => document.querySelector('#usernameNote').textContent === 'Available');
  ok('a free username shows Available', await page.locator('#usernameNote.good').count() === 1);
  await shot('register');
  await page.fill('#email', 'shared@example.test');
  await page.fill('#password', 'password123');
  await page.click('#registerBtn');
  await page.waitForSelector('[role=alert]');
  ok('a weak password is refused', (await page.locator('[role=alert]').innerText()).length > 0);
  await page.fill('#password', PASSWORD);
  await page.click('#registerBtn');
  await page.waitForSelector('.deck');
  ok('registering goes straight into the game', true);
  ok('a new player starts with 5:00', (await page.locator('.chip-time').innerText()).includes('05:00'));

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  ok('no token is kept in browser storage', !/eyJ/.test(stored));
  const cookie = (await ctx.cookies()).find((c) => c.name === 'ua_refresh');
  ok('the refresh cookie is HttpOnly and SameSite=Strict', cookie?.httpOnly && cookie?.sameSite === 'Strict');
  ok('page scripts cannot read the cookie', !(await page.evaluate(() => document.cookie)).includes('ua_refresh'));

  // A taken username, and an email already in use, from a second browser.
  const other = await browser.newContext({ viewport: { width: 1400, height: 880 } });
  const p2 = await other.newPage();
  await p2.goto(`${BASE}/register`);
  await p2.waitForSelector('#registerBtn');
  await p2.fill('#username', USER.toUpperCase());
  await p2.waitForFunction(() => document.querySelector('#usernameNote').textContent === 'Already taken');
  ok('a taken username shows taken, whatever the capitals', await p2.locator('#registerBtn').isDisabled());
  await p2.fill('#username', 'e2e_joel');
  await p2.waitForFunction(() => document.querySelector('#usernameNote').textContent === 'Available');
  await p2.fill('#email', 'shared@example.test');
  await p2.fill('#password', PASSWORD);
  await p2.click('#registerBtn');
  await p2.waitForSelector('.deck');
  ok("an email already in use is accepted, so it's never revealed", true);
  await other.close();

  // ---------- the focus economy ----------
  await page.click('.nav >> text=Focus');
  await page.waitForSelector('#planForm');
  ok('a new player sets a study plan before their first block', await page.locator('#startBlock').count() === 0);
  await page.click('.plan-day >> text=Sat'); // whatever day this test happens to run on
  await page.click('.plan-day >> text=Sun');
  await page.fill('#planStart0', '00:00');
  await page.fill('#planEnd0', '23:59');
  await page.click('#savePlan');
  await page.waitForSelector('.plan-error');
  ok('a plan that covers the whole day is refused', (await page.locator('.plan-error').innerText()).includes("isn't a plan"));
  const hours = await page.evaluate(() => {
    const now = new Date();
    const from = Math.max(0, Math.min(now.getHours() * 60 + now.getMinutes() - 30, 23 * 60 + 59 - 120));
    const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return [clock(from), clock(from + 120)];
  });
  await page.fill('#planStart0', hours[0]);
  await page.fill('#planEnd0', hours[1]);
  await page.click('#savePlan');
  await page.waitForSelector('#goal');
  ok('the plan shows what today looks like', (await page.locator('#planToday').innerText()).includes('0 of 50 min'));
  ok('the block shows it will earn before it starts', (await page.locator('#outlook').getAttribute('data-kind')) === 'plan');
  ok('the goals come from the plan', await page.locator('.goal[data-period="week"]').count() === 1 && await page.locator('.goal[data-period="month"]').count() === 1);
  ok('a typo in a first plan can still be fixed', await page.locator('#changePlan').isEnabled());
  await page.fill('#goal', 'Ship the login page');
  await page.check('#phone');
  await page.click('#startBlock');
  await page.waitForSelector('#clock');
  ok('a focus block starts, on the server', true);
  await shot('focus-running');
  const early = await page.evaluate(async () => {
    const r = await fetch('/api/v1/focus/blocks/1/claim/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"done":true}' });
    return r.status;
  });
  ok('the API refuses a request with no token', early === 401);
  ok('the moment of the check is not told in advance', !seen.some((r) => /check_at/.test(r.text)) && await page.locator('#presenceYes').count() === 0);
  await page.goto(`${BASE}/missions/sh-01/play`);
  await page.waitForSelector('.lock');
  ok('missions stay locked while a block runs', (await page.locator('.lock').innerText()).includes('Locked while your focus block runs'));
  dueCheckNow();
  await page.goto(`${BASE}/focus`);
  await page.waitForSelector('#presenceYes');
  ok('the check comes up when it is due', (await page.locator('.check-in').innerText()).includes('Still there?'));
  ok('the tab says so too, for someone in another window', (await page.title()).includes('Still there'));
  await shot('focus-check');
  await page.click('#presenceYes');
  await page.waitForSelector('#presenceYes', { state: 'detached' });
  ok('answering the check clears it', true);
  endBlockNow();
  await page.goto(`${BASE}/focus`);
  await page.waitForSelector('#claimNote');
  ok('a claim needs a line on what you did', await page.locator('#claimYes').isDisabled());
  await page.fill('#claimNote', 'Shipped the login redirect');
  await shot('focus-claim');
  await page.click('#claimYes');
  await page.waitForSelector('#startBlock');
  await page.waitForFunction(() => /15:00/.test(document.querySelector('.chip-time').textContent));
  ok('claiming pays 8:00 plus the 2:00 goal bonus', (await page.locator('.chip-time').innerText()).includes('15:00'));
  ok('the block pays XP, with the first day of its streak', await xp() === 37, `XP ${await xp()}`);
  ok('a badge arrives with its medal', await page.locator('.toast .emblem').count() > 0 || (await page.locator('.toast').innerText()).length > 0, await page.locator('.toast').innerText());
  await page.waitForFunction(() => document.querySelector('#planToday')?.textContent.includes('25 of 50 min'));
  ok('the plan counts the block', true);
  ok('once a block has started, the plan is locked for a week', await page.locator('#changePlan').isDisabled() && (await page.locator('#planLocked').innerText()).includes('You can change it on'));

  // ---------- the history ----------
  await page.goto(`${BASE}/profile`);
  await page.waitForSelector('.map-grid');
  const greens = await page.locator('.map-cell[data-level]:not([data-level="0"])').count();
  ok('today turns green on the focus map', greens === 1, `${greens} green`);
  ok('the map shows a whole year', await page.locator('button.map-cell').count() >= 364);
  ok('both charts draw', await page.locator('#chartFocus .chart-col i').count() === 1 && await page.locator('#chartXp .chart-col i').count() === 1);
  ok('what you did is written down', (await page.locator('#recentBlocks').innerText()).includes('Shipped the login redirect'));
  const tile = page.locator('.map-cell[data-level]:not([data-level="0"])');
  await tile.hover();
  ok('a day says what it holds', (await page.locator('#focusMap .chart-tip').innerText()).includes('25 min'));
  await page.locator('button.map-cell[tabindex="0"]').focus();
  await page.keyboard.press('ArrowLeft');
  ok('the map can be walked with the keyboard', await page.evaluate(() => document.activeElement.classList.contains('map-cell')));
  ok('every chart has a table for its numbers', await page.locator('#chartFocus details').count() === 1 && await page.locator('#chartXp details').count() === 1);

  // ---------- one whole mission ----------
  const before = await xp();
  await page.goto(`${BASE}/missions/sh-01`);
  await page.waitForSelector('#launch');
  ok('the briefing shows its difficulty', await page.locator('.meta .diff-easy').count() === 1);
  await page.click('#launch');
  await page.waitForSelector('#openSession');
  await page.click('#openSession');
  await page.waitForSelector('#cmd');
  ok('opening a session moves the whole bank', (await page.locator('.chip-time').innerText()).toLowerCase().includes('session'));
  await typeCmd('pwd');
  ok('the engine runs in the browser', (await page.locator('.term-out').innerText()).includes('/home/ops'));
  await typeCmd('submit /nowhere');
  await page.waitForFunction(() => /Not that one/.test(document.querySelector('.term-out').textContent));
  ok('a wrong answer is refused by the server', await page.locator('.over').count() === 0);
  await typeCmd('submit /home/ops');
  await page.waitForSelector('.over');
  ok('the right answer shows the debrief', (await page.locator('.over').innerText()).toLowerCase().includes('where am i'));
  ok('solving pays no XP', await xp() === before);
  await page.click('text=Start the questions');
  await page.waitForSelector('.rw-head');
  const m1 = byId('sh-01');
  for (let i = 0; i < 4; i++) {
    await answerTask(m1);
    ok(`question ${i + 1} pays no XP`, await xp() === before);
  }
  await answerTask(m1);
  await page.waitForFunction((b) => Number(document.querySelector('.chips').textContent.match(/XP\s*(\d+)/)[1]) > b, before);
  await page.waitForSelector('.tracks');
  ok('the last answer pays the whole mission', await xp() > before, `${before} to ${await xp()}`);
  ok('its category stays open', await page.locator('.tcard.open[data-track="SH"]').count() === 1);
  ok('the next mission unlocks', await page.locator('.node[data-id="sh-02"].open').count() === 1);

  // ---------- the terminal says what happened ----------
  await page.goto(`${BASE}/missions/sh-02/play`);
  await page.waitForSelector('#cmd');
  await typeCmd('cat nope.txt');
  await page.waitForSelector('.t-out.e');
  ok('an error is shown as an error', (await page.locator('.t-out.e').last().innerText()).includes('No such file'));
  ok('a failed command says how to find out more', (await page.locator('.term-out').innerText()).includes('man cat'));
  ok('it reports how the command ended', (await page.locator('.t-status').last().innerText()).includes('exit 1'));
  await typeCmd('grep zzzqq ~/README');
  await page.waitForFunction(() => /nothing found/.test([...document.querySelectorAll('.t-status')].at(-1).textContent));
  ok("grep finding nothing isn't shown as a failure", true);
  await typeCmd('pwd');
  await page.waitForFunction(() => /done/.test([...document.querySelectorAll('.t-status')].at(-1).textContent));
  ok('a good command says done', true);
  await page.fill('#cmd', 'banana');
  ok('an unknown command is flagged as you type', (await page.locator('#cmdHelp').innerText()).includes('no command called banana'));
  await page.fill('#cmd', 'gre');
  ok('a grey suggestion shows what Tab would add', (await page.locator('.ghost').innerText()).endsWith('p'));
  await page.press('#cmd', 'Tab');
  ok('Tab accepts it', (await page.inputValue('#cmd')).startsWith('grep'));
  await page.fill('#cmd', 'grep');
  ok('the help line says what a command does', (await page.locator('#cmdHelp').innerText()).includes('PATTERN'));
  await page.fill('#cmd', '');
  await shot('terminal');

  // ---------- a goal the browser can't see ----------
  await page.goto(`${BASE}/missions/sh-02/play`);
  await page.waitForSelector('#cmd');
  await typeCmd('cd /etc');
  await page.waitForTimeout(250);
  ok('the goal is not met yet', await page.locator('.over').count() === 0);
  await typeCmd('cd ~/logs');
  await page.waitForSelector('.over');
  ok('the server spots the goal being met', true);

  // ---------- each kind of workspace ----------
  await page.goto(`${BASE}/missions/vi-01/play`);
  await page.waitForSelector('#cmd');
  await typeCmd('vi ~/vi/welcome.txt');
  await page.waitForSelector('.vi');
  await page.keyboard.press('i');
  await page.keyboard.type('Welcome ');
  await page.keyboard.press('Escape');
  await page.keyboard.type(':wq');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.over');
  ok('a vi mission passes through the server', true);

  await page.goto(`${BASE}/missions/py-01/play`);
  await page.waitForFunction(() => {
    const b = document.querySelector('.code-pane .btn.go');
    return b && !b.disabled;
  }, null, { timeout: 20000 });
  await page.fill('.code-pane textarea', 'print("nope")');
  await page.click('.code-pane .btn.go');
  await page.waitForFunction(() => /FAIL/.test(document.querySelector('.code-out').textContent));
  ok('a failed Python run is not a pass', await page.locator('.over').count() === 0);
  await page.fill('.code-pane textarea', 'print("Hello, operator")');
  await page.click('.code-pane .btn.go');
  await page.waitForSelector('.over');
  ok('a Python mission passes through the server', true);

  await page.goto(`${BASE}/missions/go-01/play`);
  await page.waitForSelector('.go-reader');
  ok('Go shows the whole program', (await page.locator('.go-reader').innerText()).includes('package main'));
  await typeCmd('submit Hello, Whiteraven');
  await page.waitForSelector('.over');
  ok('a Go mission passes through the server', true);

  // ---------- rewinds: hints only when earned ----------
  await page.goto(`${BASE}/missions/go-01/rewind`);
  await page.waitForSelector('.rw-head');
  const m2 = byId('go-01');
  const wrongAnswer = async () => {
    const q = await page.locator('.screen .title').first().innerText();
    const t = m2.rewind.find((x) => x.q === q);
    if (t.type === 'mc') {
      const n = await page.locator('.opt').count();
      for (let j = 0; j < n; j++) {
        const text = await page.locator('.opt').nth(j).innerText();
        if (text.trim() !== t.answer.trim()) {
          await page.locator('.opt').nth(j).click();
          break;
        }
      }
    } else if (t.type === 'text') {
      await page.fill('#rwInput', 'definitely wrong');
      await page.press('#rwInput', 'Enter');
    } else {
      for (const a of [...t.answer].reverse()) await page.locator('.tok:not(.good)', { hasText: a }).first().click();
    }
    await answered();
  };
  const firstQuestion = await page.locator('.screen .title').first().innerText();
  await wrongAnswer();
  ok('the next question arrives without clicking anything', (await page.locator('.screen .title').first().innerText()) !== firstQuestion && await page.locator('#rwNext').count() === 0);
  ok('a wrong answer says so above the next question', (await page.locator('.rw-result').innerText()).includes('Not quite'));
  let t = await page.locator('.screen').innerText();
  ok('miss 1 shows no answer and no hint', !t.includes('The answer is') && !t.includes('Hint:'));
  for (let i = 1; i < 4; i++) {
    await wrongAnswer();
    t = await page.locator('.screen').innerText();
    ok(`miss ${i + 1} shows no answer and no hint`, !t.includes('The answer is') && !t.includes('Hint:'));
  }
  await wrongAnswer();
  await page.waitForSelector('.rw-help');
  ok('a hint appears once every question has been failed', (await page.locator('.rw-help').innerText()).includes('Hint:'));
  await shot('rewind-hint');

  // ---------- nothing secret ever arrived ----------
  const unsolved = byId('net-30');
  const beforeSolve = seen.filter((r) => !/debrief/.test(r.url));
  const everything = beforeSolve.map((r) => r.text).join('\n');
  ok('no response ever carried an accept list', !everything.includes('"accept"'));
  ok('no response ever carried goal rules', !/"expect"|"file_equals"/.test(everything));
  ok('no response carried the answer key of a rewind task', !/"answer"\s*:/.test(everything));
  ok('no response carried an unplayed mission\'s solution', !everything.includes(unsolved.sol) && !everything.includes(unsolved.why));

  // ---------- the rules can't be talked round ----------
  const token = await page.evaluate(async () => (await (await fetch('/api/v1/auth/refresh/', { method: 'POST' })).json()).access);
  const call = (path, method = 'GET', body) => page.evaluate(async ([p, m, b, t]) => {
    const r = await fetch(`/api/v1${p}`, { method: m, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    let data = null;
    try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, data };
  }, [path, method, body, token]);
  await page.reload();
  await page.waitForSelector('.rw-head');
  ok('a locked mission is refused', (await call('/missions/net-02/submit/', 'POST', { answer: 'x' })).status === 403);
  ok('a Beyond mission is refused before Archmage', (await call('/missions/bx-01/')).status === 403);
  const tampered = await call('/auth/me/', 'PATCH', { xp: 999999, peak_cleared: 150, is_staff: true });
  const after = await call('/player/');
  ok('settings cannot set XP or level', tampered.status === 200 && after.data.xp < 2000 && after.data.level.cleared < 213, `XP ${after.data.xp}`);
  ok('another account\'s block looks missing', (await call('/focus/blocks/999999/claim/', 'POST', { done: true })).status === 404);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      const v = JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify({ ...v, xp: 999999, bank: 999999, peak: 150 }));
    }
  });
  await page.reload();
  await page.waitForSelector('.rw-head');
  ok('editing browser storage changes nothing', await xp() < 2000, `XP ${await xp()}`);

  // ---------- staying and leaving ----------
  await page.goto(`${BASE}/missions`);
  await page.waitForSelector('.tracks');
  ok('categories start closed, so nothing is stacked', await page.locator('.tcard.open').count() === 0 && await page.locator('.node').count() === 0);
  ok('each category shows what it holds', await page.locator('.tcard[data-track="SH"] .cycle-item').count() === 1);
  const firstChapter = await page.locator('.tcard[data-track="NET"] .cycle-item').innerText();
  await page.waitForFunction((text) => document.querySelector('.tcard[data-track="NET"] .cycle-item').textContent !== text, firstChapter, { timeout: 8000 });
  ok('the chapters cycle by themselves', true);
  await shot('missions');
  await openCategory('SH');
  ok('opening a category shows its chapters', await page.locator('.tcard[data-track="SH"] .chapter').count() > 3);
  ok('progress survives a reload', await page.locator('.node[data-id="sh-01"].clear').count() === 1);
  const closedChapter = page.locator('.tcard[data-track="SH"] .chapter:not(.open) .chapter-head').first();
  const before2 = await page.locator('.node').count();
  await closedChapter.click();
  ok('a chapter opens as a dropdown', await page.locator('.node').count() > before2);
  await shot('missions-open');
  await openCategory('BX');
  ok('Beyond shows as locked', await page.locator('.node[data-id="bx-01"].locked').count() === 1);
  ok('opening one category closes the other', await page.locator('.tcard.open').count() === 1);
  ok('NetLab shows what opens it', await page.locator('.tcard[data-track="LAB"]').count() === 1);

  // ---------- NetLab: a real lab, through the real grader ----------
  const clearFor = (...codes) => manage('shell', '-c', `from apps.content.models import Mission; from apps.game.models import Player; from apps.missions.models import MissionProgress; from apps.game import services; from apps.game.models import TimeLedger; p = Player.objects.get(user__username='${USER}'); [MissionProgress.objects.get_or_create(player=p, mission=Mission.objects.get(code=c), season=p.season, defaults={'state': 'cleared'}) for c in ${JSON.stringify(codes)}]; services.add_time(p, 600, TimeLedger.Reason.STREAK)`);
  const labLocked = await call('/missions/lab-01/');
  ok('a lab stays shut until the mission it needs is cleared', labLocked.status === 403 || (await call('/tracks/')).data.tracks.find((t) => t.code === 'LAB').missions[0].state !== 'locked');
  clearFor('net-05');
  await page.goto(`${BASE}/missions/lab-01/play`);
  await page.waitForSelector('#openSession, .lab-map');
  if (await page.locator('#openSession').count()) await page.click('#openSession');
  await page.waitForSelector('.lab-map');
  await shot('netlab');
  ok('the lab draws its devices', await page.locator('.lab-device').count() === 2);
  const labPlay = seen.filter((r) => /missions\/lab-01\/play/.test(r.url)).map((r) => r.text).join('');
  ok('the browser gets what the goals say, and never how they are tested', labPlay.includes('PC-1 can ping PC-2') && !labPlay.includes('"expect"') && !labPlay.includes('"reach"'));
  await page.click('#labCheck');
  await page.waitForSelector('.lab-goals .bad');
  ok('checking too early says why, and costs nothing', /can't (reach|find)/.test(await page.locator('.lab-goals').innerText()));
  const faked = await call('/missions/lab-01/submit/', 'POST', { state: { devices: {} }, passed: true, result: 'pass', goals: [{ label: 'x', ok: true }] });
  ok('a client saying it passed changes nothing', faked.data.result === 'fail');
  const lieAboutOutput = await call('/missions/lab-01/submit/', 'POST', { state: { devices: { 'PC-1': { running: 'ip addr add 10.40.1.1/24 dev eth0', startup: '' }, 'PC-2': { running: 'ip addr add 10.40.1.2/24 dev eth0', startup: '' } } } });
  ok('real configs with no cable still fail, because the grader runs them', lieAboutOutput.data.result === 'fail');
  // A cable, dragged by hand from one port to another.
  const socket = async (key) => {
    const b = await page.locator(`.lab-socket[data-port="${key}"]`).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const [plugA, plugB] = [await socket('PC-1|eth0'), await socket('PC-2|eth0')];
  await page.mouse.move(plugA.x, plugA.y);
  await page.mouse.down();
  await page.mouse.move((plugA.x + plugB.x) / 2, plugA.y + 40, { steps: 5 });
  ok('picking up a port gives you a cable in your hand', await page.locator('#labWire').count() === 1);
  await page.mouse.move(plugB.x, plugB.y, { steps: 5 });
  ok('the far port lights up as you reach it', await page.locator('.lab-socket.target').count() === 1 && await page.locator('#labWire.ready').count() === 1);
  await page.mouse.up();
  ok('letting go plugs it in, and the link is amber at first', await page.locator('.lab-cable').count() === 1 && await page.locator('.lab-cable.negotiating').count() === 1);
  await page.waitForSelector('.lab-cable.up');
  ok('then the link comes up green', await page.locator('.lab-socket.up').count() === 2);
  await page.mouse.move(plugB.x, plugB.y);
  await page.mouse.down();
  await page.mouse.move(plugB.x, plugB.y - 90, { steps: 4 });
  await page.mouse.up();
  ok('pulling a cable out unplugs it', await page.locator('.lab-cable').count() === 0);
  await page.mouse.move(plugA.x, plugA.y);
  await page.mouse.down();
  await page.mouse.move(plugB.x, plugB.y - 50, { steps: 5 });
  await page.mouse.up();
  ok('letting go on a device takes its free port', await page.locator('.lab-cable').count() === 1);
  await page.waitForSelector('.lab-cable.up');
  await page.locator('.lab-device[data-device="PC-1"]').click();
  await typeCmd('ip addr add 10.40.1.1/24 dev eth0');
  await typeCmd('ping 10.40.1.2');
  await page.waitForSelector('#labTrace.bad');
  ok('a failed ping says what went wrong', (await page.locator('.term-out').innerText()).includes('Why:'));
  await page.waitForTimeout(1500); // the lab saves itself shortly after a change
  await page.reload();
  await page.waitForSelector('.lab-map');
  ok('the lab is still as you left it after a reload', await page.locator('.lab-cable.up').count() === 1);
  await page.locator('.lab-device[data-device="PC-2"]').click();
  await typeCmd('ip addr add 10.40.1.2/24 dev eth0');
  await typeCmd('ping 10.40.1.1');
  await page.waitForSelector('#labTrace.ok');
  ok('the ping gets there and back', (await page.locator('#labTrace').innerText()).includes('there and back'));
  await page.click('#stepReplay');
  const firstStep = await page.locator('#labStep').innerText();
  await page.click('#stepNext');
  ok('a packet can be stepped through one decision at a time', /Step \d+ of \d+/.test(firstStep) && (await page.locator('#labStep').innerText()) !== firstStep);
  await page.click('#labCheck');
  await page.waitForSelector('.lab-map.won');
  ok('clearing a lab lights up the network, with the goals full', await page.locator('.lab-surge').count() === 1 && (await page.locator('#labProgress').innerText()).includes('2 of 2'));
  await shot('netlab-won');
  await page.waitForSelector('.over');
  ok('the real configs solve it, and the debrief shows', (await page.locator('.over').innerText()).toLowerCase().includes('two pcs'));
  await page.click('text=Start the questions');
  await page.waitForSelector('.rw-head');
  const lab1 = byId('lab-01');
  for (let i = 0; i < 5; i++) await answerTask(lab1);
  await page.waitForSelector('.tracks');
  ok('finishing the questions clears the lab', (await call('/tracks/')).data.tracks.find((t) => t.code === 'LAB').missions[0].state === 'cleared');
  const nextLab = (await call('/tracks/')).data.tracks.find((t) => t.code === 'LAB').missions[1];
  ok('the next lab stays shut, and says which mission opens it', nextLab.state === 'locked' && nextLab.locked_because.includes('NET-31'));
  await openCategory('LAB');
  await page.waitForSelector('.tcard[data-track="LAB"] .chapter');
  await page.locator('.tcard[data-track="LAB"] .chapter-head, .tcard[data-track="LAB"] .chapter > button').first().click().catch(() => {});
  clearFor('net-31');
  ok('clearing that mission opens it', (await call('/tracks/')).data.tracks.find((t) => t.code === 'LAB').missions[1].state === 'open');
  await page.goto(`${BASE}/missions/lab-02/play`);
  await page.waitForSelector('.lab-map');
  await page.locator('.lab-device[data-device="SW1"]').click();
  await page.waitForSelector('.lab-tabs .on');
  ok('a device console opens from the map', (await page.locator('.lab-tabs .on').innerText()) === 'SW1');
  await typeCmd('en');
  await typeCmd('show mac ?');
  ok('the console answers ? with what fits next', (await page.locator('.term-out').innerText()).includes('address-table'));
  await page.fill('#cmd', 'conf');
  await page.press('#cmd', 'Tab');
  ok('Tab finishes a word', (await page.inputValue('#cmd')) === 'configure ');
  await page.fill('#cmd', '');

  // ---------- replaying is free ----------
  const xpBeforeReplay = (await call('/player/')).data.xp;
  await page.goto(`${BASE}/missions/lab-01/play`);
  await page.waitForSelector('.lab-map');
  // Any running session has gone back to the bank by now, so this is everything the player has.
  const bankBefore = (await call('/player/')).data.bank_seconds;
  ok('replaying a cleared lab needs no session', await page.locator('#openSession').count() === 0 && (await call('/player/')).data.session === null);
  ok('the screen says the replay is free', (await page.locator('.revisit-note').innerText()).includes('uses no play time'));
  await page.click('#drillOne');
  await page.waitForSelector('#drillStatus');
  await page.click('#labCheck');
  await page.waitForSelector('.lab-goals .bad');
  ok('a fault drill really breaks the finished lab', (await page.locator('#drillStatus').innerText()).includes('broken'));
  ok('what broke stays hidden until you ask', await page.locator('#drillFaults').count() === 0);
  await page.click('#drillReveal');
  await page.waitForSelector('#drillFaults');
  ok('asking says what broke', (await page.locator('#drillFaults').innerText()).length > 5);
  const afterReplay = (await call('/player/')).data;
  ok('a replay and a drill cost nothing and add nothing', afterReplay.bank_seconds === bankBefore && afterReplay.xp === xpBeforeReplay, `${bankBefore} to ${afterReplay.bank_seconds}`);

  // ---------- the sandbox ----------
  clearFor(...ALL_MISSIONS.filter((m) => m.track === 'LAB').slice(0, 5).map((m) => m.id));
  await page.goto(`${BASE}/sandbox`);
  await page.waitForSelector('.sandbox-palette');
  ok('the sandbox opens with no session, and costs nothing', (await call('/player/')).data.session === null);
  await page.click('#add-pc');
  await page.click('#add-pc');
  await page.waitForSelector('.lab-device[data-device="PC-2"]');
  await page.selectOption('#cableA', 'PC-1|eth0');
  await page.selectOption('#cableB', 'PC-2|eth0');
  await page.click('#cableConnect');
  await page.locator('.lab-device[data-device="PC-1"]').click();
  await typeCmd('ip addr add 10.9.9.1/24 dev eth0');
  await page.locator('.lab-device[data-device="PC-2"]').click();
  await typeCmd('ip addr add 10.9.9.2/24 dev eth0');
  await page.click('#testPings');
  await page.waitForSelector('#pingResults');
  ok('a network you built yourself works', await page.locator('#pingResults .ok').count() === 2);
  const box = await page.locator('.lab-device[data-device="PC-2"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 + 50, { steps: 4 });
  await page.mouse.up();
  const moved = await page.locator('.lab-device[data-device="PC-2"]').boundingBox();
  ok('devices can be dragged around', Math.abs(moved.x - box.x) > 20);
  await page.click('#breakIt');
  await page.waitForSelector('#showBroken');
  await page.click('#testPings');
  await page.waitForSelector('#pingResults .bad');
  ok('the sandbox can break itself for practice', true);
  await page.click('#showBroken');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector('.lab-device[data-device="PC-2"]');
  ok('your sandbox is still there after a reload', await page.locator('.lab-device').count() === 2);
  await shot('sandbox');

  // ---------- Wi-Fi and IPv6, with their real solutions through the real grader ----------
  const playSolution = async (id) => {
    await page.goto(`${BASE}/missions/${id}/play`);
    await page.waitForSelector('#openSession, .lab-map');
    if (await page.locator('#openSession').count()) await page.click('#openSession');
    await page.waitForSelector('.lab-map');
    for (const line of byId(id).sol.split('\n')) {
      const dev = /^\[(\S+)\]$/.exec(line);
      const cable = /^\[cable\] (\S+) (\S+) (\S+) (\S+)$/.exec(line);
      if (cable) {
        await page.selectOption('#cableA', `${cable[1]}|${cable[2]}`);
        await page.selectOption('#cableB', `${cable[3]}|${cable[4]}`);
        await page.click('#cableConnect');
      } else if (dev) await page.locator(`.lab-device[data-device="${dev[1]}"]`).click();
      else if (line) await typeCmd(line);
    }
    await page.click('#labCheck');
    await page.waitForSelector('.over');
  };
  const labOrder = ALL_MISSIONS.filter((m) => m.track === 'LAB').map((m) => m.id);
  clearFor('net-47', 'net-48', 'net-49', ...labOrder.slice(0, labOrder.indexOf('lab-35')));
  await playSolution('lab-35');
  ok('a Wi-Fi lab solves through the browser and the grader', (await page.locator('.over').innerText()).toLowerCase().includes('first access point'));
  ok('a laptop on Wi-Fi shows on the map', await page.locator('.lab-cable.wifi').count() === 1);
  await shot('netlab-wifi');

  // ---------- a new lab opening, for real ----------
  await page.click('text=Start the questions');
  await page.waitForSelector('.rw-head');
  const lab35 = byId('lab-35');
  for (let i = 0; i < 5; i++) await answerTask(lab35);
  // This clear can also earn a level. That moment comes first, and the lab waits behind it.
  await page.waitForSelector('#revealTitle, .over button:has-text("Continue")');
  const levelFirst = await page.locator('#revealTitle').count() === 0;
  if (levelFirst) await page.locator('.over button:has-text("Continue")').click();
  await page.waitForSelector('#revealTitle');
  ok('clearing a lab reveals the next one, drawing itself', (await page.locator('#revealTitle').innerText()).toLowerCase().includes('guests on their own network') && await page.locator('.lab-reveal-device').count() === byId('lab-36').lab.devices.length);
  ok('the reveal shows what was just earned', (await page.locator('.lab-reveal-meta').innerText()).includes('You just earned'));
  const revealText = seen.filter((r) => /lab-35\/rewind\/answer/.test(r.url)).map((r) => r.text).join('');
  ok('the reveal gives no starting config away', revealText.includes('"preview"') && !revealText.includes('authentication wpa2'));
  // Let it finish drawing before the picture, then check it at phone width too.
  await page.waitForTimeout(3500);
  ok('every cable in the reveal has finished drawing', await page.locator('.lab-reveal-map path').evaluateAll((els) => els.length > 0 && els.every((el) => parseFloat(getComputedStyle(el).strokeDashoffset) === 0)));
  await shot('netlab-reveal');
  const desktopSize = page.viewportSize();
  await page.setViewportSize({ width: 400, height: 800 });
  const fits = await page.evaluate(() => {
    const box = document.querySelector('.lab-reveal').getBoundingClientRect();
    const later = document.querySelector('#revealLater').getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && later.bottom <= innerHeight && later.top >= 0;
  });
  ok('the reveal fits a phone, buttons included', fits);
  await shot('netlab-reveal-phone');
  await page.setViewportSize(desktopSize);
  await page.click('#revealLater');
  await page.waitForSelector('#labProgressMap');
  ok('the lab map shows the new one as next, with the cleared ones lit', await page.locator('.lm-node.open[data-id="lab-36"]').count() + await page.locator('.lm-node.fresh[data-id="lab-36"]').count() >= 1 && await page.locator('.lm-node.clear').count() > 20);
  const lockedNode = page.locator('.lm-node.locked').first();
  ok('a locked lab on the map says what it waits for', ((await lockedNode.getAttribute('title')) || '').length > 10);
  await shot('netlab-progress');
  await page.setViewportSize({ width: 400, height: 800 });
  ok('the lab map fits a phone', await page.evaluate(() => document.querySelector('#labProgressMap').scrollWidth <= document.querySelector('#labProgressMap').clientWidth && document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#labProgressMap').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot('netlab-progress-phone');
  await page.setViewportSize(desktopSize);
  clearFor(...labOrder.slice(0, labOrder.indexOf('lab-41')));
  await playSolution('lab-41');
  ok('an IPv6 lab solves through the browser and the grader', (await page.locator('.over').innerText()).toLowerCase().includes('turn on ipv6'));

  await page.goto(`${BASE}/missions`);
  await page.waitForSelector('.tracks');
  ok('there is no way to reset a season', (await call('/seasons/new/', 'POST')).status === 404);
  setPeak(USER, 213);
  await page.reload();
  await page.waitForSelector('.tracks');
  await openCategory('BX');
  ok('reaching Archmage opens Beyond', await page.locator('.node[data-id="bx-01"].open').count() === 1);

  // ---------- revisiting ----------
  await page.goto(`${BASE}/missions/sh-01`);
  await page.waitForSelector('#revisit');
  const xpBefore = await xp();
  await page.click('#revisit');
  await page.waitForSelector('#cmd');
  ok('a cleared mission can be played again', await page.locator('.revisit-note').count() === 1);
  ok('it needs no session, and any session is paused', (await page.locator('.chip-time').innerText()).toLowerCase().includes('play time'));
  await typeCmd('submit /nowhere');
  await page.waitForFunction(() => /Not that one/.test(document.querySelector('.term-out').textContent));
  await typeCmd('submit /home/ops');
  await page.waitForFunction(() => /Right again/.test(document.querySelector('.term-out').textContent));
  ok('revisiting pays no XP and shows no debrief', await xp() === xpBefore && await page.locator('.over').count() === 0);

  // ---------- who you are ----------
  ok('your username is at the top', (await page.locator('#meName').innerText()) === USER);
  ok('you have a system avatar from the start', await page.locator('.me .avatar-art').count() === 1);
  await page.click('.me');
  await page.waitForSelector('.avatar-grid');
  await shot('profile');
  ok('there are sixteen to choose from', await page.locator('.avatar-pick').count() === 16);
  await page.locator('.avatar-pick').nth(5).click();
  await page.waitForSelector('.avatar-pick.on');
  ok('choosing one marks it', await page.locator('.avatar-pick').nth(5).getAttribute('aria-checked') === 'true');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGOMsjnBgA0wYRUdtBIAFV0BbnbDS4EAAAAASUVORK5CYII=', 'base64');
  await page.setInputFiles('#avatarFile', { name: 'me.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.me img');
  ok('uploading a picture shows it at the top', true);
  const loaded = await page.evaluate(async () => {
    const src = document.querySelector('.me img').getAttribute('src');
    const r = await fetch(src);
    return { type: r.headers.get('content-type'), sniff: r.headers.get('x-content-type-options') };
  });
  ok('the picture is served as a safe image', loaded.type === 'image/webp' && loaded.sniff === 'nosniff');
  await page.setInputFiles('#avatarFile', { name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await page.waitForFunction(() => /isn't a PNG/.test(document.querySelector('[role=status]').textContent));
  ok('a script disguised as a picture is refused', true);
  await page.reload();
  await page.waitForSelector('.me img');
  ok('the picture is still there after a reload', true);
  await page.goto(`${BASE}/rewards`);
  await page.waitForSelector('.badge');
  ok('rewards come from the server', (await page.locator('.badge').count()) === 31);

  await page.goto(`${BASE}/system`);
  await page.waitForSelector('#logoutBtn');
  await shot('system');
  const oldCookie = (await ctx.cookies()).find((c) => c.name === 'ua_refresh').value;
  await page.click('#logoutBtn');
  await page.waitForURL('**/login');
  ok('logging out returns to the login page', true);
  await page.goto(`${BASE}/missions`);
  await page.waitForURL('**/login');
  ok('after logout the game is out of reach', await page.locator('.node').count() === 0);
  const replay = await browser.newContext();
  await replay.addCookies([{ name: 'ua_refresh', value: oldCookie, domain: '127.0.0.1', path: '/api/v1/auth/' }]);
  const r = await replay.request.post(`${BASE}/api/v1/auth/refresh/`);
  ok('a stolen token from before logout is dead', r.status() === 401);
  await replay.close();

  await page.fill('#username', USER);
  await page.fill('#password', 'wrong password here');
  await page.click('#loginBtn');
  await page.waitForSelector('[role=alert]');
  ok('a wrong password is refused', (await page.locator('[role=alert]').innerText()).includes('Wrong username or password'));
  await page.fill('#username', USER.toUpperCase());
  await page.fill('#password', PASSWORD);
  await page.click('#loginBtn');
  await page.waitForSelector('.deck');
  ok('logging back in works, and picks up where you left', await xp() > 37);

  const calm = await browser.newContext({ viewport: { width: 1400, height: 880 }, reducedMotion: 'reduce' });
  const still = await calm.newPage();
  await still.goto(`${BASE}/login`);
  await still.waitForSelector('#loginBtn');
  ok('reduced motion stops the room breathing', await still.evaluate(() => getComputedStyle(document.querySelector('.scene-glow')).animationName) === 'none');
  await calm.close();

  ok('the page made no outside requests', external.length === 0, external.slice(0, 2).join(' '));
  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('STOPPED:', e.message.split('\n').slice(0, 4).join(' '));
  if (shots) await page.screenshot({ path: join(shots, 'stopped.png') }).catch(() => {});
  failures.push('the run stopped early');
}

await browser.close();
stopServers();
console.log(`e2e failures: ${failures.length}`);
failures.forEach((f) => console.log(' -', f));
process.exit(failures.length ? 1 : 0);
