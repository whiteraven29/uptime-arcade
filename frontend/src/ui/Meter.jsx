export function Meter({ label, value, fraction }) {
  return (
    <div className="track">
      {label ? <span>{label}</span> : <span />}
      <span className="dim">{value}</span>
      <div className="meter"><i style={{ width: `${fraction * 100}%` }} /></div>
    </div>
  );
}
