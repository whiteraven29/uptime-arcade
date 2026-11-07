const C = 2 * Math.PI * 92;

/* The big gold countdown on Focus. */
export function TimerRing({ fraction, children }) {
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="97" fill="none"  style={{ stroke: 'var(--holo-soft)' }} strokeOpacity=".3" strokeWidth=".5" strokeDasharray="1 4" />
        <circle cx="100" cy="100" r="92" fill="none"  style={{ stroke: 'var(--holo)' }} strokeOpacity=".17" strokeWidth="5" />
        <circle cx="100" cy="100" r="92" fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * fraction} ${C}`} style={{ stroke: 'var(--amber)', filter: 'drop-shadow(0 0 5px var(--lava))' }} />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}
