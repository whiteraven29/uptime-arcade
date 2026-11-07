import { useNavigate } from 'react-router-dom';
import { Overlay } from '../ui/Overlay.jsx';
import { LEVELS, S, byId, cleared, closeDebrief, closeOverlay, leaveMission, ui } from '../api/localGame.js';

function Debrief({ id }) {
  const navigate = useNavigate();
  const t = byId(id);
  const d = S.done[id];
  return (
    <Overlay label="Mission complete">
      <p className="label">Mission complete</p>
      <h2 className="title metal">{t.title}</h2>
      <p className="good">Solved. {d.note}{d.bonus ? ' (par bonus)' : ''}</p>
      <p>{t.why}</p>
      <pre>{t.sol}</pre>
      <p className="small">On the job: {t.job}</p>
      <p className="obj">{d.paid ? 'Answer five short questions to unlock the next mission.' : `Answer five short questions about it to earn ${d.worth} XP and unlock the next mission.`}</p>
      <div className="row">
        <button className="btn go" type="button" onClick={() => { closeDebrief(); navigate(`/missions/${id}/rewind`); }}>Start the questions</button>
        <button className="btn" type="button" onClick={() => { closeDebrief(); leaveMission(); }}>Later</button>
      </div>
    </Overlay>
  );
}

function LevelUp({ i }) {
  return (
    <Overlay label="Level up" className="lvlup">
      <p className="label">Level {i + 1} of {LEVELS.length}</p>
      <div className="name metal">{LEVELS[i][1]}</div>
      <p>You cleared {cleared()} missions.</p>
      {LEVELS[i + 1] && <p className="small">Next: {LEVELS[i + 1][1]} at {LEVELS[i + 1][0]} missions.</p>}
      <div className="row"><button className="btn go" type="button" onClick={closeOverlay}>Continue</button></div>
    </Overlay>
  );
}

function Finale() {
  return (
    <Overlay label="All paths complete" className="lvlup">
      <p className="label">All paths complete</p>
      <div className="name metal">Archmage</div>
      <p>You rose from Noob to Archmage at Whiteraven with {S.focusMin} minutes of real focus across {S.blocks} blocks.</p>
      <p className="small">The Beyond missions are now open, from Easy to Brainfuck. On-call shifts are unlocked too, and you can start a new season in System.</p>
      <div className="row"><button className="btn go" type="button" onClick={closeOverlay}>Continue</button></div>
    </Overlay>
  );
}

export function Overlays() {
  return (
    <>
      {ui.debrief && <Debrief id={ui.debrief} />}
      {ui.overlay?.kind === 'level' && <LevelUp i={ui.overlay.i} />}
      {ui.overlay?.kind === 'finale' && <Finale />}
    </>
  );
}
