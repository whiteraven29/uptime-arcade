import { Link, Navigate } from 'react-router-dom';
import { HudPanel } from '../../ui/HudPanel.jsx';
import { PlayArea } from '../play/PlayArea.jsx';
import { S, oncallUnlocked, startOncall } from '../../api/localGame.js';

export function OnCallScreen() {
  if (!oncallUnlocked()) return <Navigate to="/missions" replace />;
  return (
    <section className={`screen${S.oc ? " flush" : ""}`} aria-label="On-call">
      {S.oc ? (
        <PlayArea t={S.oc} />
      ) : (
        <div className="narrow">
          <HudPanel label="On-call">
            <h1 className="title metal">The pager is yours</h1>
            <p>Five incidents a shift. 60 XP each, plus 100 XP for finishing the shift. Resolved so far: {S.ocTotal}.</p>
            <div className="row">
              <button className="btn go" type="button" onClick={startOncall}>Start shift</button>
              <Link className="btn" to="/missions">Back</Link>
            </div>
          </HudPanel>
        </div>
      )}
    </section>
  );
}
