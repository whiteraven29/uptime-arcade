import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { MissionNode } from '../../ui/MissionNode.jsx';
import { BEYOND, CHAPTERS, DIFFICULTIES, S, TK, TRACKS, beyondOpen, difficultyLabel, missionPath, oncallUnlocked, stateOf, toast, ui } from '../../api/localGame.js';

function TrackColumn({ code, name, sub, selected }) {
  const navigate = useNavigate();
  const chapters = CHAPTERS[code];
  const list = useRef(null);
  const done = TK[code].filter((m) => S.rewDone[m.id]).length;
  // Thirty missions don't fit on screen, so each column opens on the one you're up to.
  useEffect(() => {
    const box = list.current;
    const now = box?.querySelector('.node.rewind, .node.open');
    if (box && now) box.scrollTop = now.offsetTop - box.offsetTop - box.clientHeight / 3;
  }, []);
  return (
    <HudPanel className={`tcol${selected ? ' selected' : ''}`}>
      <div className="tcol-head">
        <h3 className="metal">{name}</h3>
        <span className="tcol-count">{done}/{TK[code].length}</span>
      </div>
      <div className="small">{sub}</div>
      <div className="tcol-list" ref={list}>
        {TK[code].map((m, i) => {
          const chapter = chapters.find((x) => x[1] === i);
          const st = stateOf(m);
          return (
            <div key={m.id}>
              {chapter && <div className="chap">{chapter[0]}</div>}
              <MissionNode
                id={m.id}
                state={st}
                title={m.title}
                flash={ui.flash === m.id}
                difficulty={m.difficulty}
                difficultyLabel={difficultyLabel(m.difficulty)}
                sub={st === 'rewind' ? `Questions ${(S.rew[m.id] || { ok: 0 }).ok}/${m.rewind.length}` : null}
                onClick={() => (st === 'locked' ? toast(code === BEYOND[0] && !beyondOpen() ? 'Reach Archmage to open these' : 'Clear the mission before this one first') : navigate(missionPath(m)))}
              />
            </div>
          );
        })}
      </div>
    </HudPanel>
  );
}

export function MissionsScreen() {
  const [picked, setPicked] = useState(TRACKS[0][0]);
  return (
    <section className="screen flush missions" aria-label="Missions">
      {oncallUnlocked() && (
        <HudPanel label="On-call unlocked">
          <p className="small">Endless random incidents. Resolved {S.ocTotal}, best first-try streak {S.ocBest}.</p>
          <Link className="btn go" to="/oncall">Start shift</Link>
        </HudPanel>
      )}
      <div className="diff-legend" aria-label="Difficulty levels">
        {DIFFICULTIES.map((d) => <span key={d.code}><i className={`diff-dot diff-${d.code}`} />{d.label}</span>)}
      </div>
      <div className="track-tabs" role="group" aria-label="Choose a track">
        {[...TRACKS, BEYOND].map(([k, l]) => <button key={k} type="button" className="btn" aria-pressed={picked === k} onClick={() => setPicked(k)}>{l}</button>)}
      </div>
      <div className="tracks">
        {[...TRACKS, BEYOND].map(([k, l, sub]) => <TrackColumn key={k} code={k} name={l} sub={sub} selected={picked === k} />)}
      </div>
    </section>
  );
}
