/* The player: a hooded operator seen from behind, lit by the holograms around them.
   An original silhouette for Whiteraven. */
export function OperatorFigure({ beam = true, className = '' }) {
  return (
    <div className={`operator ${className}`} aria-hidden="true">
      {beam && <div className="beam" />}
      <div className="plate">
        <svg viewBox="0 0 200 200">
          <g className="spin" style={{ transformOrigin: '100px 100px' }}>
            <circle cx="100" cy="100" r="96" fill="none" style={{ stroke: 'var(--holo)' }} strokeOpacity=".8" strokeWidth="2" strokeDasharray="30 12 6 12" />
          </g>
          <circle cx="100" cy="100" r="74" fill="none" style={{ stroke: 'var(--holo-soft)' }} strokeOpacity=".5" strokeWidth="1.2" />
          <circle cx="100" cy="100" r="50" style={{ fill: 'var(--holo)', stroke: 'var(--holo)' }} fillOpacity=".12" strokeOpacity=".7" strokeWidth="1.2" />
        </svg>
      </div>
      <svg className="figure" viewBox="0 0 64 160">
        <defs>
          <linearGradient id="coat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--coat-top)' }} />
            <stop offset=".12" style={{ stopColor: 'var(--coat-mid)' }} />
            <stop offset=".5" style={{ stopColor: 'var(--coat-dark)' }} />
            <stop offset=".82" style={{ stopColor: 'var(--coat-mid)' }} />
            <stop offset="1" style={{ stopColor: 'var(--coat-low)' }} />
          </linearGradient>
          <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--holo-soft)' }} />
            <stop offset=".42" style={{ stopColor: 'var(--holo)', stopOpacity: 0.45 }} />
            <stop offset=".72" style={{ stopColor: 'var(--violet)', stopOpacity: 0.5 }} />
            <stop offset="1" style={{ stopColor: 'var(--magenta)' }} />
          </linearGradient>
        </defs>
        <g fill="url(#coat)" stroke="url(#rim)" strokeWidth=".9" strokeLinejoin="round">
          <path d="M20.5 114 L19 149 L16.5 156.5 L28.5 156.5 L29.5 149 L30.5 114 Z" />
          <path d="M33.5 114 L34.5 149 L35.5 156.5 L47.5 156.5 L45 149 L43.5 114 Z" />
          <path d="M32 4 C25 4 20.5 9 20 16 C19.6 20 20.5 24 22 27 C17 29 12 31 10 36 C7.5 44 7 58 7.5 72 C7.6 78 8 84 9 88 L13 88 L15 70 L13 116 C20 119.5 44 119.5 51 116 L49 70 L51 88 L55 88 C56 84 56.4 78 56.5 72 C57 58 56.5 44 54 36 C52 31 47 29 42 27 C43.5 24 44.4 20 44 16 C43.5 9 39 4 32 4 Z" />
        </g>
        <path d="M32 30 L32 117" style={{ stroke: 'var(--holo)' }} strokeOpacity=".22" strokeWidth=".8" />
        <path d="M23 26.5 C27 29.5 37 29.5 41 26.5" fill="none" style={{ stroke: 'var(--holo-soft)' }} strokeOpacity=".55" strokeWidth=".8" />
      </svg>
    </div>
  );
}
