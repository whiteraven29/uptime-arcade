import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { byId, setCurrent, stateOf, toast, ui } from '../../api/localGame.js';
import { PlayArea } from './PlayArea.jsx';

export function PlayScreen() {
  const { slug } = useParams();
  const m = byId(slug);
  const st = m ? stateOf(m) : null;
  useEffect(() => {
    if (st === 'locked') toast('Clear the mission before this one first');
  }, [st]);
  if (!m || st === 'locked') return <Navigate to="/missions" replace />;
  if (st === 'clear') return <Navigate to={`/missions/${m.id}`} replace />;
  // A solved mission stays on screen behind its debrief; afterwards it belongs on the rewind route.
  if (st === 'rewind' && ui.debrief !== m.id) return <Navigate to={`/missions/${m.id}/rewind`} replace />;
  setCurrent(m.id);
  return (
    <section className="screen" aria-label="Mission">
      <PlayArea t={m} />
    </section>
  );
}
