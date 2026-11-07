import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { byId, endPractice, enterMission, stateOf, toast, ui } from '../../api/game.js';
import { PlayArea } from './PlayArea.jsx';

export function PlayScreen() {
  const { slug } = useParams();
  const m = byId(slug);
  const st = m ? stateOf(m) : null;
  useEffect(() => {
    if (st === 'locked') toast(m.lockedBecause || 'Clear the mission before this one first');
    else if (m && (st === 'open' || st === 'clear')) enterMission(m.id).catch((e) => toast(e.message));
  }, [m, st]);
  // A revisit plays on a clean machine, and yours comes back however you leave.
  useEffect(() => endPractice, []);
  if (!m || st === 'locked') return <Navigate to="/missions" replace />;
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
