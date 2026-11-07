import { Link, useNavigate } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { MissionNode } from '../../ui/MissionNode.jsx';
import { CHAPTERS, S, TK, TRACKS, missionPath, oncallUnlocked, stateOf, toast, ui } from '../../api/localGame.js';

function TrackColumn({ code, name, sub }) {
  const navigate = useNavigate();
  const chapters = CHAPTERS[code];
  return (
    <HudPanel className="tcol">
      <h3 className="metal">{name}</h3>
      <div className="small">{sub}</div>
      <div className="tcol-list">
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
                sub={st === 'rewind' ? `Rewind ${(S.rew[m.id] || { ok: 0 }).ok}/5` : null}
                onClick={() => (st === 'locked' ? toast('Clear the mission before this one first') : navigate(missionPath(m)))}
              />
            </div>
          );
        })}
      </div>
    </HudPanel>
  );
}

export function MissionsScreen() {
  return (
    <section className="screen" aria-label="Missions">
      {oncallUnlocked() && (
        <HudPanel label="On-call unlocked" style={{ marginBottom: 12 }}>
          <p className="small">Endless random incidents. Resolved {S.ocTotal}, best first-try streak {S.ocBest}.</p>
          <Link className="btn go" to="/oncall">Start shift</Link>
        </HudPanel>
      )}
      <div className="tracks">
        {TRACKS.map(([k, l, sub]) => <TrackColumn key={k} code={k} name={l} sub={sub} />)}
        <HudPanel className="tcol planned" label="Coming next">
          <h3 className="metal">NetLab</h3>
          <div className="small">Simulated routers and switches arrive in M6.</div>
          <h3 className="metal" style={{ marginTop: 18 }}>Operations</h3>
          <div className="small">Multi-skill incidents arrive in M7.</div>
        </HudPanel>
      </div>
    </section>
  );
}
