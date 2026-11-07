import { BadgeEmblem } from './BadgeEmblem.jsx';

export function Badge({ id, name, description, earned }) {
  return (
    <div className={`badge${earned ? ' got' : ''}`}>
      <BadgeEmblem id={id} />
      <b>{name}</b>
      <span>{description}</span>
    </div>
  );
}
