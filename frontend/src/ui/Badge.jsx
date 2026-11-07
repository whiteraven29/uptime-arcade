export function Badge({ name, description, earned }) {
  return (
    <div className={`badge${earned ? ' got' : ''}`}>
      <b>{name}</b>
      {description}
    </div>
  );
}
