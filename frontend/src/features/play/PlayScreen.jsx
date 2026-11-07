import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { byId, enterMission, stateOf, toast, ui } from '../../api/game.js';
import { PlayArea } from './PlayArea.jsx';

export function PlayScreen() {
  const { slug } = useParams();
  const m = byId(slug);
  const st = m ? stateOf(m) : null;
  useEffect(() => {
    if (st === 'locked') toast('Clear the mission before this one first');
    else if (m && st === 'open') enterMission(m.id).catch((e) => toast(e.message));
  }, [m, st]);
  if (!m || st === 'locked') return <Navigate to="/missions" replace />;
  if (st === 'clear') return <Navigate to={`/missions/${m.id}`} replace />;
  // A solved mission stays on screen behind its debrief; afterwards it belongs on the rewind route.
  if (st === 'rewind' && ui.debrief?.id !== m.id) return <Navigate to={`/missions/${m.id}/rewind`} replace />;
  const t = ui.current;
  if (!t || t.id !== m.id) return <section className="screen" aria-label="Mission"><p className="splash">Loading...</p></section>;
  return (
    <section className="screen flush" aria-label="Mission">
      <PlayArea t={t} />
    </section>
  );
}
