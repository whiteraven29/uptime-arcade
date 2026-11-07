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
const answerTask = async (m) => {
  const q = await page.locator('.screen .title').first().innerText();
  const t = m.rewind.find((x) => x.q === q);
  if (t.type === 'mc') await page.locator('.opt', { hasText: t.answer }).first().click();
  else if (t.type === 'text') {
    await page.fill('#rwInput', t.answer[0]);
    await page.press('#rwInput', 'Enter');
  } else for (const a of t.answer) await page.locator('.tok:not(.good)', { hasText: a }).first().click();
  await page.waitForSelector('#rwNext');
  await page.click('#rwNext');
  await page.waitForTimeout(60);
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
  await page.goto(`${BASE}/missions/sh-01/play`);
  await page.waitForSelector('.lock');
  ok('missions stay locked while a block runs', (await page.locator('.lock').innerText()).includes('Locked while your focus block runs'));
  endBlockNow();
  await page.goto(`${BASE}/focus`);
  await page.waitForSelector('#claimYes');
  await page.click('#claimYes');
  await page.waitForSelector('#startBlock');
  await page.waitForFunction(() => /15:00/.test(document.querySelector('.chip-time').textContent));
  ok('claiming pays 8:00 plus the 2:00 goal bonus', (await page.locator('.chip-time').innerText()).includes('15:00'));
  ok('the block pays XP, with the first day of its streak', await xp() === 37, `XP ${await xp()}`);
  ok('a badge arrives with its medal', await page.locator('.toast .emblem').count() > 0 || (await page.locator('.toast').innerText()).length > 0, await page.locator('.toast').innerText());

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
  ok('the next mission unlocks', await page.locator('.node[data-id="sh-02"].open').count() === 1);

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
    await page.waitForSelector('#rwNext');
  };
  for (let i = 0; i < 4; i++) {
    await wrongAnswer();
    const t = await page.locator('.screen').innerText();
    ok(`miss ${i + 1} shows no answer and no hint`, !t.includes('The answer is') && !t.includes('Hint:'));
    await page.click('#rwNext');
    await page.waitForTimeout(40);
  }
  await wrongAnswer();
  await page.click('#rwNext');
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
  ok('settings cannot set XP or level', tampered.status === 200 && after.data.xp < 2000 && after.data.level.cleared < 150, `XP ${after.data.xp}`);
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
  ok('progress survives a reload', await page.locator('.node[data-id="sh-01"].clear').count() === 1);
  ok('Beyond shows as locked', await page.locator('.node[data-id="bx-01"].locked').count() === 1);
  ok('difficulty legend shows all five', (await page.locator('.diff-legend').innerText()).includes('Brainfuck'));
  await shot('missions');
  setPeak(USER, 150);
  await page.reload();
  await page.waitForSelector('.tracks');
  ok('reaching Archmage opens Beyond', await page.locator('.node[data-id="bx-01"].open').count() === 1);
  await page.goto(`${BASE}/rewards`);
  await page.waitForSelector('.badge');
  ok('rewards come from the server', (await page.locator('.badge').count()) === 30);

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
