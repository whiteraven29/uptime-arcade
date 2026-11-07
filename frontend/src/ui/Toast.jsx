import { BadgeEmblem } from './BadgeEmblem.jsx';

export function Toast({ text, badge }) {
  if (!text) return null;
  return (
    <div className={`toast${badge ? ' with-badge' : ''}`} role="status">
      {badge && <BadgeEmblem id={badge} />}
      <span>{text}</span>
    </div>
  );
}
