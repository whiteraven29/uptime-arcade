import { HudPanel } from './HudPanel.jsx';

export function StatTile({ label, value, sub, amber }) {
  return (
    <HudPanel className="stat">
      <p className="label">{label}</p>
      <div className={`num${amber ? ' amber' : ''}`}>{value}</div>
      <div className="small">{sub}</div>
    </HudPanel>
  );
}
