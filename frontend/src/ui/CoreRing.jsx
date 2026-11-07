const C = 2 * Math.PI * 150;

/* The reactor: counter-rotating rings, a pulsing glow, and a gold arc of progress to the next level. */
export function CoreRing({ level, title, sub, progress, children }) {
  return (
    <div className="core">
      <svg viewBox="0 0 400 400" aria-hidden="true">
        <defs>
          <radialGradient id="coreGlow">
            <stop offset="0" style={{ stopColor: 'var(--void)', stopOpacity: 0.96 }} />
            <stop offset=".66" style={{ stopColor: 'var(--void)', stopOpacity: 0.9 }} />
            <stop offset=".8" style={{ stopColor: 'var(--violet)', stopOpacity: 0.26 }} />
            <stop offset="1" style={{ stopColor: 'var(--holo)', stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="coreIris" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--holo)' }} />
            <stop offset=".45" style={{ stopColor: 'var(--violet)' }} />
            <stop offset=".75" style={{ stopColor: 'var(--magenta)' }} />
            <stop offset="1" style={{ stopColor: 'var(--holo)' }} />
          </linearGradient>
        </defs>
        <circle cx="200" cy="200" r="190" fill="url(#coreGlow)" className="pulse" />
        {/* Solid and still, so the room never shows through behind the text. */}
        <circle cx="200" cy="200" r="142" style={{ fill: 'var(--void)' }} fillOpacity=".97" />
        <g className="spin"><circle cx="200" cy="200" r="192" fill="none" style={{ stroke: 'var(--holo-soft)' }} strokeOpacity=".62" strokeWidth="1" strokeDasharray="2 9" /></g>
        <g className="spin rev"><circle cx="200" cy="200" r="174" fill="none" stroke="url(#coreIris)" strokeOpacity=".9" strokeWidth="4" strokeDasharray="46 22 8 22" /></g>
        <circle cx="200" cy="200" r="150" fill="none" style={{ stroke: 'var(--holo)' }} strokeOpacity=".18" strokeWidth="10" />
        <circle cx="200" cy="200" r="150" fill="none" strokeWidth="10" strokeLinecap="round" transform="rotate(-90 200 200)" strokeDasharray={`${C * Math.min(1, progress)} ${C}`} style={{ stroke: 'var(--amber)', filter: 'drop-shadow(0 0 7px var(--lava))' }} />
        <g className="spin"><circle cx="200" cy="200" r="132" fill="none" style={{ stroke: 'var(--holo-soft)' }} strokeOpacity=".4" strokeWidth="1" strokeDasharray="70 18" /></g>
      </svg>
      <div className="core-text">
        <div className="lv">{level}</div>
        <div className={`name metal${title.length > 10 ? ' longest' : title.length > 7 ? ' long' : ''}`}>{title}</div>
        <div className="sub">{sub}</div>
        {children}
      </div>
    </div>
  );
}
