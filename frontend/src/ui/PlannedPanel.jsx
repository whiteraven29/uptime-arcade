import { Link } from 'react-router-dom';
import { HudPanel } from './HudPanel.jsx';

/* An honest placeholder for a screen on the roadmap that doesn't exist yet. */
export function PlannedPanel({ title, milestone, children }) {
  return (
    <section className="screen" aria-label={title}>
      <div className="narrow">
        <HudPanel label={`Arrives in milestone ${milestone}`}>
          <h1 className="title metal">{title}</h1>
          <p>{children}</p>
          <Link className="btn" to="/missions">Back to missions</Link>
        </HudPanel>
      </div>
    </section>
  );
}
