import { useNavigate } from 'react-router-dom';
import { Overlay } from '../ui/Overlay.jsx';
import { DeviceIcon } from '../features/play/workspaces/netlab/DeviceIcon.jsx';
import { DifficultyTag } from '../ui/DifficultyTag.jsx';
import { LEVELS, S, byId, closeDebrief, closeOverlay, cleared, leaveMission, leaveReveal, missionPath, ui } from '../api/game.js';

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

/* A new lab, drawing itself: its devices arrive one at a time, then the cables run between them. */
const REVEAL_W = 1000;
const REVEAL_H = 400;
const spot = (d) => ({ x: 70 + (d.x / 100) * (REVEAL_W - 140), y: 40 + (d.y / 100) * (REVEAL_H - 110) });
const hang = (a, b) => `M${a.x} ${a.y}Q${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + Math.min(40, Math.hypot(a.x - b.x, a.y - b.y) * 0.14)} ${b.x} ${b.y}`;

function LabReveal({ o }) {
  const navigate = useNavigate();
  const card = byId(o.mission);
  if (!card) return null;
  const where = Object.fromEntries(o.preview.devices.map((d) => [d.name, spot(d)]));
  const count = o.preview.devices.length;
  return (
    <Overlay label="A new lab is open" className="lab-reveal">
      <p className="label">New lab open</p>
      <h2 className="title metal" id="revealTitle">{card.title}</h2>
      <p className="small lab-reveal-meta"><DifficultyTag code={card.difficulty} /> <span>{card.chapter}</span> <span>Worth {card.xp} XP</span>{o.xp ? <b>You just earned {o.xp} XP</b> : null}</p>
      <svg className="lab-reveal-map" viewBox={`0 0 ${REVEAL_W} ${REVEAL_H}`} aria-hidden="true">
        {o.preview.cables.map(([a, b], i) => (where[a] && where[b] ? <path key={`${a}${b}${i}`} pathLength="1" d={hang(where[a], where[b])} style={{ '--i': count + i }} /> : null))}
        {o.preview.devices.map((d, i) => (
          <g key={d.name} transform={`translate(${where[d.name].x} ${where[d.name].y})`}>
            <g className="lab-reveal-device" style={{ '--i': i }}>
              <DeviceIcon kind={d.kind} />
              <text y="50" textAnchor="middle">{d.name}</text>
            </g>
          </g>
        ))}
      </svg>
      <div className="row">
        <button className="btn go" type="button" id="revealOpen" onClick={() => { closeOverlay(); navigate(missionPath(card)); }}>Open it</button>
        <button className="btn" type="button" id="revealLater" onClick={() => leaveReveal(o.mission)}>Later</button>
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
      <p className="small">The Beyond missions are now open, from Easy to Brainfuck. You can revisit anything you've cleared.</p>
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
      {ui.overlay?.kind === 'unlock' && <LabReveal key={ui.overlay.mission} o={ui.overlay} />}
    </>
  );
}
