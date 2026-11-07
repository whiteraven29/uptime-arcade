import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { TK, byId, parText, setCurrent, stateOf, toast, trackName } from '../../api/localGame.js';

export function BriefingScreen() {
  const { slug } = useParams();
  const m = byId(slug);
  const st = m ? stateOf(m) : null;
  useEffect(() => {
    if (st === 'locked') toast('Clear the mission before this one first');
  }, [st]);
  if (!m || st === 'locked') return <Navigate to="/missions" replace />;
  if (st === 'rewind') return <Navigate to={`/missions/${m.id}/rewind`} replace />;
  setCurrent(m.id);
  return (
    <section className="screen" aria-label="Briefing">
      <div className="narrow">
        <HudPanel label={`${trackName(m.track)} ${m.pos + 1} of ${TK[m.track].length}`}>
          <h1 className="title metal">{m.title}</h1>
          <div className="meta">
            <span>From <b>{m.from}</b></span>
            <span>Worth <b>{m.xp} XP</b></span>
            <span>Par <b>{parText(m)}</b></span>
          </div>
          <p className="label">Lesson</p>
          <p>{m.learn[0]}</p>
          <pre>{m.learn[1]}</pre>
          {st === 'clear' ? (
            <>
              <p className="label">Debrief</p>
              <p>{m.why}</p>
              <pre>{m.sol}</pre>
              <p className="small">On the job: {m.job}</p>
              <Link className="btn" to="/missions">Back to missions</Link>
            </>
          ) : (
            <>
              <p className="label">Your mission</p>
              <p>{m.brief}</p>
              <p className="obj">{m.goal}</p>
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
