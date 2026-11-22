import { useEffect, useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { TimerRing } from '../../ui/TimerRing.jsx';
import { BANK_CAP, S, abandonBlock, claimBlock, confirmCheckIn, earns, logDrift, mmss, outlook, refreshPlan, setLen, startBlock, ui } from '../../api/game.js';
import { shortDay, weekdayName } from '../profile/history.js';
import { PlanForm } from './PlanForm.jsx';
import { PlanPanel } from './PlanPanel.jsx';

const PLAN_REFRESH = 60000; // a study time can open or close while you look at this screen
const NOTE_MIN = 5;

/** What this block would earn, as the server worked it out. */
function outlookText() {
  const { today } = ui.plan;
  if (outlook(S.len).kind === 'plan') return `On plan. ${S.len} min earns ${mmss(earns(S.len))} of rest, to play here instead of on your phone. Finishing your goal adds XP.`;
  const day = today.next_window?.date === today.date ? 'today' : today.next_window && `${weekdayName(today.next_window.date)} ${shortDay(today.next_window.date)}`;
  const next = today.next_window ? ` Next study time: ${day} at ${today.next_window.start}.` : '';
  const why = today.in_window ? 'this study time\'s study is already done' : 'it\'s outside your study times';
  return `This block goes on your map but earns no play time, because ${why}.${next}`;
}

function Idle() {
  const [goal, setGoal] = useState('');
  const [phone, setPhone] = useState(false);
  const { limits, today } = ui.plan;
  const planned = today.block_minutes;
  const fits = Number.isInteger(S.len) && S.len >= limits.block_min_minutes && S.len <= limits.block_max_minutes;
  const ready = goal.trim() && phone && fits;
  const kind = outlook(S.len).kind;
  const free = kind === 'free';
  return (
    <HudPanel className="focus-card stack" label="Start a focus block">
      <h1 className="title metal">Real work earns play time</h1>
      <div>
        <label className="small" htmlFor="goal">What will you finish in this block?</label>
        <input type="text" id="goal" maxLength={100} placeholder="Fix the login endpoint bug" autoComplete="off" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>
      <div className="row plan-length">
        <label className="small" htmlFor="blockMinutes">Minutes</label>
        <input id="blockMinutes" type="number" min={limits.block_min_minutes} max={limits.block_max_minutes} value={S.len} onChange={(e) => setLen(Number(e.target.value))} />
        {planned && planned !== S.len && <button className="btn" type="button" id="usePlanLength" onClick={() => setLen(planned)}>Use my plan's {planned}</button>}
      </div>
      <label className="check"><input type="checkbox" id="phone" checked={phone} onChange={(e) => setPhone(e.target.checked)} /><span>My phone is out of reach</span></label>
      <button
        className="btn go"
        type="button"
        id="startBlock"
        disabled={!ready}
        onClick={() => startBlock(goal)}
      >
        {free ? 'Start an extra block' : 'Start block'}
      </button>
      <div className="small" id="outlook" data-kind={kind}>{fits ? outlookText() : `A block is ${limits.block_min_minutes} to ${limits.block_max_minutes} minutes.`}</div>
      <div className="small">Banked {mmss(S.bank)} of {mmss(BANK_CAP)}.</div>
    </HudPanel>
  );
}

function CheckIn({ block }) {
  // Whoever is in another window sees it in the tab's title, as well as hearing the chime.
  useEffect(() => {
    if (block.presence !== 'due') return undefined;
    const title = document.title;
    document.title = 'Still there? Tap to keep your block';
    return () => { document.title = title; };
  }, [block.presence]);

  if (block.presence === 'due') {
    return (
      <div className="check-in stack" role="alert">
        <b>Still there?</b>
        <span className="small">Answer within {mmss((block.checkEndsAt - Date.now()) / 1000)} or this block earns nothing.</span>
        <button className="btn go" type="button" id="presenceYes" onClick={confirmCheckIn}>I'm here</button>
      </div>
    );
  }
  if (block.presence === 'missed') {
    return (
      <div className="check-in stack" role="status" id="checkMissed">
        <b>You missed the check-in</b>
        <span className="small">This block won't earn anything or go on your map. You can end it and start another.</span>
        <div><button className="btn" type="button" id="endMissed" onClick={abandonBlock}>End it</button></div>
      </div>
    );
  }
  return null;
}

function Running() {
  const [asking, setAsking] = useState(false);
  const f = S.focus;
  const left = (f.endsAt - Date.now()) / 1000;
  const note = f.presence === 'waiting' ? 'Keep this tab open. It will ask once if you\'re still there.' : 'Missions stay locked until this block ends.';
  return (
    <div className="running">
      <TimerRing fraction={1 - left / (f.len * 60)}>
        <div className="clock" id="clock">{mmss(left)}</div>
        <div className="wrap-any">{f.goal}</div>
        <div className="small">{f.drifts ? `Logged ${f.drifts}. Back to it.` : note}</div>
        {f.kind === 'free' ? <div className="small">An extra block: it goes on your map but earns no play time.</div> : f.earns > 0 && <div className="small">Then {mmss(f.earns)} of rest.</div>}
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button className="btn" type="button" onClick={logDrift}>I drifted</button>
          <button className="btn" type="button" onClick={() => setAsking(true)}>End early</button>
        </div>
        {asking && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
            <span className="small">You earn nothing.</span>
            <button className="btn" type="button" onClick={abandonBlock}>End it</button>
            <button className="btn" type="button" onClick={() => setAsking(false)}>Keep going</button>
          </div>
        )}
      </TimerRing>
      <CheckIn block={f} />
    </div>
  );
}

function Claim() {
  const [note, setNote] = useState('');
  const c = S.claim;
  if (c.presence !== 'ok') {
    return (
      <HudPanel className="focus-card stack" label="Block complete">
        <h1 className="title metal">No check-in on this one</h1>
        <div className="obj wrap-any">{c.goal}</div>
        <p className="small" style={{ margin: 0 }}>You didn't answer when it asked, so this block earned nothing. It won't go on your map or your streak.</p>
        <div><button className="btn go" type="button" id="claimVoid" onClick={() => claimBlock(false)}>Understood</button></div>
      </HudPanel>
    );
  }
  const ready = note.trim().length >= NOTE_MIN;
  return (
    <HudPanel className="focus-card stack" label="Block complete">
      <h1 className="title metal">Did you finish it?</h1>
      <div className="obj wrap-any">{c.goal}</div>
      <div>
        <label className="small" htmlFor="claimNote">In a line, what did you actually do?</label>
        <input type="text" id="claimNote" maxLength={140} autoComplete="off" placeholder="Found the redirect bug and fixed it" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn go" type="button" id="claimYes" disabled={!ready} onClick={() => claimBlock(true, note)}>Yes, finished</button>
        <button className="btn" type="button" id="claimNo" disabled={!ready} onClick={() => claimBlock(false, note)}>Not yet</button>
      </div>
      {c.kind === 'free' && <p className="small" style={{ margin: 0 }}>An extra block: it goes on your map but earns no play time.</p>}
      <p className="small" style={{ margin: 0 }}>Claim it within {mmss((c.claimBy - Date.now()) / 1000)}, or it earns nothing.</p>
    </HudPanel>
  );
}

function Planned() {
  const [editing, setEditing] = useState(false);
  if (editing) return <PlanForm onDone={() => setEditing(false)} />;
  return (
    <div className="focus-plan">
      <Idle />
      <PlanPanel onChange={() => setEditing(true)} />
    </div>
  );
}

export function FocusScreen() {
  const idle = !S.claim && !S.focus;
  useEffect(() => {
    if (!idle) return undefined;
    refreshPlan().catch(() => {});
    const id = setInterval(() => refreshPlan().catch(() => {}), PLAN_REFRESH);
    return () => clearInterval(id);
  }, [idle]);

  let body = <Planned />;
  if (S.claim) body = <Claim />;
  else if (S.focus) body = <Running />;
  else if (!ui.plan?.plan) body = <PlanForm />;
  return (
    <section className="screen" aria-label="Focus">
      <div className="focus">{body}</div>
    </section>
  );
}
