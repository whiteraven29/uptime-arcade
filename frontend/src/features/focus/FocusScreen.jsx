import { useState } from 'react';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { TimerRing } from '../../ui/TimerRing.jsx';
import { BANK_CAP, EARN, GOAL_BONUS, S, abandonBlock, claimBlock, logDrift, mmss, setLen, startBlock } from '../../api/localGame.js';

function Idle() {
  const [goal, setGoal] = useState('');
  const [phone, setPhone] = useState(false);
  const ready = goal.trim() && phone;
  return (
    <HudPanel className="focus-card stack" label="Start a focus block">
      <h1 className="title metal">Real work earns play time</h1>
      <div>
        <label className="small" htmlFor="goal">What will you finish in this block?</label>
        <input type="text" id="goal" maxLength={100} placeholder="Fix the login endpoint bug" autoComplete="off" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>
      <div className="row" role="group" aria-label="Block length">
        {[15, 25, 45].map((n) => (
          <button key={n} className="btn" type="button" aria-pressed={S.len === n} onClick={() => setLen(n)}>{n} min</button>
        ))}
      </div>
      <label className="check"><input type="checkbox" id="phone" checked={phone} onChange={(e) => setPhone(e.target.checked)} /><span>My phone is out of reach</span></label>
      <button
        className="btn go"
        type="button"
        id="startBlock"
        disabled={!ready}
        onClick={() => startBlock(goal)}
      >
        Start block
      </button>
      <div className="small">{S.len} min earns {EARN[S.len]}:00 of play, plus {GOAL_BONUS}:00 if you finish your goal. Banked {mmss(S.bank)} of {mmss(BANK_CAP)}.</div>
    </HudPanel>
  );
}

function Running() {
  const [asking, setAsking] = useState(false);
  const f = S.focus;
  const left = (f.endsAt - Date.now()) / 1000;
  return (
    <TimerRing fraction={1 - left / (f.len * 60)}>
      <div className="clock" id="clock">{mmss(left)}</div>
      <div className="wrap-any">{f.goal}</div>
      <div className="small">{f.drifts ? `Logged ${f.drifts}. Back to it.` : 'Missions stay locked until this block ends.'}</div>
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
  );
}

function Claim() {
  return (
    <HudPanel className="focus-card stack" label="Block complete">
      <h1 className="title metal">Did you finish it?</h1>
      <div className="obj wrap-any">{S.claim.goal}</div>
      <div className="row">
        <button className="btn go" type="button" id="claimYes" onClick={() => claimBlock(true)}>Yes, finished</button>
        <button className="btn" type="button" onClick={() => claimBlock(false)}>Not yet</button>
      </div>
    </HudPanel>
  );
}

export function FocusScreen() {
  return (
    <section className="screen" aria-label="Focus">
      <div className="focus">{S.claim ? <Claim /> : S.focus ? <Running /> : <Idle />}</div>
    </section>
  );
}
