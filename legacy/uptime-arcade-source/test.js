const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
const vendor = '/home/claude/uptime/vendor/package/dist/';
const target = process.argv[2] || 'file:///home/claude/uptime/uptime-arcade.html';
const offline = target.includes('offline');
const GOENV = { ...process.env, GOCACHE: '/tmp/claude-0/gocache', GO111MODULE: 'off' };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 880 } });
  const p = await ctx.newPage();
  const errs = [], ext = [], res = [];
  const fail = (id, why) => res.push(id + ': ' + String(why).slice(0, 300));
  p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { if (/^https?:/.test(r.url())) ext.push(r.url()); });
  if (!offline) await p.route('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendor + r.request().url().split('/').pop()) }));
  await p.route('https://fonts.*/**', r => r.abort());
  await p.goto(target);
  await p.waitForTimeout(200);
  await p.screenshot({ path: '/tmp/claude-0/deck.png' });

  const stat = await p.evaluate(() => {
    const o = { n: TICKETS.length, tracks: {}, bad: [] };
    for (const [k] of TRACKS) { o.tracks[k] = TK[k].length; const ch = CHAPTERS[k]; if (ch[0][1] !== 0) o.bad.push('chapter0 ' + k); ch.forEach(c => { if (c[1] >= TK[k].length) o.bad.push('chapter range ' + k) }) }
    for (const t of TICKETS) {
      if (!t.learn || !t.learn[0] || !t.learn[1]) o.bad.push('no lesson ' + t.id);
      const ts = rewindTasks(t);
      if (ts.length !== 5) o.bad.push('tasks ' + t.id);
      ts.forEach((x, i) => {
        if (x.type === 'mc') { if (!x.options.includes(x.answer)) o.bad.push(`mc answer ${t.id} ${i}`); if (x.options.length < 3 || new Set(x.options).size !== x.options.length) o.bad.push(`mc opts ${t.id} ${i} ${x.options.length}`) }
        if (x.type === 'fill' && (!x.show.includes('____') || !x.answer[0])) o.bad.push(`fill ${t.id}`);
        if (x.type === 'order' && (x.items.length < 3 || x.scrambled.length !== x.items.length)) o.bad.push(`order ${t.id}`);
        if (x.type === 'memory' && !x.answer[0]) o.bad.push(`mem ${t.id}`);
      });
      if (t.answer && t.answer[0].length > 3 && t.answer[0] !== 'gateway' && t.track !== 'SH' && t.learn[1].includes(t.answer[0])) o.bad.push('lesson leaks ' + t.id);
    }
    return o;
  });
  console.log('content', JSON.stringify({ n: stat.n, tracks: stat.tracks })); stat.bad.forEach(x => fail('content', x));

  const locked = await p.evaluate(() => stateOf(TK.SH[1]));
  if (locked !== 'locked') fail('lock', 'SH 2 state ' + locked);

  await p.click('.nav [data-go=missions]');
  await p.waitForTimeout(60);
  await p.screenshot({ path: '/tmp/claude-0/missions.png' });
  await p.click('.node.open >> nth=0');
  await p.screenshot({ path: '/tmp/claude-0/brief.png' });
  await p.click('#launch');
  await p.click('#openSession');
  await p.evaluate(() => { S.sessionEndsAt = Date.now() + 36000e3; });
  const run = async c => { await p.fill('#cmd', c); await p.press('#cmd', 'Enter'); };
  await run('cat ~/inbox/-handover.txt');
  await p.screenshot({ path: '/tmp/claude-0/play.png' });
  const outText = () => p.evaluate(() => document.getElementById('out').textContent);

  const doRewind = async id => {
    await p.evaluate(i => startRewind(i), id);
    for (let g = 0; g < 8; g++) {
      const tk = await p.evaluate(() => { const st = S.rew[rwId]; if (!st || !st.q.length) return null; const t = rwTasks[st.q[0]]; return { type: t.type, answer: t.answer } });
      if (!tk) break;
      if (tk.type === 'mc') await p.evaluate(v => { [...document.querySelectorAll('#rewind .opt')].find(x => x.textContent === v).click() }, tk.answer);
      else if (tk.type === 'order') { for (const it of tk.answer) await p.evaluate(v => { [...document.querySelectorAll('#rewind .tok')].find(x => x.textContent === v).click() }, it); }
      else { await p.fill('#rwInput', tk.answer[0]); await p.press('#rwInput', 'Enter'); }
      await p.click('#rwNext');
    }
    if (!(await p.evaluate(i => !!S.rewDone[i], id))) fail(id, 'rewind not finished');
    await p.evaluate(() => { document.getElementById('levelup').hidden = true; });
  };

  const first = await p.evaluate(() => TK.SH[0].id);
  await p.evaluate(() => { S.done[TK.SH[0].id] = { xp: 1, note: '', bonus: 0, hints: 0 }; });
  await p.evaluate(i => startRewind(i), first);
  await p.waitForTimeout(40);
  await p.screenshot({ path: '/tmp/claude-0/rewind.png' });
  await p.evaluate(() => answerRewind('definitely wrong'));
  const rq = await p.evaluate(() => ({ q: S.rew[rwId].q, ok: S.rew[rwId].ok }));
  if (rq.ok !== 0 || rq.q[4] !== 0) fail('requeue', JSON.stringify(rq));
  await p.evaluate(() => { delete S.done[TK.SH[0].id]; delete S.rew[TK.SH[0].id]; go('missions'); });

  const tracks = await p.evaluate(() => TRACKS.map(t => t[0]));
  const maxLen = await p.evaluate(() => Math.max(...TRACKS.map(t => TK[t[0]].length)));
  const order = [];
  for (let i = 0; i < maxLen; i++) for (const k of tracks) { const id = await p.evaluate(([k, i]) => { const m = TK[k][i]; return m ? m.id : null }, [k, i]); if (id) order.push(id); }
  for (const id of order) {
    const t = await p.evaluate(i => { const m = byId(i); return { id: m.id, track: m.track, kind: m.kind, sol: m.sol, ans: m.answer, par: m.par, file: m.file, code: m.code, decl: m.decl, imports: m.imports, v: m.v, tests: m.tests, st: stateOf(m) } }, id);
    if (t.st !== 'open') fail(id, 'should be open but ' + t.st);
    await p.evaluate(i => { enter(byId(i)); go('play'); }, id);
    if (t.kind === 'py') {
      await p.waitForFunction(() => py.state === 'ready' || py.state === 'failed', null, { timeout: 15000 });
      await p.fill('#py', t.sol); await p.click('#pyRun');
      await p.waitForFunction(i => !!S.done[i] || !/Running/.test(document.getElementById('pyOut').textContent), id);
      await p.waitForTimeout(30);
      if (!(await p.evaluate(i => !!S.done[i], id))) fail(id, 'py: ' + await p.textContent('#pyOut'));
      const src = t.sol + '\n' + t.tests.map(x => `assert (${x[0]}) == (${x[1]}), ${JSON.stringify(x[0])}`).join('\n') + '\n';
      try { execSync('python3 -', { input: src, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { fail(id, 'real python: ' + e.stderr.toString().slice(-160)); }
    } else if (t.track === 'VI') {
      await run('vi ' + t.file); await p.locator('#vi').focus();
      for (const k of t.sol.match(/<CR>|<Esc>|[\s\S]/g)) await p.keyboard.press(k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k);
      const st = await p.evaluate(([i, f]) => ({ d: !!S.done[i], k: S.viKeys[f], c: fs.get(f).c }), [id, t.file]);
      if (!st.d) fail(id, 'vi not done ' + JSON.stringify(st).slice(0, 180)); else if (st.k > t.par) fail(id, `par ${t.par} took ${st.k}`);
    } else {
      if (t.track === 'GO') {
        const d = fs.mkdtempSync('/tmp/claude-0/go-'), f = path.join(d, 'main.go');
        fs.writeFileSync(f, `package main\nimport (\n"fmt"\n${t.imports || ''}\n)\n${t.decl || ''}\nfunc main() {\n${t.code}\n}\n`);
        let o = ''; try { o = execSync(`cd ${d} && go run main.go 2>&1`, { env: GOENV }).toString().trim(); } catch (e) { o = 'ERR ' + e.stdout; }
        if (o !== t.ans[0]) fail(id, `go printed [${o}] answer [${t.ans[0]}]`);
      }
      if (t.v) { const o = execSync(`python3 -c "import ipaddress;print(${t.v.replace(/"/g, '\\"')})"`).toString().trim(); if (!t.ans.includes(o)) fail(id, `python [${o}] vs [${t.ans}]`); }
      const before = (await outText()).length, cmds = t.sol.split('\n').filter(l => !l.startsWith('submit'));
      for (const c of cmds) await run(c);
      if (t.kind === 'answer') { const a = (await outText()).slice(before); if (cmds.length && !t.ans.some(x => a.includes(x))) fail(id, `output lacks ${t.ans}: ${a.slice(-160)}`); await run('submit ' + t.ans[0]); }
      if (!(await p.evaluate(i => !!S.done[i], id))) fail(id, 'not done: ' + (await outText()).slice(-200));
    }
    if (!(await p.isVisible('#debrief'))) fail(id, 'no debrief');
    await p.evaluate(() => { document.getElementById('debrief').hidden = true; });
    await doRewind(id);
  }
  console.log('MISSION PROBLEMS:', res.length); res.slice(0, 30).forEach(r => console.log(' -', r));
  const sum = await p.evaluate(() => ({ cleared: cleared(), level: level(), xp: S.xp, ended: S.ended, badges: Object.keys(S.badges).length, peak: S.peak }));
  console.log('after all', JSON.stringify(sum));
  if (sum.level !== 'Archmage' || !sum.ended) fail('ending', JSON.stringify(sum));
  if (sum.cleared < 100) { await b.close(); console.log('PROBLEMS', res.length); return; }
  await p.evaluate(() => showFinale()); await p.waitForTimeout(60);
  await p.screenshot({ path: '/tmp/claude-0/finale.png' });
  await p.evaluate(() => { document.getElementById('levelup').hidden = true; go('rewards'); });
  await p.waitForTimeout(40);
  await p.screenshot({ path: '/tmp/claude-0/rewards.png' });

  await p.evaluate(() => startOncall());
  const seen = {};
  for (let i = 0; i < 40; i++) {
    const t = await p.evaluate(() => S.oc ? ({ ...S.oc }) : null);
    if (!t) { await p.evaluate(() => startOncall()); i--; continue; }
    seen[t.track] = (seen[t.track] || 0) + 1;
    if (t.v) { const o = execSync(`python3 -c "import ipaddress;print(${t.v.replace(/"/g, '\\"')})"`).toString().trim(); if (o !== t.answer[0]) fail(t.id, `oc [${o}] vs [${t.answer}]`); }
    if (t.pyv) { const o = execSync('python3 -', { input: t.pyv }).toString().trim(); if (o !== t.answer[0]) fail(t.id, `oc py [${o}]`); }
    if (t.track === 'GO') { const d = fs.mkdtempSync('/tmp/claude-0/go-'); fs.writeFileSync(path.join(d, 'main.go'), `package main\nimport "fmt"\nfunc main() {\n${t.code}\n}\n`); const o = execSync(`cd ${d} && go run main.go`, { env: GOENV }).toString().trim(); if (o !== t.answer[0]) fail(t.id, `oc go [${o}]`); }
    if (t.track === 'SH') { const b4 = (await outText()).length; await run(t.sol); const a = (await outText()).slice(b4); if (!a.includes(t.answer[0])) fail(t.id, 'oc shell ' + a.slice(-120)); }
    await run('submit ' + t.answer[0]);
  }
  console.log('oncall', JSON.stringify(seen));

  const xp0 = await p.evaluate(() => { S.oc = null; return S.xp });
  await p.evaluate(() => go('system'));
  await p.click('#reset'); await p.click('#resetYes');
  const se = await p.evaluate(() => ({ s: S.season, xp: S.xp, c: cleared(), l: level(), st: stateOf(TK.GO[1]) }));
  console.log('season', JSON.stringify(se));
  if (se.s !== 2 || se.xp !== xp0 || se.c !== 0 || se.l !== 'Archmage' || se.st !== 'locked') fail('season', JSON.stringify(se));

  await p.evaluate(() => go('system'));
  const dl = p.waitForEvent('download'); await p.click('#exportSave'); const d = await dl; await d.saveAs('/tmp/claude-0/save.json');
  await p.evaluate(() => { S.xp = 1; });
  await p.setInputFiles('#importFile', '/tmp/claude-0/save.json'); await p.waitForTimeout(150);
  if (await p.evaluate(() => S.xp) !== xp0) fail('restore', 'xp');

  const c2 = await b.newContext({ viewport: { width: 1400, height: 880 } });
  const q = await c2.newPage();
  q.on('pageerror', e => errs.push('fresh: ' + e.message));
  await q.route('https://fonts.*/**', r => r.abort()); await q.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await q.clock.install({ time: new Date('2026-11-06T08:00:00') });
  await q.goto(target);
  const block = async g => { await q.evaluate(() => go('focus')); await q.fill('#goal', g); await q.check('#phone'); await q.click('#startBlock'); await q.clock.runFor(25 * 60 * 1000 + 2000); await q.click('#claimYes'); };
  await q.evaluate(() => go('focus'));
  await q.fill('#goal', 'Ship it'); await q.check('#phone'); await q.click('#startBlock');
  await q.clock.runFor(9 * 60 * 1000);
  await q.screenshot({ path: '/tmp/claude-0/focus.png' });
  await q.clock.runFor(16 * 60 * 1000 + 2000); await q.click('#claimYes');
  const s1 = await q.evaluate(() => ({ bank: S.bank, st: S.streak, min: S.focusMin }));
  if (s1.bank !== 900 || s1.st !== 1 || s1.min !== 25) fail('earn', JSON.stringify(s1));
  const dayRes = [];
  for (let i = 0; i < 6; i++) { await q.clock.fastForward(864e5); await block('Day ' + i); dayRes.push(await q.evaluate(() => [S.streak, S.shields, S.bank])); }
  console.log('streak days', JSON.stringify(dayRes));
  const s7 = await q.evaluate(() => ({ st: S.streak, sh: S.shields, cl: Object.keys(S.claimed), best: S.bestStreak }));
  if (s7.st !== 7 || s7.sh !== 1 || s7.cl.join() !== '3,7') fail('streak', JSON.stringify(s7));
  await q.clock.fastForward(2*864e5); await block('After a missed day');
  const s9 = await q.evaluate(() => ({ st: S.streak, sh: S.shields }));
  if (s9.st !== 8 || s9.sh !== 0) fail('shield', JSON.stringify(s9));
  await q.clock.fastForward(3*864e5); await block('Broken');
  const s10 = await q.evaluate(() => S.streak); if (s10 !== 1) fail('break', s10);
  await q.evaluate(() => { enter(TK.SH[0]); go('play'); });
  if (await q.isVisible('#promptForm')) fail('play lock', 'prompt with no session');
  await q.setViewportSize({ width: 400, height: 860 }); await q.evaluate(() => go('deck')); await q.waitForTimeout(60);
  if (await q.evaluate(() => document.documentElement.scrollWidth > innerWidth)) fail('phone', 'scroll');
  await q.screenshot({ path: '/tmp/claude-0/phone.png' });
  await b.close();
  console.log('external:', [...new Set(ext)].length, 'page errors:', errs.slice(0, 5));
  console.log('PROBLEMS:', res.length); res.slice(0, 40).forEach(r => console.log(' -', r));
})().catch(e => { console.error(e); process.exit(1) });
