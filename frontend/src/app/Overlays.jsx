import { useNavigate } from 'react-router-dom';
import { Overlay } from '../ui/Overlay.jsx';
import { LEVELS, S, closeDebrief, closeOverlay, cleared, leaveMission, ui } from '../api/game.js';

function Debrief({ d }) {
  const navigate = useNavigate();
  const { id } = d;
  return (
    <Overlay label="Mission complete">
      <p className="label">Mission complete</p>
      <h2 className="title metal">{d.title}</h2>
      <p className="good">Solved. {d.note}{d.bonus ? ' (par bonus)' : ''}</p>
      <p>{d.why}</p>
      <pre>{d.solution}</pre>
      <p className="small">On the job: {d.job}</p>
      <p className="obj">Answer five short questions about it to earn {d.worth} XP and unlock the next mission.</p>
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
      <p className="small">The Beyond missions are now open, from Easy to Brainfuck. You can also start a new season in System.</p>
      <div className="row"><button className="btn go" type="button" onClick={closeOverlay}>Continue</button></div>
    </Overlay>
  );
}

export function Overlays() {
  return (
    <>
      {ui.debrief && <Debrief d={ui.debrief} />}
      {ui.overlay?.kind === 'level' && <LevelUp i={ui.overlay.i} />}
      {ui.overlay?.kind === 'finale' && <Finale />}
    </>
  );
}
