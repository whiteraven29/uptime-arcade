import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { DifficultyTag } from '../../ui/DifficultyTag.jsx';
import { TK, byId, loadBriefing, loadDebrief, parText, stateOf, toast, trackName, ui } from '../../api/game.js';

/* The solution comes from the server only once the mission has been solved. */
function Debrief({ id }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    loadDebrief(id).then((x) => {
      if (live) setD(x);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  if (!d) return <p className="small">Loading...</p>;
  return (
    <>
      <p className="label">Debrief</p>
      <p>{d.why}</p>
      <pre>{d.solution}</pre>
      <p className="small">On the job: {d.job}</p>
      <p className="good">Earned {d.xp_awarded} XP.</p>
    </>
  );
}

export function BriefingScreen() {
  const { slug } = useParams();
  const m = byId(slug);
  const st = m ? stateOf(m) : null;
  useEffect(() => {
    if (st === 'locked') toast('Clear the mission before this one first');
    else if (m) loadBriefing(m.id).catch(() => {});
  }, [st, m]);
  if (!m || st === 'locked') return <Navigate to="/missions" replace />;
  if (st === 'rewind') return <Navigate to={`/missions/${m.id}/rewind`} replace />;
  const b = ui.briefings[m.id];
  if (!b) return <section className="screen" aria-label="Briefing"><p className="splash">Loading...</p></section>;
  return (
    <section className="screen" aria-label="Briefing">
      <div className="narrow">
        <HudPanel label={`${trackName(m.track)} ${m.pos + 1} of ${TK[m.track].length}`}>
          <h1 className="title metal">{m.title}</h1>
          <div className="meta">
            <span>From <b>{b.from_dept}</b></span>
            <DifficultyTag code={m.difficulty} />
            <span>Worth <b>{m.xp} XP</b> when you finish the mission and its rewind</span>
            <span>Par <b>{parText(b)}</b></span>
          </div>
          <p className="label">Lesson</p>
          <p>{b.lesson.text}</p>
          <pre>{b.lesson.example}</pre>
          {st === 'clear' ? (
            <>
              <Debrief id={m.id} />
              <div className="row">
                <Link className="btn go" id="revisit" to={`/missions/${m.id}/play`}>Play it again</Link>
                <Link className="btn" to="/missions">Back to missions</Link>
              </div>
              <p className="small">Revisiting is practice: it uses play time and pays no XP.</p>
            </>
          ) : (
            <>
              <p className="label">Your mission</p>
              <p>{b.brief}</p>
              <p className="obj">{b.goal}</p>
              <div className="row">
                <Link className="btn go" id="launch" to={`/missions/${m.id}/play`}>Launch mission</Link>
                <Link className="btn" to="/missions">Back</Link>
              </div>
            </>
          )}
        </HudPanel>
      </div>
    </section>
  );
}
